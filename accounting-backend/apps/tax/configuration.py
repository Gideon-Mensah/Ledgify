"""Organisation-scoped, auditable tax configuration and activation services."""
import copy
import hashlib
import json
from datetime import date, timedelta
from decimal import Decimal
from django.db import transaction
from django.db.models import Max, Q
from django.utils import timezone
from zoneinfo import ZoneInfo
from common.exceptions import BusinessRuleError
from common.ledger_integrity import ledger_transaction, lock_ledger
from apps.organisations.services import require_organisation_permission
from apps.accounting.models import Account, JournalEntry, LEDGER_EFFECTIVE_JOURNAL_STATUSES
from .models import (OrganisationTaxProfile, OrganisationTaxRegistration, TaxCode,
    TaxRateVersion, TaxApplicabilityRule, TaxRegimeVersion, TaxAccountMapping,
    TaxConfigurationAudit, TaxRate, DocumentLineTaxSnapshot)
from .engine import validate_components, calculate_components, decimal
from .presets import (GHANA_CODES, VAT_COMPONENTS, CONTROL_ROLES, GRA_VAT_SOURCE,
    GRA_WHT_SOURCE, GRA_VAT_WHT_SOURCE, GHANA_VERSION, GHANA_EFFECTIVE, CHECKED_ON,
    WHT_CATEGORIES, TRACKING_OBLIGATIONS)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str, separators=(',', ':')).encode()).hexdigest()


def serial(value):
    return json.loads(json.dumps(value, default=str))


def permit(organisation, user, permission):
    require_organisation_permission(organisation=organisation, user=user, permission=permission)


def audit(organisation, user, event, subject=None, reason='', before=None, after=None):
    return TaxConfigurationAudit.objects.create(organisation=organisation, created_by=user,
        event=event, subject_id=getattr(subject, 'pk', None), reason=reason,
        before=serial(before or {}), after=serial(after or {}))


def local_today(organisation):
    return timezone.now().astimezone(ZoneInfo(organisation.timezone or 'UTC')).date()


def profile_on(organisation, point):
    return OrganisationTaxProfile.objects.filter(organisation=organisation, status='ACTIVE', effective_from__lte=point).order_by('-effective_from', '-version').first()


def valid_account(organisation, account_id, direction=None):
    account = Account.objects.filter(organisation=organisation, id=account_id, status='active').first()
    if not account or (direction == 'OUTPUT' and account.account_type != 'liability') or (direction == 'INPUT' and account.account_type != 'asset'):
        raise BusinessRuleError('Select an active organisation-owned tax control account of the correct type.')
    return account


def assert_no_posted_since(organisation, point):
    if JournalEntry.objects.filter(organisation=organisation, date__gte=point, status__in=LEDGER_EFFECTIVE_JOURNAL_STATUSES).exists():
        raise BusinessRuleError('Posted transactions exist on or after this date. A reviewed historical remediation is required; choose a prospective effective date.')


