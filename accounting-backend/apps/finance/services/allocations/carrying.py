"""Allocate exact historical carrying values; final settlement consumes residual cents."""
from decimal import Decimal
from apps.fx.services import convert_amount
from apps.accounting.models import JournalEntry
from apps.accounting.services.journals import create_journal_entry, post_journal_entry, reverse_journal_entry
from apps.fx.account_validation import validate_fx_account
ZERO=Decimal("0.00")


def control_value(document, *, payable=False):
    if not document.accounting_journal_id:return ZERO
    result=sum((line.credit-line.debit if payable else line.debit-line.credit
        for line in document.accounting_journal.lines.filter(account__account_class="payable" if payable else "receivable")),ZERO)
    return result


def carrying_slice(document, amount, *, payable=False):
    amount=Decimal(str(amount))
    if amount != document.amount_due:
        return convert_amount(amount=amount,rate=document.exchange_rate)
    used=ZERO
    for allocation in document.payment_allocations.filter(status="active"):
        used += allocation.carrying_base_amount if allocation.carrying_base_amount is not None else convert_amount(amount=allocation.amount,rate=document.exchange_rate)
    for allocation in document.credit_allocations.all():
        used += allocation.carrying_base_amount if allocation.carrying_base_amount is not None else convert_amount(amount=allocation.amount,rate=document.exchange_rate)
    if not payable:
        for row in document.write_offs.filter(status="posted"):
            used -= control_value(row)
    return control_value(document,payable=payable)-used


def source_slice(source, amount, *, payable=False, credit=False):
    amount=Decimal(str(amount))
    total=source.total if credit else source.amount
    base=-control_value(source,payable=payable)
    used=ZERO;used_amount=ZERO
    allocations=source.allocations.all() if credit else source.allocations.filter(status="active")
    for row in allocations:
        used += row.source_base_amount if row.source_base_amount is not None else convert_amount(amount=row.amount,rate=base/total)
        used_amount+=row.amount
    if credit:
        for refund in source.refunds.filter(status="posted"):
            used+=control_value(refund,payable=payable);used_amount+=refund.amount
    return base-used if amount==total-used_amount else convert_amount(amount=amount,rate=base/total)


def post_allocation_fx(*, allocation, source, document, user, payable=False, credit=False):
    organisation=document.organisation
    target=allocation.carrying_base_amount
    original=allocation.source_base_amount
    delta=(original-target)*(-1 if payable else 1)
    if not delta:return
    kind="gain" if delta>0 else "loss"
    account=organisation.fx_gain_account if delta>0 else organisation.fx_loss_account
    validate_fx_account(organisation,account,kind)
    control=source.accounting_journal.lines.get(account__account_class="payable" if payable else "receivable").account
    journal=create_journal_entry(organisation=organisation,date=allocation.effective_date,user=user,
        description="Allocation carrying-value FX settlement",source_type=JournalEntry.SourceType.FX_REALISED,source_id=allocation.pk,
        lines=[{"account":control,"debit":max(delta,ZERO),"credit":max(-delta,ZERO)},
               {"account":account,"debit":max(-delta,ZERO),"credit":max(delta,ZERO)}])
    post_journal_entry(journal,user)


def reverse_allocation_fx(*, allocation, user, date):
    for journal in JournalEntry.objects.filter(organisation=allocation.organisation,source_type=JournalEntry.SourceType.FX_REALISED,source_id=allocation.pk,status="posted",reversal_of=None):
        reverse_journal_entry(journal,user,date,check_permissions=False,source_workflow=True)


def require_revaluation_reversed(organisation, currency, *, payable=False):
    """Settlement requires the temporary revaluation to be explicitly reversed."""
    from apps.fx.models import FXRevaluation
    from common.exceptions import BusinessRuleError
    if FXRevaluation.objects.filter(organisation=organisation,foreign_currency_id=currency,
        revaluation_type="payables" if payable else "receivables",reversal_journal__isnull=True).exists():
        raise BusinessRuleError("Reverse the outstanding temporary FX revaluation before settling this currency.")
