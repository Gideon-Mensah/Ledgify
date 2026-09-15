"""Bridge versioned tax to existing commercial documents and TaxTransaction rows."""
import copy
from decimal import Decimal
from common.exceptions import BusinessRuleError
from .engine import calculate_components, decimal, money
from .configuration import profile_on, version_on, valid_account, digest, serial
from .models import (TaxCode, TaxRate, TaxRateVersion, TaxAccountMapping,
    DocumentTaxSnapshot, DocumentLineTaxSnapshot)


def prepare_line_tax(*, organisation, line, scope, point, source_line=None):
    """Return existing line values plus a trusted snapshot; never accept browser snapshots."""
    line=dict(line)
    if 'tax_inclusive' in line and type(line['tax_inclusive']) is not bool:
        raise BusinessRuleError('Tax-inclusive selection must be a boolean.')
    if line.get('tax_rate_id') and not line.get('tax_rate_config'):
        rate=TaxRate.objects.filter(organisation=organisation,pk=line['tax_rate_id']).first()
        if not rate:raise BusinessRuleError('Tax rate is unavailable.')
        line['tax_rate_config']=rate
    profile=profile_on(organisation,point)
    code=line.get('tax_code')
    if not code and line.get('tax_code_id'):
        code=TaxCode.objects.filter(organisation=organisation,pk=line['tax_code_id']).first()
        if not code:raise BusinessRuleError('Tax code is unavailable.')
    original=getattr(source_line,'tax_snapshot',{}) if source_line else {}
    if original:
        snapshot=copy.deepcopy(original)
        for key in ('adjustment_kind','original_document_id','original_document_number'):
            snapshot.pop(key,None)
        snapshot['original_source_line']=str(source_line.pk)
        snapshot['original_tax_point']=snapshot['tax_point']
        components=snapshot['components'];classification=snapshot['classification']
        inclusive=bool(line.get('tax_inclusive',snapshot.get('inclusive',False)))
    elif code:
        if not profile or profile.structure=='NO_TAX':raise BusinessRuleError('Activate an applicable tax profile before selecting this code.')
        if code.statutory and profile.structure!='GHANA_GRA':raise BusinessRuleError('Ghana statutory codes are unavailable under this tax structure.')
        if code.family!='INDIRECT' or code.tracking_only:raise BusinessRuleError('This code is withholding or tracking only; it cannot calculate invoice VAT.')
        if code.scope not in {scope,'BOTH'}:raise BusinessRuleError('Tax code is not applicable to this document direction.')
        version=version_on(organisation,code,point)
        classification=version.classification
        if profile.structure=='GHANA_GRA' and classification not in {'EXEMPT','OUT_SCOPE'}:
            registration=profile.registration
            if not registration.get('vat_registered') or point.isoformat()<registration['vat_effective_from'] or (registration.get('vat_effective_to') and point.isoformat()>registration['vat_effective_to']):
                raise BusinessRuleError('This organisation is not VAT registered on the document tax point.')
        if classification in {'ZERO','EXEMPT'} and not str(line.get('tax_reason','')).strip():
            raise BusinessRuleError('Record the exemption/zero-rating category and source reason.')
        components=copy.deepcopy(version.components)
        for component in components:
            mapping=TaxAccountMapping.objects.filter(organisation=organisation,version=version,component_code=component['code'],direction='OUTPUT' if scope=='SALES' else 'INPUT').first()
            component['legacy_rate_id']=str(mapping.legacy_rate_id) if mapping else None
        inclusive=bool(line.get('tax_inclusive',version.rules.get('inclusive',False)))
        snapshot={'code_id':str(code.pk),'code':code.code,'version_id':str(version.pk),'version':version.number,
            'version_checksum':version.checksum,'profile_id':str(profile.pk),'profile_version':profile.version,
            'provenance':version.provenance,'source':version.source,'classification':classification,'scope':scope,
            'tax_point':point.isoformat(),'tax_point_rule':version.rules.get('tax_point','INVOICE_DATE'),
            'reason':str(line.get('tax_reason','')),'components':components,
            'validation_maximum_rate':version.rules.get('validation_maximum_rate','1000'),
            'required_tax_identifiers':version.rules.get('required_tax_identifiers',[])}
    else:
        if profile and profile.structure!='NO_TAX':
            raise BusinessRuleError('Select and confirm a tax classification from the active structure, including exempt or out-of-scope lines.')
        if profile and profile.structure=='NO_TAX' and (line.get('tax_rate_config') or decimal(line.get('tax_rate',0))):
            raise BusinessRuleError('No Tax does not allow an indirect tax rate.')
        # Compatibility: legacy organisations keep their existing rate IDs until
        # explicitly migrated. Newly saved legacy lines still receive snapshots.
        from .services.calculation_service import calculate_tax
        from .services.ledger_service import validate_tax_rate
        rate=source_line.tax_rate_config if source_line else line.get('tax_rate_config')
        if rate and not source_line:validate_tax_rate(rate=rate,organisation=organisation,scope=scope,date=point)
        percent=source_line.tax_rate if source_line else rate.rate if rate else decimal(line.get('tax_rate',0))
        if percent and not rate:raise BusinessRuleError('Select a configured tax rate.')
        calculated=calculate_tax(quantity=line.get('quantity',1),unit_price=line.get('unit_price',0),discount=line.get('discount_amount',0),tax_rate=percent,tax_inclusive=line.get('tax_inclusive',False))
        components=[]
        if rate:
            c={'code':rate.code,'name':rate.name,'kind':'PERCENT','rate':str(percent),'depends_on':[],
               'recoverable_percent':'100' if rate.recoverable else '0','legacy_rate_id':str(rate.pk),
               'output_account':str(rate.output_tax_account_id) if rate.output_tax_account_id else None,
               'input_account':str(rate.input_tax_account_id) if rate.input_tax_account_id else None,
               'base':str(calculated['net_amount']),'amount':str(calculated['tax_amount']),
               'recoverable_amount':str(calculated['tax_amount']) if scope=='PURCHASES' and rate.recoverable else '0.00',
               'nonrecoverable_amount':str(calculated['tax_amount']) if scope=='PURCHASES' and not rate.recoverable else '0.00'}
            components=[c]
        snapshot={'code':rate.code if rate else 'NO_TAX','legacy':True,'classification':'STANDARD' if rate and percent else 'OUT_SCOPE',
            'tax_point':point.isoformat(),'scope':scope,'components':components,'inclusive':bool(line.get('tax_inclusive',False)),
            'profile_id':str(profile.pk) if profile else None,'rounding_policy':'LINE_2DP_HALF_UP',**{k:str(v) for k,v in calculated.items()}}
        if source_line:snapshot['original_source_line']=str(source_line.pk)
        return {**calculated,'tax_rate':percent,'tax_rate_config':rate,'snapshot':snapshot}
    calculated=calculate_components(quantity=line.get('quantity',1),unit_price=line.get('unit_price',0),discount=line.get('discount_amount',0),
        components=components,inclusive=inclusive,classification=classification,scope=scope,maximum_rate=snapshot.get('validation_maximum_rate','1000'))
    if classification == 'REVERSE_CHARGE':
        if scope != 'PURCHASES':
            raise BusinessRuleError('Reverse charge is supported only for purchases.')
        snapshot['self_assessed'] = True
        snapshot['self_assessed_tax'] = str(calculated['tax_amount'])
        calculated['gross_amount'] = calculated['net_amount']
        calculated['tax_amount'] = Decimal('0.00')
    snapshot.update(serial(calculated));snapshot['tax_point']=point.isoformat()
    config_id=next((c.get('legacy_rate_id') for c in components if c.get('legacy_rate_id')),None)
    rate_config=TaxRate.objects.filter(organisation=organisation,pk=config_id).first() if config_id else None
    return {**{k:calculated[k] for k in ('net_amount','tax_amount','gross_amount')},
        'tax_rate':sum((decimal(c['rate']) for c in components if c.get('kind','PERCENT')=='PERCENT'),Decimal('0')),
        'tax_rate_config':rate_config,'snapshot':snapshot}


