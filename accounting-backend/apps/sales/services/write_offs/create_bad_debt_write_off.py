"""Write off an authorised unpaid invoice balance through an auditable journal."""

from decimal import Decimal

from django.db import transaction

from common.exceptions import BusinessRuleError
from apps.accounting.models import Account, JournalEntry
from apps.accounting.services.journals import create_journal_entry, post_journal_entry
from apps.sales.models import BadDebtWriteOff, Invoice
from apps.organisations.permissions import CREATE_BAD_DEBT_WRITE_OFF
from apps.organisations.services import require_organisation_permission


@transaction.atomic
def create_bad_debt_write_off(*, organisation, invoice, write_off_date, amount,
                              bad_debt_account, user, reason="", reference=""):
    require_organisation_permission(
        organisation=organisation, user=user,
        permission=CREATE_BAD_DEBT_WRITE_OFF,
    )
    invoice = Invoice.objects.select_for_update().select_related("customer").get(pk=invoice.pk)
    if invoice.organisation_id != organisation.id:
        raise BusinessRuleError("Invoice does not belong to this organisation.")
    if invoice.status not in {
        Invoice.Status.APPROVED, Invoice.Status.SENT, Invoice.Status.PARTLY_PAID,
    }:
        raise BusinessRuleError("Invoice is not available for write-off.")
    try:
        amount = Decimal(str(amount))
    except (ValueError, TypeError, ArithmeticError) as error:
        raise BusinessRuleError("Write-off amount is invalid.") from error
    if amount <= 0 or amount > invoice.amount_due:
        raise BusinessRuleError("Write-off amount exceeds the outstanding balance.")
    if (bad_debt_account.organisation_id != organisation.id
            or bad_debt_account.status != Account.Status.ACTIVE
            or bad_debt_account.account_type != Account.AccountType.EXPENSE):
        raise BusinessRuleError("A valid active expense account is required.")
    receivables = Account.objects.filter(
        organisation=organisation, account_class=Account.AccountClass.RECEIVABLE,
        status=Account.Status.ACTIVE,
    )
    if receivables.count() != 1:
        raise BusinessRuleError(
            "The organisation must have exactly one active Accounts Receivable account."
        )
    write_off = BadDebtWriteOff.objects.create(
        organisation=organisation, invoice=invoice, write_off_date=write_off_date,
        amount=amount, reason=reason, reference=reference,
        bad_debt_account=bad_debt_account, status=BadDebtWriteOff.Status.DRAFT,
        created_by=user,
    )
    journal = create_journal_entry(
        organisation=organisation, date=write_off_date,
        description=f"Bad debt write-off - {invoice.invoice_number}",
        reference=reference or invoice.invoice_number,
        source_type=JournalEntry.SourceType.BAD_DEBT, source_id=write_off.id,
        user=user, lines=[
            {"account": bad_debt_account, "description": "Bad debt write-off",
             "debit": amount, "credit": Decimal("0.00")},
            {"account": receivables.get(), "description": "Bad debt write-off",
             "debit": Decimal("0.00"), "credit": amount},
        ],
    )
    post_journal_entry(journal_entry=journal, user=user)
    write_off.accounting_journal = journal
    write_off.status = BadDebtWriteOff.Status.POSTED
    write_off.save(update_fields=["accounting_journal", "status", "updated_at"])
    invoice.amount_written_off += amount
    if invoice.amount_due == Decimal("0.00"):
        invoice.status = Invoice.Status.WRITTEN_OFF
    invoice.save(update_fields=["amount_written_off", "status", "updated_at"])
    return write_off
