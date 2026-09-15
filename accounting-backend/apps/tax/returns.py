"""Reconciled tax workpapers, immutable approved snapshots and manual filing evidence."""
import csv
import hashlib
import io
from decimal import Decimal
from django.db.models import Q, Sum
from django.utils import timezone
from common.exceptions import BusinessRuleError
from common.ledger_integrity import ledger_transaction
from apps.accounting.models import JournalLine, LEDGER_EFFECTIVE_JOURNAL_STATUSES
from apps.fx.services import convert_amount
from .models import (TaxPeriod, TaxReturnDraft, DocumentTaxSnapshot, TaxTransaction,
    TaxAccountMapping, TaxAdjustment, WithholdingTransaction, TaxExport, TaxFilingEvidence, TaxPayment)
from .configuration import permit, audit, digest, serial, valid_account, profile_on
from .engine import decimal, money
from .services.register_service import tax_register

ZERO=Decimal('0.00')


def within(point,start,end):return (not start or point>=start) and (not end or point<=end)


def gl_balance(organisation,accounts,start,end,exclude_settlements=False):
    qs=JournalLine.objects.filter(journal_entry__organisation=organisation,account__organisation=organisation,
        journal_entry__status__in=LEDGER_EFFECTIVE_JOURNAL_STATUSES,account_id__in=accounts)
    if exclude_settlements:
        settlements=TaxPayment.objects.filter(organisation=organisation).values('journal')
        qs=qs.exclude(Q(journal_entry__in=settlements)|Q(journal_entry__reversal_of_id__in=settlements))
    if start:qs=qs.filter(journal_entry__date__gte=start)
    if end:qs=qs.filter(journal_entry__date__lte=end)
    sums=qs.aggregate(d=Sum('debit'),c=Sum('credit'))
    return (sums['c'] or ZERO)-(sums['d'] or ZERO)


def withholding_register(organisation,start,end,family='WHT'):
    rows=[]
    qs=WithholdingTransaction.objects.filter(organisation=organisation,family=family,journal__organisation=organisation,contact__organisation=organisation,version__organisation=organisation,account__organisation=organisation).select_related('journal','journal__reversal_entry','contact')
    for item in qs:
        events=[(item.payment_date,Decimal(1),item.journal)]
        reversal=getattr(item.journal,'reversal_entry',None)
        if reversal:events.append((reversal.date,Decimal(-1),reversal))
        for point,sign,journal in events:
            if journal.status not in LEDGER_EFFECTIVE_JOURNAL_STATUSES or not within(point,start,end):continue
            rows.append({'id':str(item.pk),'date':point,'payment_id':str(item.payment_id),'family':item.family,
                'supplier_payment':item.supplier_payment,'account':str(item.account_id),'journal_id':str(journal.pk),
                'certificate':item.certificate,'currency':item.currency,'reversal':sign<0,
                'gross':sign*item.gross_amount,'withheld':sign*item.withheld_amount,'net':sign*item.net_amount,
                'base_withheld':sign*item.base_withheld_amount,'details':item.details})
    accounts={row['account'] for row in rows}
    # Include inactive-in-period mapped controls, to detect unregistered manual GL entries.
    accounts.update(TaxAccountMapping.objects.filter(organisation=organisation,version__code__family=family).values_list('account_id',flat=True))
    subledger=sum((row['base_withheld']*(1 if row['supplier_payment'] else -1) for row in rows),ZERO)
    gl=gl_balance(organisation,accounts,start,end,exclude_settlements=True)
    controls={str(account):gl_balance(organisation,[account],start,end,exclude_settlements=True) for account in accounts}
    return {'rows':rows,'controls':controls,'payable':sum((r['base_withheld'] for r in rows if r['supplier_payment']),ZERO),
        'receivable':sum((r['base_withheld'] for r in rows if not r['supplier_payment']),ZERO),
        'subledger_net':subledger,'gl_net_credit':gl,'difference':gl-subledger,'reconciled':gl==subledger,'currency':organisation.base_currency}


