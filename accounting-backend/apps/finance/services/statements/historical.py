"""Statements follow immutable base-currency control lines and dated reversals."""
from decimal import Decimal
from django.db.models import Q
from django.utils import timezone
from common.exceptions import BusinessRuleError
from common.ledger_integrity import ledger_transaction
from apps.accounting.models import JournalLine,LEDGER_EFFECTIVE_JOURNAL_STATUSES
from apps.finance.services.aging.historical import historical_aging


@ledger_transaction
def historical_statement(*,organisation,contact,start_date=None,end_date=None,payable=False):
    if contact.organisation_id!=organisation.pk or not getattr(contact,"is_supplier" if payable else "is_customer"):
        raise BusinessRuleError("Contact does not belong to the requested organisation and subledger.")
    end_date=end_date or timezone.localdate()
    if start_date and end_date<start_date:raise BusinessRuleError("End date cannot precede start date.")
    if payable:
        from apps.purchases.models import Bill, SupplierPayment, SupplierCredit, SupplierRefund, SupplierPaymentAllocation, SupplierCreditAllocation
        models=[(Bill,"bill","supplier"),(SupplierPayment,"payment","supplier"),(SupplierCredit,"credit_note","supplier"),(SupplierRefund,"refund","supplier")]
        allocations=[(SupplierPaymentAllocation,"bill__supplier"),(SupplierCreditAllocation,"bill__supplier")]
        party="supplier"
    else:
        from apps.sales.models import Invoice,CustomerPayment,CustomerCreditNote,CustomerRefund,BadDebtWriteOff,CustomerPaymentAllocation,CustomerCreditAllocation
        models=[(Invoice,"invoice","customer"),(CustomerPayment,"payment","customer"),(CustomerCreditNote,"credit_note","customer"),(CustomerRefund,"refund","customer"),(BadDebtWriteOff,"bad_debt_write_off","invoice__customer")]
        allocations=[(CustomerPaymentAllocation,"invoice__customer"),(CustomerCreditAllocation,"invoice__customer")]
        party="customer"
    journal_types={}
    for model,kind,field in models:
        for pk in model.objects.filter(organisation=organisation,**{field:contact}).exclude(accounting_journal=None).values_list("accounting_journal_id",flat=True):journal_types[pk]=kind
    allocation_ids=[]
    for model,field in allocations:
        allocation_ids.extend(model.objects.filter(organisation=organisation,**{field:contact}).values_list("pk",flat=True))
    lines=JournalLine.objects.filter(journal_entry__organisation=organisation,account__organisation=organisation,
        account__account_class="payable" if payable else "receivable",journal_entry__status__in=LEDGER_EFFECTIVE_JOURNAL_STATUSES,
        journal_entry__date__lte=end_date).filter(Q(journal_entry_id__in=journal_types)|Q(journal_entry__reversal_of_id__in=journal_types)|Q(journal_entry__source_id__in=allocation_ids)).select_related("journal_entry").order_by("journal_entry__date","journal_entry__entry_number","pk")
    opening=balance=Decimal("0.00");transactions=[];documents_total=payments_total=Decimal("0.00")
    for line in lines:
        journal=line.journal_entry
        change=line.credit-line.debit if payable else line.debit-line.credit
        balance+=change
        if start_date and journal.date<start_date:
            opening+=change;continue
        kind=journal_types.get(journal.reversal_of_id or journal.pk,"fx_settlement")
        if journal.reversal_of_id:kind="reversal"
        transactions.append({"type":kind,"id":str(line.pk),"journal_id":str(journal.pk),"date":journal.date,
            "reference":journal.reference,"description":journal.description,"currency":organisation.base_currency,
            "debit":line.debit,"credit":line.credit,"balance":balance})
        if kind in ("invoice","bill"):documents_total+=change
        if kind=="payment":payments_total-=change
    aging=historical_aging(organisation=organisation,as_of_date=end_date,payable=payable,contact=contact)
    return {party:{"id":str(contact.pk),"name":contact.name,"account_number":contact.account_number},
        "start_date":start_date,"end_date":end_date,"currency":organisation.base_currency,
        "opening_balance":opening,"transactions":transactions,"closing_balance":balance,
        "period_bills" if payable else "period_invoices":documents_total,"period_payments":payments_total,
        "currency_totals":aging["currency_totals"],"exchange_rate_policy":aging["exchange_rate_policy"]}
