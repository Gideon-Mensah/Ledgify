"""Payment-triggered income-tax and VAT withholding, kept separate from VAT lines."""
from decimal import Decimal
from common.exceptions import BusinessRuleError
from .engine import decimal, money
from .configuration import profile_on, version_on, valid_account
from .models import TaxCode, TaxPeriod, WithholdingTransaction
from apps.fx.services import convert_amount


def prepare_withholding(*,organisation,contact,point,gross,currency,exchange_rate,items,supplier_payment,source):
    if not items:return [],Decimal('0.00')
    if not isinstance(items,list) or len(items)>2:raise BusinessRuleError('At most one income-tax and one VAT withholding entry are allowed.')
    if TaxPeriod.objects.filter(organisation=organisation,start_date__lte=point,end_date__gte=point,status__in=['FILED','LOCKED']).exists():
        raise BusinessRuleError('Withholding cannot post into a filed or locked tax period.')
    profile=profile_on(organisation,point)
    if not profile or profile.structure=='NO_TAX':raise BusinessRuleError('Activate the applicable withholding registration first.')
    seen=set();prepared=[]
    for item in items:
        code=TaxCode.objects.filter(organisation=organisation,pk=item.get('tax_code_id'),family__in=['WHT','VAT_WHT']).first()
        if not code or code.family in seen:raise BusinessRuleError('Select one valid organisation code per withholding family.')
        if code.statutory and profile.structure!='GHANA_GRA':raise BusinessRuleError('Ghana withholding codes require the Ghana tax structure.')
        seen.add(code.family);version=version_on(organisation,code,point)
        flag='wht_agent' if code.family=='WHT' else 'vat_wht_agent'
        if supplier_payment and (not profile.registration.get(flag) or point.isoformat()<profile.registration.get('wht_effective_from' if code.family=='WHT' else 'vat_wht_effective_from','9999')):
            raise BusinessRuleError('The organisation is not an eligible withholding agent on this payment date.')
        if item.get('eligibility_confirmed') is not True or not str(item.get('tax_identifier','')).strip() or not str(item.get('country','')).strip() or item.get('residence') not in {'RESIDENT','NONRESIDENT'}:
            raise BusinessRuleError('Confirm eligibility, residence, country and the withholdee tax identifier.')
        if version.rules.get('residence') and version.rules['residence']!=item['residence']:
            raise BusinessRuleError('Withholdee residence does not match the verified code.')
        import re
        country=str(item.get('country','')).strip().upper()
        if not re.fullmatch('[A-Z]{2}',country):raise BusinessRuleError('Use a two-letter country code.')
        certificate=str(item.get('certificate','')).strip()
        if (not supplier_payment or code.family=='VAT_WHT') and not certificate:
            raise BusinessRuleError('A withholding certificate/reference is required for this tax credit.')
        from django.db.models import DateField
        from django.core.exceptions import ValidationError
        certificate_date=item.get('certificate_date')
        if code.family=='VAT_WHT' and not certificate_date:raise BusinessRuleError('VAT withholding requires the actual certificate date.')
        try:certificate_date=DateField().to_python(certificate_date) if certificate_date else None
        except (ValidationError,ValueError,TypeError):raise BusinessRuleError('Enter a valid certificate date.') from None
        base=money(gross)
        if code.family=='VAT_WHT' or version.rules.get('base')=='NET_OF_VAT':
            if not source or source.total<=0:raise BusinessRuleError('Taxable-base withholding requires its original invoice or bill.')
            if source.organisation_id!=organisation.id:raise BusinessRuleError('Source document is unavailable.')
            if code.family=='VAT_WHT' and (not source.tax_total or item.get('counterparty_vat_registered') is not True):
                raise BusinessRuleError('VAT withholding requires an eligible registered counterparty and standard-rated source supply.')
            if code.family=='VAT_WHT' and any(l.tax_snapshot.get('classification')!='STANDARD' for l in source.lines.all()):
                raise BusinessRuleError('Mixed/nonstandard supplies require a reviewed allocation before VAT withholding.')
            base=money(gross*source.subtotal/source.total)
        if len(version.components)!=1 or version.components[0].get('kind','PERCENT')!='PERCENT':
            raise BusinessRuleError('Withholding currently requires one verified percentage component per family.')
        c=version.components[0];withheld=money(base*decimal(c['rate'])/100)
        if not 0<withheld<gross:raise BusinessRuleError('Withholding must be positive and less than the gross settlement.')
        account=valid_account(organisation,c.get('output_account' if supplier_payment else 'input_account'),'OUTPUT' if supplier_payment else 'INPUT')
        base_withheld=convert_amount(amount=withheld,rate=exchange_rate)
        contract=money(item.get('contract_amount',gross))
        if contract<gross:raise BusinessRuleError('Contract amount cannot be below this payment.')
        prepared.append({'version':version,'family':code.family,'account':account,'withheld':withheld,'base_withheld':base_withheld,'certificate':certificate,
            'details':{'tax_identifier':str(item['tax_identifier']).strip(),'residence':item['residence'],'country':country,
                'name':contact.name,'official_code':version.rules['official_code'],'contract_amount':str(contract),'taxable_base':str(base),
                'rate':str(c['rate']),'final_treatment':version.rules.get('final_treatment','REVIEW_REQUIRED'),
                'source':version.source,'exemption_evidence':str(item.get('exemption_evidence','')),
                'treaty_evidence':str(item.get('treaty_evidence','')),'certificate_date':certificate_date.isoformat() if certificate_date else None,
                'source_id':str(source.pk) if source else None,'tax_components':[l.tax_snapshot.get('components',[]) for l in source.lines.all()] if source else []}})
    total=sum((p['withheld'] for p in prepared),Decimal('0'))
    if total>=gross:raise BusinessRuleError('Combined withholding must be less than gross payment.')
    return prepared,total


def withholding_journal_lines(prepared,supplier_payment):
    return [{'account':p['account'],'description':p['family']+' withheld at payment',
             'debit':Decimal('0') if supplier_payment else p['base_withheld'],
             'credit':p['base_withheld'] if supplier_payment else Decimal('0')} for p in prepared]


def record_withholding(payment,prepared,supplier_payment,user):
    for p in prepared:
        WithholdingTransaction.objects.create(organisation=payment.organisation,created_by=user,
            family=p['family'],version=p['version'],payment_id=payment.pk,supplier_payment=supplier_payment,
            journal=payment.accounting_journal,contact=payment.supplier if supplier_payment else payment.customer,
            account=p['account'],payment_date=payment.payment_date,currency=payment.currency,gross_amount=payment.amount,
            withheld_amount=p['withheld'],net_amount=payment.amount-sum((x['withheld'] for x in prepared),Decimal('0')),
            base_withheld_amount=p['base_withheld'],certificate=p['certificate'],details=p['details'])