def vat_workpaper(organisation,start,end):
    if end<start:raise BusinessRuleError('Period end precedes start.')
    register=tax_register(organisation=organisation,start_date=start,end_date=end)
    included=[r for r in register['results'] if r['inclusion']=='included']
    tx={str(t.pk):t for t in TaxTransaction.objects.filter(organisation=organisation).select_related('tax_rate')}
    sections={key:ZERO for key in ['standard_sales','zero_sales','exempt_sales','out_scope_sales','taxable_purchases','import_goods','import_services','nonrecoverable_input','credit_debit_adjustments','vat_withholding_credits','other_adjustments']}
    components={};details=[]
    for row in included:
        original=tx[row['id'].split(':')[0]]
        component=original.component_snapshot.get('code',original.tax_rate.code)
        key=('output_' if row['direction']=='OUTPUT' else 'input_')+component
        components[key]=components.get(key,ZERO)+row['tax_amount']
        details.append({**row,'component':component,'classification':original.component_snapshot.get('classification','LEGACY_UNCLASSIFIED')})
    # Source snapshots count each taxable base once, not once per component.
    for doc in DocumentTaxSnapshot.objects.filter(organisation=organisation,journal__organisation=organisation).select_related('journal','journal__reversal_entry'):
        sign=Decimal(-1) if doc.source_type in {'customer_credit','supplier_credit'} else Decimal(1)
        events=[(doc.tax_point,sign,doc.journal)]
        reversal=getattr(doc.journal,'reversal_entry',None)
        if reversal:events.append((reversal.date,-sign,reversal))
        for point,factor,journal in events:
            if journal.status not in LEDGER_EFFECTIVE_JOURNAL_STATUSES or not within(point,start,end):continue
            for line in doc.payload['lines']:
                snap=line['snapshot']
                if not snap:continue
                net=factor*convert_amount(amount=decimal(snap['net_amount']),rate=doc.exchange_rate)
                sales=snap['scope']=='SALES';classification=snap['classification']
                if sales:
                    key={'ZERO':'zero_sales','EXEMPT':'exempt_sales','OUT_SCOPE':'out_scope_sales'}.get(classification,'standard_sales')
                else:key={'IMPORT_GOODS':'import_goods','IMPORT_SERVICES':'import_services'}.get(classification,'taxable_purchases')
                sections[key]+=net
                if not sales:
                    amount=sum((decimal(c.get('nonrecoverable_amount',0)) for c in snap['components']),ZERO)
                    sections['nonrecoverable_input']+=factor*convert_amount(amount=amount,rate=doc.exchange_rate)
                if doc.source_type in {'customer_credit','supplier_credit'} or snap.get('adjustment_kind')=='DEBIT_NOTE':
                    sections['credit_debit_adjustments']+=factor*convert_amount(amount=decimal(snap['tax_amount']),rate=doc.exchange_rate)
    accounts=set(TaxTransaction.objects.filter(organisation=organisation).values_list('tax_account_id',flat=True))
    accounts.update(TaxAccountMapping.objects.filter(organisation=organisation,version__code__family='INDIRECT').values_list('account_id',flat=True))
    adjustments=TaxAdjustment.objects.filter(organisation=organisation,journal__organisation=organisation,journal__date__gte=start,journal__date__lte=end).select_related('journal')
    adjustment_total=ZERO
    for adj in adjustments:
        if adj.journal.status in LEDGER_EFFECTIVE_JOURNAL_STATUSES:
            amount=adj.amount*(1 if adj.direction=='OUTPUT' else -1)
            adjustment_total+=amount;accounts.add(adj.account_id)
            details.append({'id':str(adj.pk),'source_type':'tax_adjustment','journal_id':str(adj.journal_id),'tax_amount':adj.amount,'component':adj.component_code,'reason':adj.reason})
    sections['other_adjustments']=adjustment_total
    subledger=register['summary']['net_tax_due_or_refundable']+adjustment_total
    gl=gl_balance(organisation,accounts,start,end,exclude_settlements=True)
    controls={str(account):gl_balance(organisation,[account],start,end,exclude_settlements=True) for account in accounts}
    wh=withholding_register(organisation,start,end,'VAT_WHT')
    sections['vat_withholding_credits']=wh['receivable']
    for account,amount in wh['controls'].items():
        if amount<0:controls[account]=amount
    legacy_missing=TaxTransaction.objects.filter(organisation=organisation,transaction_date__gte=start,transaction_date__lte=end).exclude(journal_entry__in=DocumentTaxSnapshot.objects.filter(organisation=organisation).values('journal')).exists()
    return {'period_start':start,'period_end':end,'currency':organisation.base_currency,'controls':controls,'sections':sections,'components':components,
        'net_payable':subledger-wh['receivable'],'subledger_net':subledger,'gl_net_credit':gl,
        'difference':gl-subledger,'reconciled':gl==subledger and wh['reconciled'] and not legacy_missing,
        'legacy_snapshot_review_required':legacy_missing,'transactions':details,'vat_withholding':wh,
        'notice':'Workpaper for review and manual filing; no automatic submission or certification.'}


