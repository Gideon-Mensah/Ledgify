"""Approve a customer credit and reverse the appropriate revenue and tax amounts."""

from decimal import Decimal
from django.db import transaction
from django.utils import timezone
from common.exceptions import BusinessRuleError
from apps.accounting.models import Account, JournalEntry
from apps.accounting.services.journals import create_journal_entry, post_journal_entry
from apps.sales.models import CustomerCreditNote
from apps.organisations.permissions import APPROVE_CUSTOMER_CREDIT
from apps.organisations.services import require_organisation_permission
from apps.tax.models import TaxTransaction
from apps.tax.services.ledger_service import record_tax_transactions
from apps.fx.services import convert_amount
from .helpers import money


@transaction.atomic
def approve_customer_credit_note(*, credit_note, user):
    credit_note = CustomerCreditNote.objects.select_for_update().select_related(
        "organisation", "customer").prefetch_related("lines__revenue_account", "lines__tax_rate_config__output_tax_account").get(pk=credit_note.pk)
    require_organisation_permission(organisation=credit_note.organisation, user=user,
                                    permission=APPROVE_CUSTOMER_CREDIT)
    if (credit_note.organisation.require_separate_approver
            and credit_note.created_by_id == user.id):
        raise BusinessRuleError("You cannot approve a transaction you created.")
    if credit_note.status not in {credit_note.Status.DRAFT, credit_note.Status.AWAITING_APPROVAL}:
        raise BusinessRuleError("Only draft credits can be approved.")
    if credit_note.accounting_journal_id or credit_note.total <= 0:
        raise BusinessRuleError("Credit note cannot be approved.")
    receivables = Account.objects.filter(organisation=credit_note.organisation,
        account_class=Account.AccountClass.RECEIVABLE, status=Account.Status.ACTIVE)
    if receivables.count() != 1:
        raise BusinessRuleError("The organisation must have exactly one active Accounts Receivable account.")
    totals = {}
    for line in credit_note.lines.all():
        account = line.revenue_account
        if account.organisation_id != credit_note.organisation_id or account.status != Account.Status.ACTIVE or account.account_type != Account.AccountType.REVENUE:
            raise BusinessRuleError("Credit note contains an invalid revenue account.")
        totals.setdefault(account.id, [account, Decimal("0.00")])[1] += money(line.line_total - line.tax_amount)
    journal_lines = [{"account": item[0], "description": f"Credit {credit_note.credit_note_number}",
                      "debit": convert_amount(amount=item[1],rate=credit_note.exchange_rate), "credit": Decimal("0.00")} for item in totals.values()]
    tax_totals = {}
    for line in credit_note.lines.all():
        if not line.tax_amount: continue
        rate = line.tax_rate_config
        if not rate or not rate.output_tax_account:
            raise BusinessRuleError("Taxed credit lines require a configured output tax account.")
        account = rate.output_tax_account
        if account.organisation_id != credit_note.organisation_id or account.status != Account.Status.ACTIVE:
            raise BusinessRuleError("Output tax account is invalid.")
        tax_totals.setdefault(account.id, [account, Decimal("0.00")])[1] += line.tax_amount
    journal_lines.extend({"account": item[0], "description": f"Output tax reversal - {credit_note.credit_note_number}",
                          "debit": convert_amount(amount=item[1],rate=credit_note.exchange_rate), "credit": Decimal("0.00")} for item in tax_totals.values())
    journal_lines.append({"account": receivables.get(), "description": f"Credit {credit_note.credit_note_number}",
                          "debit": Decimal("0.00"), "credit": convert_amount(amount=credit_note.total,rate=credit_note.exchange_rate)})
    journal = create_journal_entry(organisation=credit_note.organisation, date=credit_note.issue_date,
        description=f"Customer credit {credit_note.credit_note_number} - {credit_note.customer.name}",
        lines=journal_lines, user=user, reference=credit_note.credit_note_number,
        source_type=JournalEntry.SourceType.CUSTOMER_CREDIT, source_id=credit_note.id)
    post_journal_entry(journal_entry=journal, user=user)
    record_tax_transactions(document=credit_note, lines=list(credit_note.lines.all()), journal_entry=journal,
                            source_type="customer_credit", direction=TaxTransaction.Direction.OUTPUT,
                            document_number=credit_note.credit_note_number, contact=credit_note.customer)
    credit_note.accounting_journal = journal; credit_note.status = credit_note.Status.APPROVED
    credit_note.approved_at = timezone.now(); credit_note.approved_by = user
    credit_note.save(update_fields=["accounting_journal", "status", "approved_at",
                                    "approved_by", "updated_at"])
    return credit_note