def validate_document_snapshot(document):
    """Block stale drafts rather than silently selecting a newly activated rate."""
    from .models import TaxPeriod
    if TaxPeriod.objects.filter(organisation=document.organisation,start_date__lte=document.issue_date,end_date__gte=document.issue_date,status__in=['FILED','LOCKED']).exists():
        raise BusinessRuleError('The tax period is filed or locked. Use an adjustment in an open period.')
    for line in document.lines.all():
        snap=line.tax_snapshot
        if not snap:
            if profile_on(document.organisation, document.issue_date):
                raise BusinessRuleError('Review and recalculate this legacy draft under the active tax structure before posting.')
            continue
        if money(snap['gross_amount'])!=line.line_total or money(snap['tax_amount'])!=line.tax_amount:
            raise BusinessRuleError('Tax snapshot and document amounts differ. Refresh the draft before posting.')
        contact=getattr(document,'customer',getattr(document,'supplier',None))
        if any(not str(getattr(contact,key,'')).strip() for key in snap.get('required_tax_identifiers',[])):
            raise BusinessRuleError('Complete the contact tax/registration identifiers required by this tax version before posting.')
        if snap.get('original_source_line'):continue
        profile=profile_on(document.organisation,document.issue_date)
        if (str(profile.pk) if profile else None)!=snap.get('profile_id'):
            raise BusinessRuleError('The tax structure changed. Review and recalculate this draft before posting.')
        if snap.get('version_id'):
            code=TaxCode.objects.get(pk=snap['code_id'],organisation=document.organisation)
            version=version_on(document.organisation,code,document.issue_date)
            if str(version.pk)!=snap['version_id'] or document.issue_date.isoformat()!=snap['tax_point']:
                raise BusinessRuleError('The effective tax version changed. Review and recalculate this draft before posting.')
        elif snap.get('legacy') and line.tax_rate_config_id:
            current=TaxRate.objects.get(pk=line.tax_rate_config_id,organisation=document.organisation)
            if current.rate!=line.tax_rate or current.status!='ACTIVE':raise BusinessRuleError('The legacy tax rate changed. Recalculate the draft before posting.')