@ledger_transaction
def prepare_return(*,organisation,user,period,kind='VAT',amends=None):
    permit(organisation,user,'prepare_tax_return')
    if period.organisation_id!=organisation.id or kind not in {'VAT','WHT','VAT_WHT'}:raise BusinessRuleError('Invalid tax return period/type.')
    approved=TaxReturnDraft.objects.filter(organisation=organisation,period=period,kind=kind,status__in=['APPROVED','EXPORTED','FILED','PAID'])
    if period.status in {'FILED','LOCKED'} and approved.exists() and not amends:raise BusinessRuleError('This return is locked. Prepare an explicit amendment in an authorised workflow.')
    if amends and (amends.organisation_id!=organisation.id or amends.period_id!=period.pk or amends.kind!=kind):raise BusinessRuleError('The amendment must reference this organisation and period.')
    payload=vat_workpaper(organisation,period.start_date,period.end_date) if kind=='VAT' else withholding_register(organisation,period.start_date,period.end_date,kind)
    revision=(TaxReturnDraft.objects.filter(organisation=organisation,period=period,kind=kind).order_by('-revision').values_list('revision',flat=True).first() or 0)+1
    result=TaxReturnDraft.objects.create(organisation=organisation,created_by=user,period=period,kind=kind,revision=revision,snapshot=serial(payload),checksum=digest(payload),amends=amends)
    audit(organisation,user,'RETURN_PREPARED',result,'Prepared from ledger/source records',after={'checksum':result.checksum,'revision':revision})
    return result