def _registration(data, structure):
    allowed = {'vat_registered', 'vat_registration_number', 'tin', 'tax_office',
        'vat_effective_from', 'vat_effective_to', 'wht_agent', 'vat_wht_agent',
        'paye_employer', 'evat_required', 'evat_status', 'evat_effective_from',
        'frequency', 'accounting_basis', 'obligations', 'registration_status',
        'wht_effective_from', 'vat_wht_effective_from', 'paye_effective_from'}
    if not isinstance(data, dict) or set(data) - allowed:
        raise BusinessRuleError('Unsupported registration field.')
    data = copy.deepcopy(data)
    for flag in ['vat_registered', 'wht_agent', 'vat_wht_agent', 'paye_employer', 'evat_required']:
        if not isinstance(data.get(flag, False), bool):
            raise BusinessRuleError('Registration statuses must be explicit true/false values.')
        data.setdefault(flag, False)
    for field in ['vat_effective_from', 'vat_effective_to', 'evat_effective_from', 'wht_effective_from', 'vat_wht_effective_from', 'paye_effective_from']:
        if data.get(field):
            try: date.fromisoformat(data[field])
            except (TypeError, ValueError): raise BusinessRuleError('Enter valid ISO registration dates.') from None
    if data.get('accounting_basis', 'ACCRUAL') != 'ACCRUAL':
        raise BusinessRuleError('Cash-basis VAT is not implemented. Select accrual or retain this obligation as tracking only.')
    if data.get('frequency', 'monthly') not in {'monthly', 'quarterly', 'annual', 'custom'}:
        raise BusinessRuleError('Select a supported reporting frequency.')
    if data['vat_registered'] and (not data.get('vat_effective_from') or not data.get('tin') or not data.get('vat_registration_number')):
        raise BusinessRuleError('VAT registration needs its effective date, TIN and VAT registration number.')
    if data.get('vat_effective_to') and (not data.get('vat_effective_from') or data['vat_effective_to'] < data['vat_effective_from']):
        raise BusinessRuleError('VAT deregistration must follow registration.')
    for flag, field in [('wht_agent', 'wht_effective_from'), ('vat_wht_agent', 'vat_wht_effective_from'), ('paye_employer', 'paye_effective_from')]:
        if data[flag] and not data.get(field): raise BusinessRuleError(f'{flag} needs an effective registration date.')
    obligations = data.get('obligations', [])
    if not isinstance(obligations, list) or set(obligations) - set(TRACKING_OBLIGATIONS + ['VAT', 'WHT', 'VAT_WHT']):
        raise BusinessRuleError('Select recognised registration obligations.')
    if structure == 'NO_TAX' and any(data[flag] for flag in ['vat_registered', 'wht_agent', 'vat_wht_agent']):
        raise BusinessRuleError('No Tax cannot activate VAT or withholding obligations.')
    return data


@ledger_transaction
def create_profile(*, organisation, user, structure, jurisdiction, effective_from,
                   registration, mappings, reason, source='', separate_approval=None, maximum_rate='1000', high_rate_threshold='100'):
    permit(organisation, user, 'configure_tax')
    if structure not in {'GHANA_GRA', 'CUSTOM_INTERNATIONAL', 'NO_TAX'}:
        raise BusinessRuleError('Select a tax structure.')
    if not reason.strip() or len(jurisdiction) != 2:
        raise BusinessRuleError('A migration reason and country jurisdiction are required.')
    if structure == 'GHANA_GRA' and (jurisdiction != 'GH' or organisation.country_code != 'GH'):
        raise BusinessRuleError('Ghana GRA structure is available only to Ghana organisations.')
    if not 0 < decimal(high_rate_threshold) <= decimal(maximum_rate) <= 100000:
        raise BusinessRuleError('Choose positive rate validation limits, high-warning no greater than maximum (up to 100,000).')
    registration = _registration(registration, structure)
    for key, value in mappings.items():
        if key not in CONTROL_ROLES: raise BusinessRuleError('Unknown tax control role.')
        valid_account(organisation, value)
    version = (OrganisationTaxProfile.objects.filter(organisation=organisation).aggregate(v=Max('version'))['v'] or 0) + 1
    profile = OrganisationTaxProfile.objects.create(organisation=organisation, created_by=user,
        structure=structure, jurisdiction=jurisdiction, version=version, effective_from=effective_from,
        registration=registration, mappings=mappings, reason=reason, source=source, maximum_rate=maximum_rate, high_rate_threshold=high_rate_threshold,
        separate_approval=organisation.require_separate_approver if separate_approval is None else (organisation.require_separate_approver or separate_approval))
    audit(organisation, user, 'PROFILE_DRAFTED', profile, reason, after={'structure': structure, 'effective_from': effective_from, 'registration': registration, 'mappings': mappings})
    return profile


