"""Summarise posted tax transactions for periods and return previews."""

from decimal import Decimal
from django.db.models import Sum
from apps.tax.models import TaxTransaction
from apps.accounting.models import JournalLine, LEDGER_EFFECTIVE_JOURNAL_STATUSES


def tax_summary(*, organisation, **filters):
    from .register_service import tax_register
    return tax_register(organisation=organisation, **filters)["summary"]


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