@ledger_transaction
def transition_return(*,organisation,user,tax_return,target,reason,acknowledgement=''):
    tax_return=TaxReturnDraft.objects.select_for_update().get(organisation=organisation,pk=tax_return.pk)
    transitions={'REVIEWED':({'DRAFT'},'review_tax_returns'),'APPROVED':({'REVIEWED'},'approve_tax_returns'),
        'FILED':({'APPROVED','EXPORTED'},'record_tax_filing'),'AMENDED':({'FILED','PAID'},'reopen_tax_period')}
    if target not in transitions:raise BusinessRuleError('Use the export or payment workflow for this status.')
    states,permission=transitions[target];permit(organisation,user,permission)
    if not reason.strip() or tax_return.status not in states:raise BusinessRuleError('Invalid return transition or missing reason.')
    if target in {'REVIEWED','APPROVED'}:
        current=vat_workpaper(organisation,tax_return.period.start_date,tax_return.period.end_date) if tax_return.kind=='VAT' else withholding_register(organisation,tax_return.period.start_date,tax_return.period.end_date,tax_return.kind)
        if digest(current)!=tax_return.checksum:raise BusinessRuleError('Ledger data changed. Prepare a new draft; the existing snapshot is retained.')
        if not current['reconciled']:raise BusinessRuleError('Resolve tax register/ledger and legacy-snapshot differences before review.')
    if target=='APPROVED':
        existing=TaxReturnDraft.objects.filter(organisation=organisation,period=tax_return.period,kind=tax_return.kind,status__in=['APPROVED','EXPORTED','FILED','PAID']).exclude(pk=tax_return.pk).order_by('-revision').first()
        if existing and tax_return.amends_id!=existing.pk:
            raise BusinessRuleError('An approved return already exists. Amend the latest approved revision explicitly.')
        profile=profile_on(organisation,tax_return.period.end_date)
        if (organisation.require_separate_approver or (profile and profile.separate_approval)) and tax_return.created_by_id==user.id:
            raise BusinessRuleError('A different authorised user must approve this return.')
        tax_return.approved_by=user;tax_return.approved_at=timezone.now()
        period=tax_return.period
        if period.status!='FILED':period.status='LOCKED';period.save(update_fields=['status'])
    if target=='FILED':
        if not acknowledgement.strip():raise BusinessRuleError('Record the actual filing acknowledgement.')
        TaxFilingEvidence.objects.create(organisation=organisation,created_by=user,tax_return=tax_return,acknowledgement=acknowledgement,notes=reason)
        period=tax_return.period;period.status='FILED';period.filed_by=user;period.filed_at=timezone.now();period.save(update_fields=['status','filed_by','filed_at'])
    if target=='AMENDED':
        # Retain the filed record; an amendment is a separate immutable revision.
        result=prepare_return(organisation=organisation,user=user,period=tax_return.period,kind=tax_return.kind,amends=tax_return)
        audit(organisation,user,'RETURN_AMENDMENT_CREATED',result,reason,before={'return':str(tax_return.pk)})
        return result
    old=tax_return.status;tax_return.status=target;tax_return.save(update_fields=['status','approved_by','approved_at'])
    audit(organisation,user,'RETURN_'+target,tax_return,reason,before={'status':old},after={'status':target,'checksum':tax_return.checksum})
    return tax_return


def csv_safe(value):
    text=str(value if value is not None else '')
    return "'"+text if text.lstrip().startswith(('=','+','-','@')) else text


def wht_export_validation(payload):
    errors=[]
    for index,row in enumerate(payload['rows'],1):
        if not row['supplier_payment']:continue
        fields=['tax_identifier','residence','country','name','official_code','contract_amount','rate']
        missing=[name for name in fields if not row['details'].get(name)]
        if missing:errors.append({'row':index,'errors':['Missing '+', '.join(missing)]})
        if row['reversal']:errors.append({'row':index,'errors':['A reversal needs the official portal amendment treatment; review before export.']})
    if not payload['reconciled']:errors.append({'row':None,'errors':['WHT register does not reconcile to its control accounts.']})
    return errors


@ledger_transaction
def export_wht(*,organisation,user,tax_return,portal=False):
    permit(organisation,user,'export_gra_schedules')
    if tax_return.organisation_id!=organisation.id or tax_return.kind!='WHT':raise BusinessRuleError('Select this organisation\'s WHT return.')
    if tax_return.status not in {'REVIEWED','APPROVED','EXPORTED'}:raise BusinessRuleError('Review the return before exporting.')
    payload=tax_return.snapshot;errors=wht_export_validation(payload)
    if errors:raise BusinessRuleError({'rows':errors})
    if portal:
        raise BusinessRuleError('Current official DT110/ITAS template and accepted codes are not verified. Portal-ready export is disabled; use the clearly labelled review schedule.')
    rows=[r for r in payload['rows'] if r['supplier_payment']]
    if not rows:raise BusinessRuleError('No reviewed supplier withholding transactions in this period.')
    columns=['Resident status','TIN / Ghana Card' if organisation.country_code=='GH' else 'Tax identifier','Name','Country','Withholding code','Contract amount','Gross payment','Rate','Tax withheld','Certificate','Currency']
    output=io.StringIO(newline='');writer=csv.writer(output);writer.writerow(columns)
    for row in rows:
        d=row['details'];writer.writerow([csv_safe(x) for x in [d['residence'],d['tax_identifier'],d['name'],d['country'],d['official_code'],d['contract_amount'],row['gross'],d['rate'],row['withheld'],row['certificate'],row['currency']]])
    data=output.getvalue().encode('utf-8-sig')
    result=TaxExport.objects.create(organisation=organisation,created_by=user,tax_return=tax_return,
        template_version='LEDGIFY_REVIEW_ONLY_V1_NOT_GRA_UPLOAD',source='Internal review schedule; official portal template pending',checksum=hashlib.sha256(data).hexdigest(),row_count=len(rows),reconciliation={k:payload[k] for k in ['payable','receivable','difference','reconciled']})
    audit(organisation,user,'WHT_REVIEW_EXPORTED',result,'Manual review schedule; not filed',after={'checksum':result.checksum,'template':result.template_version})
    # Exporting never marks a return filed, and a review-only export does not
    # claim that an official GRA export has been produced.
    return data,result