@ledger_transaction
def review_profile(*, organisation, user, profile):
    permit(organisation, user, 'approve_tax_changes')
    profile = OrganisationTaxProfile.objects.select_for_update().get(organisation=organisation, pk=profile.pk)
    if profile.status != 'DRAFT': raise BusinessRuleError('Only a draft profile can be reviewed.')
    if (organisation.require_separate_approver or profile.separate_approval) and profile.created_by_id == user.id:
        raise BusinessRuleError('A different authorised user must review this profile.')
    profile.reviewed_by=user; profile.status='REVIEWED';profile.save(update_fields=['reviewed_by','status'])
    audit(organisation,user,'PROFILE_REVIEWED',profile,profile.reason)
    return profile


def _publish_builtin():
    payload = {'codes': GHANA_CODES, 'components': VAT_COMPONENTS}
    preset, _ = TaxRegimeVersion.objects.get_or_create(jurisdiction='GH', regime='VAT', version=GHANA_VERSION,
        defaults={'effective_from': GHANA_EFFECTIVE, 'source': GRA_VAT_SOURCE, 'source_checked_on': CHECKED_ON,
                  'catalogue': payload, 'checksum': digest(payload), 'verified': True})
    return preset


@ledger_transaction
def activate_profile(*, organisation, user, profile, confirmed=False):
    permit(organisation,user,'activate_tax_changes')
    profile=OrganisationTaxProfile.objects.select_for_update().get(organisation=organisation,pk=profile.pk)
    if profile.status!='REVIEWED' or not confirmed: raise BusinessRuleError('Review and explicitly confirm the migration before activation.')
    assert_no_posted_since(organisation,profile.effective_from)
    if OrganisationTaxProfile.objects.filter(organisation=organisation,status='ACTIVE',effective_from__gte=profile.effective_from).exists():
        raise BusinessRuleError('Tax structure changes must follow existing active/scheduled profiles.')
    if profile.structure=='GHANA_GRA' and profile.registration.get('vat_registered'):
        for component in VAT_COMPONENTS:
            for direction in ('OUTPUT','INPUT'):
                valid_account(organisation, profile.mappings.get(f'{direction}_{component["code"]}'), direction)
    previous=profile_on(organisation,profile.effective_from)
    profile.status='ACTIVE';profile.activated_at=timezone.now();profile.save(update_fields=['status','activated_at'])
    # The setting indicates the last approved configuration, while date selection
    # always resolves the effective profile; no historic document is rewritten.
    organisation.tax_structure_type=profile.structure;organisation.tax_configuration_version=profile.version
    organisation.save(update_fields=['tax_structure_type','tax_configuration_version','updated_at'])
    flags={'VAT':'vat_registered','WHT':'wht_agent','VAT_WHT':'vat_wht_agent','PAYE':'paye_employer'}
    obligations=set(profile.registration.get('obligations',[])) | {key for key,flag in flags.items() if profile.registration.get(flag)}
    for obligation in sorted(obligations):
        OrganisationTaxRegistration.objects.create(organisation=organisation,created_by=user,profile=profile,
            obligation=obligation,effective_from=profile.effective_from,frequency=profile.registration.get('frequency','monthly'),
            status='REGISTERED' if obligation in {'VAT','WHT','VAT_WHT'} else 'TRACKING_ONLY',source=profile.source)
    if profile.structure=='GHANA_GRA':
        preset=_publish_builtin()
        for code,name,scope,classification,tracking in GHANA_CODES:
            tax_code,_=TaxCode.objects.get_or_create(organisation=organisation,code=code,defaults={'name':name,'scope':scope,'jurisdiction':'GH','statutory':True,'tracking_only':tracking,'created_by':user})
            if not tracking and (profile.registration.get('vat_registered') or classification in {'EXEMPT','OUT_SCOPE'}):
                # A registration/profile change must not silently replace an organisation override.
                effective=max(profile.effective_from, GHANA_EFFECTIVE,date.fromisoformat(profile.registration.get('vat_effective_from') or profile.effective_from.isoformat()))
                window=TaxApplicabilityRule.objects.filter(organisation=organisation,code=tax_code,start__lte=effective).filter(Q(end__isnull=True)|Q(end__gte=effective)).select_related('version').first()
                current=window.version if window else None
                components=copy.deepcopy(current.components if current else VAT_COMPONENTS)
                for c in components:
                    c['output_account']=profile.mappings.get('OUTPUT_'+c['code'],c.get('output_account'))
                    c['input_account']=profile.mappings.get('INPUT_'+c['code'],c.get('input_account'))
                version=_draft_version(organisation,user,tax_code,effective,None,current.classification if current else classification,components,
                    current.rules if current else {'tax_point':'INVOICE_DATE','scope':scope},current.source if current else GRA_VAT_SOURCE,profile.reason,preset=current.preset if current else preset)
                version.approved_by=profile.reviewed_by;version.approved_at=timezone.now();version.status='APPROVED';version.save(update_fields=['approved_by','approved_at','status'])
                _activate_version(organisation,user,version,profile,False,'')
        for category in WHT_CATEGORIES:
            for residence in ['RESIDENT','NONRESIDENT']:
                TaxCode.objects.get_or_create(organisation=organisation,code=f'WHT-{residence[:3]}-{category}',defaults={'name':f'{residence.title()} {category.lower()} — rate pending verification','family':'WHT','scope':'BOTH','jurisdiction':'GH','statutory':True,'created_by':user})
        TaxCode.objects.get_or_create(organisation=organisation,code='GHS-VAT-WHT',defaults={'name':'VAT withholding — 2026 basis/effective date pending verification','family':'VAT_WHT','scope':'BOTH','jurisdiction':'GH','statutory':True,'created_by':user})
    audit(organisation,user,'PROFILE_ACTIVATED',profile,profile.reason,before={'profile':str(previous.pk) if previous else None},after={'profile':str(profile.pk),'effective_from':profile.effective_from})
    return profile


