"""Summarise posted tax transactions for periods and return previews."""

from decimal import Decimal
from django.db.models import Sum
from apps.tax.models import TaxTransaction
from apps.accounting.models import JournalLine, LEDGER_EFFECTIVE_JOURNAL_STATUSES


def tax_summary(*, organisation, start_date=None, end_date=None):
    qs = TaxTransaction.objects.filter(organisation=organisation)
    if start_date: qs = qs.filter(transaction_date__gte=start_date)
    if end_date: qs = qs.filter(transaction_date__lte=end_date)
    def total(direction, field, credit=False):
        rows = qs.filter(direction=direction)
        base = rows.exclude(source_type__in=["customer_credit", "supplier_credit"])
        credits = rows.filter(source_type__in=["customer_credit", "supplier_credit"])
        return (base.aggregate(v=Sum(field))["v"] or Decimal("0.00")) - (credits.aggregate(v=Sum(field))["v"] or Decimal("0.00"))
    sales_net = total("OUTPUT", "net_amount")
    output_tax = total("OUTPUT", "tax_amount")
    purchase_net = total("INPUT", "net_amount")
    input_tax = total("INPUT", "tax_amount")
    credit_adjustments = qs.filter(source_type__in=["customer_credit", "supplier_credit"]).aggregate(v=Sum("tax_amount"))["v"] or Decimal("0.00")
    return {"sales_net": sales_net, "output_tax": output_tax, "purchase_net": purchase_net,
            "input_tax": input_tax, "credit_adjustments": credit_adjustments,
            "net_tax_due_or_refundable": output_tax - input_tax}


tax_return_preview = tax_summary


def tax_liability(*, organisation, start_date=None, end_date=None):
    summary = tax_summary(organisation=organisation, start_date=start_date, end_date=end_date)
    transactions = TaxTransaction.objects.filter(organisation=organisation)
    if start_date: transactions = transactions.filter(transaction_date__gte=start_date)
    if end_date: transactions = transactions.filter(transaction_date__lte=end_date)
    account_ids = transactions.values_list("tax_account_id", flat=True).distinct()
    lines = JournalLine.objects.filter(
        journal_entry__organisation=organisation,
        journal_entry__status__in=LEDGER_EFFECTIVE_JOURNAL_STATUSES,
        account_id__in=account_ids,
    )
    if start_date: lines = lines.filter(journal_entry__date__gte=start_date)
    if end_date: lines = lines.filter(journal_entry__date__lte=end_date)
    values = lines.aggregate(debits=Sum("debit"), credits=Sum("credit"))
    gl_net_credit = (values["credits"] or Decimal("0.00")) - (values["debits"] or Decimal("0.00"))
    subledger_net = summary["net_tax_due_or_refundable"]
    return {**summary, "subledger_net": subledger_net, "gl_net_credit": gl_net_credit,
            "reconciliation_difference": gl_net_credit - subledger_net,
            "reconciled": gl_net_credit == subledger_net}