@ledger_transaction
def export_workpaper(*, organisation, user, tax_return, format="json"):
    """Export the exact reviewed snapshot, without representing portal acceptance."""
    permit(organisation, user, 'export_gra_schedules')
    tax_return = TaxReturnDraft.objects.select_for_update().get(organisation=organisation, pk=tax_return.pk)
    if tax_return.status not in {'REVIEWED', 'APPROVED', 'EXPORTED', 'FILED', 'PAID'}:
        raise BusinessRuleError('Review the reconciled snapshot before exporting it.')
    if not tax_return.snapshot.get('reconciled'):
        raise BusinessRuleError('Resolve reconciliation differences before export.')
    import json
    payload = {'notice': 'Internal review workpaper, not a portal upload or evidence of filing.',
               'organisation': organisation.name, 'kind': tax_return.kind, 'revision': tax_return.revision,
               'snapshot_checksum': tax_return.checksum, 'snapshot': tax_return.snapshot}
    if format not in {'json','pdf'}:raise BusinessRuleError('Choose PDF or JSON workpaper format.')
    if format=='pdf':
        from common.documents import render_pdf,identity
        snapshot=tax_return.snapshot
        values={**snapshot.get('sections',{}),**snapshot.get('components',{})}
        values.update({key:snapshot[key] for key in ('payable','receivable','net_payable','subledger_net','gl_net_credit','difference') if key in snapshot})
        rows=[[key.replace('_',' ').title(),str(value)] for key,value in values.items()]
        for item in snapshot.get('transactions',snapshot.get('rows',[])):
            description=' · '.join(str(value) for value in [item.get('document_number'),item.get('component'),item.get('details',{}).get('name'),item.get('journal_number')] if value)
            rows.append([description or 'Source transaction',str(item.get('tax_amount',item.get('base_withheld','0.00')))])
        data=render_pdf({'organisation':identity(organisation),'kind':'tax-workpaper','title':tax_return.kind+' review workpaper',
            'number':f'{tax_return.kind} {tax_return.period.start_date} revision {tax_return.revision}','date':str(tax_return.period.end_date),'due_date':'','status':tax_return.status,
            'currency':organisation.base_currency,'currency_basis':'base','party':None,'reference':f'Revision {tax_return.revision}',
            'columns':['Section / source','Amount'],'rows':rows or [['No tax activity','0.00']],
            'totals':[['Reconciliation difference',snapshot['difference']]],'notes':payload['notice']+' Period: '+str(tax_return.period.start_date)+' to '+str(tax_return.period.end_date)})
    else:data = json.dumps(payload, indent=2, ensure_ascii=False).encode('utf-8')
    result = TaxExport.objects.create(organisation=organisation, created_by=user, tax_return=tax_return,
        template_version='LEDGIFY_WORKPAPER_'+format.upper()+'_V1', source='Reviewed source and ledger reconciliation',
        checksum=hashlib.sha256(data).hexdigest(), row_count=len(tax_return.snapshot.get('transactions', tax_return.snapshot.get('rows', []))),
        reconciliation={'difference': tax_return.snapshot['difference'], 'reconciled': True})
    if tax_return.status == 'APPROVED':
        tax_return.status = 'EXPORTED'
        tax_return.save(update_fields=['status'])
    audit(organisation, user, 'WORKPAPER_EXPORTED', result, 'Reviewed snapshot downloaded; no filing performed', after={'checksum': result.checksum})
    return data, result