def _draft_version(organisation,user,code,effective_from,effective_to,classification,components,rules,source,reason,preset=None,confirm_high=False):
    if code.organisation_id!=organisation.id: raise BusinessRuleError('Tax code is unavailable.')
    if not source.strip() or not reason.strip(): raise BusinessRuleError('Source/reference and explanatory reason are required.')
    if effective_to and effective_to<effective_from: raise BusinessRuleError('Effective end precedes start.')
    profile=profile_on(organisation,effective_from)
    if not profile or profile.structure=='NO_TAX': raise BusinessRuleError('Activate a reviewed tax-bearing organisation profile first.')
    if code.statutory and profile.structure!='GHANA_GRA':raise BusinessRuleError('Ghana statutory codes require the Ghana tax structure.')
    validate_components(components, maximum_rate=str(profile.maximum_rate), high_rate=str(profile.high_rate_threshold), confirm_high=confirm_high)
    if classification in {'ZERO','EXEMPT','OUT_SCOPE'} and any(decimal(c['rate']) for c in components):
        # The statutory zero/exempt catalogue explicitly retains named components at zero.
        components=copy.deepcopy(components)
        for c in components:c['rate']='0'
    for c in components:
        for direction,field in [('OUTPUT','output_account'),('INPUT','input_account')]:
            if code.scope in ({'SALES','BOTH'} if direction=='OUTPUT' else {'PURCHASES','BOTH'}):
                if c.get(field) or classification not in {'ZERO','EXEMPT','OUT_SCOPE'}:
                    valid_account(organisation,c.get(field),direction)
    if preset and preset.version == '2026.1' and code.family == 'INDIRECT':
        if any(c.get('depends_on') or c.get('kind', 'PERCENT') != 'PERCENT' for c in components):
            raise BusinessRuleError('Ghana statutory VAT components require percentage rates on the same taxable base.')
    if code.family != 'INDIRECT' and (len(components) != 1 or components[0].get('kind', 'PERCENT') != 'PERCENT' or not 0 < decimal(components[0]['rate']) < 100):
        raise BusinessRuleError('Withholding requires one verified percentage greater than zero and below 100.')
    for component in components:
        for field in ('input_account', 'output_account'):
            account_id = component.get(field)
            if account_id and TaxAccountMapping.objects.filter(organisation=organisation, account_id=account_id).exclude(version__code__family=code.family).exists():
                raise BusinessRuleError('Income-tax withholding, VAT withholding and indirect VAT must use separate control accounts.')
    if classification == 'REVERSE_CHARGE':
        if code.family != 'INDIRECT' or code.scope != 'PURCHASES':
            raise BusinessRuleError('Reverse charge requires a purchase-only indirect tax code.')
        for component in components:
            valid_account(organisation, component.get('output_account'), 'OUTPUT')
    allowed_rules={'scope','rounding_method','tax_point','inclusive','verified','official_code','residence','base','final_treatment','eligibility_notes','required_tax_identifiers','filing_frequency','validation_maximum_rate'}
    if set(rules)-allowed_rules:raise BusinessRuleError('Unsupported tax rule fields: '+', '.join(sorted(set(rules)-allowed_rules)))
    identifiers=rules.get('required_tax_identifiers',[])
    if not isinstance(identifiers,list) or any(key not in {'tax_number','registration_number'} for key in identifiers):
        raise BusinessRuleError('Supported required contact identifiers are tax_number and registration_number.')
    if 'inclusive' in rules and type(rules['inclusive']) is not bool:raise BusinessRuleError('Tax-inclusive configuration must be a boolean.')
    rules={**rules,'validation_maximum_rate':str(profile.maximum_rate)}
    if rules.get('rounding_method','HALF_UP')!='HALF_UP': raise BusinessRuleError('Only the Phase 2 HALF_UP rounding policy is supported.')
    if rules.get('tax_point','INVOICE_DATE') not in {'INVOICE_DATE','PAYMENT_DATE'}:
        raise BusinessRuleError('Only explicit invoice-date or payment-date tax points are implemented.')
    if code.family!='INDIRECT' and rules.get('tax_point')!='PAYMENT_DATE':
        raise BusinessRuleError('Withholding uses payment date, separate from invoice VAT.')
    if code.family=='INDIRECT' and rules.get('tax_point','INVOICE_DATE')!='INVOICE_DATE':
        raise BusinessRuleError('Payment-point indirect tax is tracking only until a verified cash-basis engine exists.')
    if code.family!='INDIRECT' and (rules.get('verified') is not True or not str(rules.get('official_code','')).strip()):
        raise BusinessRuleError('Withholding needs a verified effective-dated source and official withholding code.')
    number=(code.versions.aggregate(v=Max('number'))['v'] or 0)+1
    payload={'components':components,'rules':rules,'classification':classification,'source':source,'effective_from':effective_from,'effective_to':effective_to}
    version=TaxRateVersion.objects.create(organisation=organisation,created_by=user,code=code,number=number,
        effective_from=effective_from,effective_to=effective_to,classification=classification,components=components,rules=rules,
        source=source,reason=reason,preset=preset,provenance='LEDGIFY_VERIFIED_PRESET' if preset else 'ORGANISATION_OVERRIDE',checksum=digest(payload))
    audit(organisation,user,'VERSION_DRAFTED',version,reason,after=payload)
    return version


