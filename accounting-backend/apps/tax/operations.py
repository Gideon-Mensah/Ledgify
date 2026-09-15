"""Tax adjustments/payments reuse the authoritative journal service and org lock."""
from decimal import Decimal
from common.ledger_integrity import ledger_transaction
from common.exceptions import BusinessRuleError
from apps.accounting.models import Account
from apps.accounting.services.journals import create_journal_entry, post_journal_entry
from .configuration import permit, audit, valid_account, digest
from .engine import money
from .models import TaxPeriod, TaxAdjustment, TaxPayment, TaxAccountMapping, TaxReturnDraft


def previous_request(model, organisation, key, payload):
    from uuid import UUID
    checksum=digest(payload)
    if key is None:return None,None,checksum
    try:key=UUID(str(key))
    except (ValueError,TypeError):raise BusinessRuleError('Use a valid UUID idempotency key.') from None
    previous=model.objects.filter(organisation=organisation,idempotency_key=key).first()
    if previous and previous.payload_checksum!=checksum:
        raise BusinessRuleError('This request key was already used for different settlement/adjustment details.')
    return previous,key,checksum


@ledger_transaction
def post_adjustment(*,organisation,user,period,point,account_id,counter_account_id,amount,direction,component_code,reason,original_return=None,idempotency_key=None):
    permit(organisation,user,'approve_tax_returns')
    previous,idempotency_key,checksum=previous_request(TaxAdjustment,organisation,idempotency_key,
        {'period':str(period.pk),'date':point,'account':str(account_id),'counter':str(counter_account_id),'amount':str(money(amount)),
         'direction':direction,'component':component_code,'reason':reason,'original_return':str(original_return.pk) if original_return else None})
    if previous:return previous
    if period.organisation_id==organisation.pk:period=TaxPeriod.objects.get(organisation=organisation,pk=period.pk)
    if period.organisation_id!=organisation.id or period.status!='OPEN' or not period.start_date<=point<=period.end_date:
        raise BusinessRuleError('Adjustments require an open tax period containing the adjustment date.')
    if not reason.strip() or direction not in {'INPUT','OUTPUT'} or not component_code:
        raise BusinessRuleError('Record adjustment direction, component and reason.')
    if original_return and original_return.organisation_id!=organisation.id:raise BusinessRuleError('Original return is unavailable.')
    account=valid_account(organisation,account_id,direction);counter=valid_account(organisation,counter_account_id)
    if account.pk==counter.pk:raise BusinessRuleError('Adjustment control and counterpart accounts must differ.')
    if not TaxAccountMapping.objects.filter(organisation=organisation,account=account,version__code__family='INDIRECT').exists():
        raise BusinessRuleError('Choose a mapped indirect-tax control account.')
    amount=money(amount)
    if not amount:raise BusinessRuleError('Enter a nonzero signed adjustment amount.')
    credit=(direction=='OUTPUT')==(amount>0);absolute=abs(amount)
    journal=create_journal_entry(organisation=organisation,date=point,description='Tax adjustment: '+reason[:200],reference=component_code,
        source_type='manual',user=user,lines=[{'account':account,'description':reason[:200],'debit':0 if credit else absolute,'credit':absolute if credit else 0},
            {'account':counter,'description':reason[:200],'debit':absolute if credit else 0,'credit':0 if credit else absolute}])
    post_journal_entry(journal_entry=journal,user=user)
    obj=TaxAdjustment.objects.create(organisation=organisation,created_by=user,period=period,original_return=original_return,component_code=component_code,direction=direction,amount=amount,account=account,journal=journal,reason=reason,idempotency_key=idempotency_key,payload_checksum=checksum)
    audit(organisation,user,'TAX_ADJUSTMENT_POSTED',obj,reason,after={'journal':str(journal.pk),'amount':str(amount),'original_return':str(original_return.pk) if original_return else None})
    return obj


def period_payments(tax_return):
    return TaxPayment.objects.filter(organisation=tax_return.organisation,tax_return__period=tax_return.period,tax_return__kind=tax_return.kind,journal__status='posted')