def nonrecoverable(line):
    if line.tax_snapshot:return money(sum((decimal(c.get('nonrecoverable_amount',0)) for c in line.tax_snapshot['components']),Decimal('0')))
    return line.tax_amount if line.tax_rate_config and not line.tax_rate_config.recoverable else Decimal('0')


def tax_ledger_totals(document,lines,direction):
    """Aggregate exactly the amounts that will be written to the tax register."""
    totals={}
    for line in lines:
        snap=line.tax_snapshot
        if snap:
            for c in snap['components']:
                amount=decimal(c['amount'] if direction=='OUTPUT' else c.get('recoverable_amount',0))
                if not amount:continue
                account=valid_account(document.organisation,c.get('output_account' if direction=='OUTPUT' else 'input_account'),direction)
                key=(c.get('legacy_rate_id'),account.pk)
                totals.setdefault(key,[account,Decimal('0')])[1]+=amount
        else:
            rate=line.tax_rate_config
            if not line.tax_amount or (direction=='INPUT' and rate and not rate.recoverable):continue
            if not rate:raise BusinessRuleError('Taxed lines require a configured tax rate.')
            account=valid_account(document.organisation,rate.output_tax_account_id if direction=='OUTPUT' else rate.input_tax_account_id,direction)
            totals.setdefault((rate.pk,account.pk),[account,Decimal('0')])[1]+=line.tax_amount
    return totals


def freeze_document(document,lines,journal,source_type):
    contact=getattr(document,'customer',getattr(document,'supplier',None))
    profile=profile_on(document.organisation,document.issue_date)
    payload={'organisation_tax_registration':copy.deepcopy(profile.registration) if profile else {},'tax_identifiers':{key:str(getattr(contact,key,'')) for key in ('tax_number','registration_number')},'source_type':source_type,'number':getattr(document,'invoice_number',getattr(document,'bill_number',getattr(document,'credit_note_number',getattr(document,'credit_number','')))),
        'subtotal':str(document.subtotal),'tax_total':str(document.tax_total),'total':str(document.total),
        'lines':[{'line_id':str(line.pk),'snapshot':line.tax_snapshot} for line in lines]}
    snapshot=DocumentTaxSnapshot.objects.create(organisation=document.organisation,created_by=document.created_by,
        source_type=source_type,source_id=document.pk,tax_point=document.issue_date,currency=document.currency,
        base_currency=document.organisation.base_currency,exchange_rate=document.exchange_rate or 1,
        journal=journal,payload=payload,checksum=digest(payload))
    for line in lines:
        DocumentLineTaxSnapshot.objects.create(organisation=document.organisation,created_by=document.created_by,
            document=snapshot,source_line_id=line.pk,version_id=line.tax_snapshot.get('version_id'),payload=line.tax_snapshot)
    from .configuration import audit
    audit(document.organisation,journal.created_by,'TRANSACTION_TAX_CONFIRMED',snapshot,'Posted with preserved tax classifications and versions',after={'source_type':source_type,'source_id':str(document.pk),'checksum':snapshot.checksum})
    return snapshot


def debit_source_line(*, organisation, original, line, contact, point, currency):
    """A debit note increases an existing receivable/payable using its original tax rules."""
    if original is None:
        if line.get('source_line_id'):
            raise BusinessRuleError('An original line requires the linked debit-note workflow.')
        return None
    party_id = getattr(original, 'customer_id', getattr(original, 'supplier_id', None))
    if original.organisation_id != organisation.pk or party_id != contact.pk or original.currency != currency:
        raise BusinessRuleError('The debit note must use the original organisation, contact and currency.')
    if not original.accounting_journal_id or original.status in {'draft', 'void', 'reversed'} or point < original.issue_date:
        raise BusinessRuleError('A debit note requires a posted original document and a date on or after it.')
    source = original.lines.filter(pk=line.get('source_line_id')).first()
    if source is None:
        raise BusinessRuleError('Select the original document line for every debit-note line.')
    return source


def mark_debit_snapshot(prepared, original):
    if original:
        prepared['snapshot'].update(adjustment_kind='DEBIT_NOTE', original_document_id=str(original.pk),
            original_document_number=getattr(original, 'invoice_number', getattr(original, 'bill_number', '')))
    return prepared


def debit_original_for_draft(document):
    line=document.lines.filter(tax_snapshot__adjustment_kind='DEBIT_NOTE').first()
    if not line:return None
    original=type(document).objects.filter(organisation=document.organisation,pk=line.tax_snapshot.get('original_document_id')).first()
    if not original:raise BusinessRuleError('The original debit-note document is unavailable.')
    return original