@ledger_transaction
def draft_version(*,organisation,user,code,**values):
    permit(organisation,user,'draft_tax_changes')
    return _draft_version(organisation,user,code,**values)


@ledger_transaction
def approve_version(*,organisation,user,version):
    permit(organisation,user,'approve_tax_changes')
    version=TaxRateVersion.objects.select_for_update().get(organisation=organisation,pk=version.pk)
    profile=profile_on(organisation,version.effective_from)
    if version.status not in {'DRAFT','PENDING_APPROVAL'}: raise BusinessRuleError('Only a draft or pending version can be approved.')
    if (organisation.require_separate_approver or profile.separate_approval) and version.created_by_id==user.id: raise BusinessRuleError('The drafting user cannot approve this change.')
    version.status='APPROVED';version.approved_by=user;version.approved_at=timezone.now();version.save(update_fields=['status','approved_by','approved_at'])
    audit(organisation,user,'VERSION_APPROVED',version,version.reason)
    return version


def _activate_version(organisation,user,version,profile,emergency,emergency_reason):
    if not profile or profile.structure=='NO_TAX' or (version.code.statutory and profile.structure!='GHANA_GRA'):
        raise BusinessRuleError('This version is not applicable to the effective organisation tax structure.')
    if version.status!='APPROVED' and not emergency: raise BusinessRuleError('Only approved versions may become active.')
    if hasattr(version, 'window'): raise BusinessRuleError('Version is already activated.')
    assert_no_posted_since(organisation,version.effective_from)
    existing=TaxApplicabilityRule.objects.filter(organisation=organisation,code=version.code).order_by('start')
    if existing.filter(start__gte=version.effective_from).exists(): raise BusinessRuleError('A version already starts on or after this date. Retire/review future scheduling first.')
    previous=existing.last()
    if previous:
        if previous.end and previous.end>=version.effective_from: raise BusinessRuleError('Explicit effective periods overlap.')
        if previous.end and previous.end+timedelta(days=1)<version.effective_from:
            retired=TaxConfigurationAudit.objects.filter(organisation=organisation,event='COMPONENTS_RETIRED',subject_id=previous.version_id).exists()
            if not retired:raise BusinessRuleError('Rate periods cannot have gaps unless the previous tax is intentionally retired.')
        if previous.end is None:
            previous.end=version.effective_from-timedelta(days=1);previous.save(update_fields=['end'])
    for i,c in enumerate(version.components):
        account_out=valid_account(organisation,c['output_account'],'OUTPUT') if c.get('output_account') else None
        account_in=valid_account(organisation,c['input_account'],'INPUT') if c.get('input_account') else None
        rate=TaxRate.objects.create(organisation=organisation,created_by=user,code=f'V{str(version.id).replace("-", "")[:20]}-{i}',name=f'{version.code.name[:65]} / {c["code"]}',
            rate=decimal(c['rate']) if c.get('kind','PERCENT')=='PERCENT' else 0,tax_type='VAT' if version.code.family=='INDIRECT' else 'OTHER',scope=version.code.scope,
            effective_from=version.effective_from,effective_to=version.effective_to,input_tax_account=account_in,output_tax_account=account_out,recoverable=decimal(c.get('recoverable_percent',100))>0)
        for direction,account in [('OUTPUT',account_out),('INPUT',account_in)]:
            if account:TaxAccountMapping.objects.create(organisation=organisation,created_by=user,version=version,component_code=c['code'],direction=direction,account=account,legacy_rate=rate)
    TaxApplicabilityRule.objects.create(organisation=organisation,created_by=user,code=version.code,version=version,start=version.effective_from,end=version.effective_to)
    version.status='SCHEDULED' if version.effective_from>local_today(organisation) else 'ACTIVE'
    version.activated_at=timezone.now()
    if emergency:version.approved_by=user;version.approved_at=timezone.now()
    version.save(update_fields=['status','activated_at','approved_by','approved_at'])
    audit(organisation,user,'EMERGENCY_ACTIVATION' if emergency else 'VERSION_ACTIVATED',version,emergency_reason or version.reason,
        before={'version':str(previous.version_id) if previous else None},after={'version':str(version.pk),'source':version.source,'effective_from':version.effective_from,'components':version.components,'review_impact':version_impact(organisation,version)})
    return version