@ledger_transaction
def reverse_tax_payment(*,organisation,user,payment,point,reason):
    """Preserve the remittance; correct cash and every allocation in an open period."""
    from apps.accounting.models import AccountingCorrection
    from apps.accounting.services.journals import reverse_journal_entry
    from apps.banking.models import BankTransaction
    permit(organisation,user,'record_tax_payment');permit(organisation,user,'reverse_journal')
    payment=TaxPayment.objects.select_for_update().select_related('journal','tax_return').get(organisation=organisation,pk=payment.pk)
    if not reason.strip() or point<payment.payment_date:raise BusinessRuleError('Provide a reason and a reversal date no earlier than the payment.')
    prior=AccountingCorrection.objects.filter(organisation=organisation,source_id=payment.pk,operation='tax_payment').first()
    if prior:return prior
    if TaxPeriod.objects.filter(organisation=organisation,start_date__lte=point,end_date__gte=point,status__in=['FILED','LOCKED']).exists():raise BusinessRuleError('Reverse tax settlement in an open tax period.')
    if BankTransaction.objects.filter(organisation=organisation,accounting_journal=payment.journal,status='reconciled').exists():raise BusinessRuleError('Unreconcile this tax payment through its bank reconciliation first.')
    reversal=reverse_journal_entry(payment.journal,user,point,source_workflow=True)
    correction=AccountingCorrection.objects.create(organisation=organisation,source_id=payment.pk,operation='tax_payment',reversal_journal=reversal,reason=reason,performed_by=user)
    # The filed calculation and acknowledgement stay intact; only settlement status changes.
    for tax_return in TaxReturnDraft.objects.select_for_update().filter(organisation=organisation,period=payment.tax_return.period,kind=payment.tax_return.kind,status='PAID'):
        tax_return.status='FILED';tax_return.save(update_fields=['status'])
    audit(organisation,user,'TAX_PAYMENT_REVERSED',payment,reason,after={'reversal_journal':str(reversal.pk),'date':point,'correction':str(correction.pk)})
    return correction


def settlement_controls(tax_return):
    controls={key:money(value) for key,value in tax_return.snapshot.get('controls',{}).items()
              if money(value) and (tax_return.kind=='VAT' or money(value)>0)}
    from apps.accounting.models import JournalLine
    for line in JournalLine.objects.filter(journal_entry__organisation=tax_return.organisation,
            journal_entry__in=period_payments(tax_return).values('journal'),account_id__in=controls):
        controls[str(line.account_id)]-=line.debit-line.credit
    return controls