@ledger_transaction
def activate_version(*,organisation,user,version,confirmed=False,emergency=False,reason=''):
    permit(organisation,user,'emergency_activate_tax' if emergency else 'activate_tax_changes')
    if not confirmed or (emergency and not reason.strip()): raise BusinessRuleError('Explicit confirmation and emergency reason, where applicable, are required.')
    version=TaxRateVersion.objects.select_for_update().get(organisation=organisation,pk=version.pk)
    if emergency and version.status not in {'DRAFT','PENDING_APPROVAL','APPROVED'}:raise BusinessRuleError('This version cannot be emergency activated.')
    return _activate_version(organisation,user,version,profile_on(organisation,version.effective_from),emergency,reason)


def version_on(organisation,code,point):
    if code.organisation_id!=organisation.id:raise BusinessRuleError('Tax code is unavailable.')
    window=TaxApplicabilityRule.objects.filter(organisation=organisation,code=code,start__lte=point).filter(Q(end__isnull=True)|Q(end__gte=point)).select_related('version').first()
    if not window or window.version.status not in {'ACTIVE','SCHEDULED','SUPERSEDED'}:
        raise BusinessRuleError('No approved tax version is effective on this tax point. Pending/unverified rates cannot be used.')
    return window.version


def affected_drafts(organisation, code, effective_from):
    """Report affected documents without recalculating or saving any draft."""
    from apps.sales.models import Invoice, CustomerCreditNote
    from apps.purchases.models import Bill, SupplierCredit
    output=[]
    for kind,model,number in [('invoice',Invoice,'invoice_number'),('bill',Bill,'bill_number'),('customer_credit',CustomerCreditNote,'credit_note_number'),('supplier_credit',SupplierCredit,'credit_number')]:
        documents=model.objects.filter(organisation=organisation,status__in=['draft','awaiting_approval'],issue_date__gte=effective_from,lines__tax_snapshot__code_id=str(code.pk)).distinct()
        for document in documents:
            if all(line.tax_snapshot.get('original_source_line') for line in document.lines.all()):continue
            output.append({'kind':kind,'id':str(document.pk),'number':getattr(document,number),'date':document.issue_date})
    return output