@ledger_transaction
def post_payment(*,organisation,user,tax_return,point,account_id=None,bank_account_id,amount,reference,allocations=None,idempotency_key=None):
    permit(organisation,user,'record_tax_payment')
    tax_return=TaxReturnDraft.objects.select_for_update().get(organisation=organisation,pk=tax_return.pk)
    previous,idempotency_key,checksum=previous_request(TaxPayment,organisation,idempotency_key,
        {'return':str(tax_return.pk),'date':point,'account':str(account_id),'bank':str(bank_account_id),'amount':str(money(amount)),
         'reference':reference,'allocations':allocations})
    if previous:return previous
    if TaxReturnDraft.objects.filter(organisation=organisation,period=tax_return.period,kind=tax_return.kind,revision__gt=tax_return.revision,status__in=['APPROVED','EXPORTED','FILED','PAID']).exists():raise BusinessRuleError('Settle the latest approved return revision.')
    if tax_return.status not in {'FILED','PAID'}:raise BusinessRuleError('Record the actual filing acknowledgement before settling this return.')
    if not reference.strip():raise BusinessRuleError('A tax payment/refund reference is required.')
    if TaxPeriod.objects.filter(organisation=organisation,start_date__lte=point,end_date__gte=point,status__in=['FILED','LOCKED']).exists():raise BusinessRuleError('Record settlement in an open tax period.')
    amount=money(amount)
    target=money(tax_return.snapshot.get('net_payable',tax_return.snapshot.get('payable',0)))
    paid=sum(period_payments(tax_return).values_list('amount',flat=True),Decimal('0'))
    remaining=target-paid
    if (amount and (amount*remaining<=0 or abs(amount)>abs(remaining))) or (not amount and (remaining or period_payments(tax_return).exists())):
        raise BusinessRuleError('Use a signed amount within the unsettled approved return: positive payment, negative refund.')
    bank=valid_account(organisation,bank_account_id) if amount else None
    if bank and (bank.account_class!='bank' or bank.currency!=organisation.base_currency):
        raise BusinessRuleError('Tax settlement currently needs a base-currency bank account.')
    controls=settlement_controls(tax_return)
    if not controls:raise BusinessRuleError('This return lacks reviewed control allocations. Prepare a reviewed amendment before settlement.')
    if allocations is None:allocations=[{'account_id':str(account_id),'amount':str(abs(amount))}]
    if not isinstance(allocations,list) or not allocations:raise BusinessRuleError('Review the tax-control allocations before settlement.')
    seen=set();lines=[];net=Decimal('0')
    for allocation in allocations:
        key=str(allocation.get('account_id',''));value=money(allocation.get('amount'))
        if key in seen or key not in controls or value<=0 or value>abs(controls[key]):
            raise BusinessRuleError('Each control allocation must be unique, positive and within its unsettled reviewed balance.')
        seen.add(key);control=valid_account(organisation,key)
        debit=controls[key]>0
        signed=value if debit else -value
        controls[key]-=signed;net+=signed
        lines.append({'account':control,'description':reference,'debit':value if debit else 0,'credit':0 if debit else value})
    if money(net)!=amount:raise BusinessRuleError('Control debits less control credits must equal the signed bank payment/refund.')
    if paid+amount==target and any(controls.values()):
        raise BusinessRuleError('Final settlement must clear every reviewed tax control, including recoverable input tax and withholding credits.')
    if amount:lines.append({'account':bank,'description':reference,'debit':abs(amount) if amount<0 else 0,'credit':amount if amount>0 else 0})
    journal=create_journal_entry(organisation=organisation,date=point,description='Tax return settlement',reference=reference,user=user,source_type='manual',lines=lines)
    post_journal_entry(journal_entry=journal,user=user)
    obj=TaxPayment.objects.create(organisation=organisation,created_by=user,tax_return=tax_return,payment_date=point,amount=amount,reference=reference,journal=journal,idempotency_key=idempotency_key,payload_checksum=checksum)
    if paid+amount==target:tax_return.status='PAID';tax_return.save(update_fields=['status'])
    audit(organisation,user,'TAX_PAYMENT_RECORDED',obj,reference,after={'journal':str(journal.pk),'amount':str(amount),'allocations':allocations})
    return obj


@ledger_transaction
def map_controls(*,organisation,user,mappings,confirmed=False):
    permit(organisation,user,'map_tax_accounts')
    if not confirmed:raise BusinessRuleError('Confirm creation of missing tax controls after reviewing the chart of accounts.')
    from .presets import CONTROL_ROLES
    result={}
    for role in CONTROL_ROLES:
        asset=role.startswith('INPUT_') or role in {'WHT_RECEIVABLE','VAT_WHT_CREDIT'}
        kind='asset' if asset else 'liability'
        if mappings.get(role):
            result[role]=str(valid_account(organisation,mappings[role],'INPUT' if asset else 'OUTPUT').pk);continue
        code='TX-'+role
        existing=Account.objects.filter(organisation=organisation,code=code).first()
        if existing:
            result[role]=str(valid_account(organisation,existing.pk,'INPUT' if asset else 'OUTPUT').pk);continue
        account=Account.objects.create(organisation=organisation,created_by=user,code=code,name=role.replace('_',' ').title(),account_type=kind,account_class='current_asset' if asset else 'current_liability',currency=organisation.base_currency)
        result[role]=str(account.pk)
    audit(organisation,user,'CONTROL_ACCOUNTS_MAPPED',reason='Reviewed mapping/create missing controls',before=mappings,after=result)
    return result