def version_impact(organisation, version):
    from .engine import calculate_components
    scope='PURCHASES' if version.code.scope=='PURCHASES' else 'SALES'
    def calculate(value):
        return serial(calculate_components(quantity=1,unit_price='1000',components=value.components,scope=scope,
            inclusive=value.rules.get('inclusive',False),classification=value.classification,maximum_rate=value.rules.get('validation_maximum_rate','1000')))
    previous=TaxApplicabilityRule.objects.filter(organisation=organisation,code=version.code,start__lte=version.effective_from).exclude(version=version).order_by('-start').select_related('version').first()
    return {'basis':'Representative amount 1,000 in document currency; actual documents are not changed.',
        'current':calculate(previous.version) if previous else None,'proposed':calculate(version),
        'affected_future_drafts':serial(affected_drafts(organisation,version.code,version.effective_from))}


@ledger_transaction
def transition_version(*,organisation,user,version,target,reason):
    permit(organisation,user,'draft_tax_changes' if target=='PENDING_APPROVAL' else 'approve_tax_changes')
    version=TaxRateVersion.objects.select_for_update().get(organisation=organisation,pk=version.pk)
    allowed={'PENDING_APPROVAL':{'DRAFT'},'REJECTED':{'DRAFT','PENDING_APPROVAL','APPROVED'}}
    if target not in allowed or version.status not in allowed[target] or not reason.strip():
        raise BusinessRuleError('Invalid version transition or missing reason.')
    old=version.status;version.status=target;version.save(update_fields=['status'])
    audit(organisation,user,'VERSION_'+target,version,reason,before={'status':old},after={'status':target})
    return version
