from apps.tax.document_tax import validate_document_snapshot, tax_ledger_totals, nonrecoverable
from common.rounding import balance_converted_document
from common.ledger_integrity import lock_ledger
"""Approve a supplier credit and reverse the related expense, inventory, or tax value."""

from decimal import Decimal
from django.db import transaction
from django.utils import timezone
from common.exceptions import BusinessRuleError
from apps.accounting.models import Account, JournalEntry
from apps.accounting.services.journals import create_journal_entry, post_journal_entry
from apps.purchases.models import SupplierCredit
from apps.organisations.permissions import APPROVE_SUPPLIER_CREDIT
from apps.organisations.services import require_organisation_permission
from apps.tax.models import TaxTransaction
from apps.tax.services.ledger_service import record_tax_transactions
from apps.fx.services import convert_amount
from .helpers import money


@transaction.atomic
def approve_supplier_credit(*, credit, user):
    lock_ledger(credit.organisation_id)
    credit = SupplierCredit.objects.select_for_update().select_related("organisation", "supplier").prefetch_related("lines__expense_account", "lines__tax_rate_config__input_tax_account").get(pk=credit.pk)
    require_organisation_permission(organisation=credit.organisation, user=user,
                                    permission=APPROVE_SUPPLIER_CREDIT)
    if credit.organisation.require_separate_approver and credit.created_by_id == user.id:
        raise BusinessRuleError("You cannot approve a transaction you created.")
    if credit.status not in {credit.Status.DRAFT, credit.Status.AWAITING_APPROVAL}:
        raise BusinessRuleError("Only draft supplier credits can be approved.")
    if credit.accounting_journal_id or credit.total <= 0: raise BusinessRuleError("Supplier credit cannot be approved.")
    payables = Account.objects.filter(organisation=credit.organisation,
        account_class=Account.AccountClass.PAYABLE, is_current_control=True, account_type="liability", status=Account.Status.ACTIVE)
    if payables.count() != 1: raise BusinessRuleError("The organisation must have exactly one active Accounts Payable account.")
    totals = {}
    for line in credit.lines.all():
        account = line.expense_account
        if account.organisation_id != credit.organisation_id or account.status != Account.Status.ACTIVE or account.account_type != Account.AccountType.EXPENSE:
            raise BusinessRuleError("Supplier credit contains an invalid expense account.")
        amount = line.line_total - line.tax_amount
        amount += nonrecoverable(line)
        totals.setdefault(account.id, [account, Decimal("0.00")])[1] += money(amount)
    journal_lines = [{"account": payables.get(), "description": f"Supplier credit {credit.credit_number}",
                      "debit": convert_amount(amount=credit.total,rate=credit.exchange_rate), "credit": Decimal("0.00")}]
    journal_lines.extend({"account": item[0], "description": f"Supplier credit {credit.credit_number}",
                          "debit": Decimal("0.00"), "credit": convert_amount(amount=item[1],rate=credit.exchange_rate)} for item in totals.values())
    validate_document_snapshot(credit)
    tax_totals = tax_ledger_totals(credit, list(credit.lines.all()), "INPUT")
    journal_lines.extend({"account": item[0], "description": f"Input tax reversal - {credit.credit_number}",
                          "debit": Decimal("0.00"), "credit": convert_amount(amount=item[1],rate=credit.exchange_rate)} for item in tax_totals.values())
    self_assessed = [line for line in credit.lines.all() if line.tax_snapshot.get('self_assessed')]
    for account, amount in tax_ledger_totals(credit, self_assessed, "OUTPUT").values():
        journal_lines.append({"account": account, "description": "Reverse-charge output tax credit",
                              "debit": convert_amount(amount=amount, rate=credit.exchange_rate), "credit": Decimal("0.00")})
    journal_lines = balance_converted_document(organisation=credit.organisation, currency=credit.currency, lines=journal_lines)
    journal = create_journal_entry(organisation=credit.organisation, date=credit.issue_date,
        description=f"Supplier credit {credit.credit_number} - {credit.supplier.name}", lines=journal_lines,
        user=user, reference=credit.credit_number, source_type=JournalEntry.SourceType.SUPPLIER_CREDIT,
        source_id=credit.id)
    journal.transaction_currency=credit.currency; journal.transaction_amount=credit.total; journal.exchange_rate=credit.exchange_rate
    journal.save(update_fields=["transaction_currency","transaction_amount","exchange_rate"])
    post_journal_entry(journal_entry=journal, user=user)
    recoverable_lines = list(credit.lines.all())
    record_tax_transactions(document=credit, lines=recoverable_lines, journal_entry=journal,
                            source_type="supplier_credit", direction=TaxTransaction.Direction.INPUT,
                            document_number=credit.credit_number, contact=credit.supplier)
    credit.accounting_journal = journal; credit.status = credit.Status.APPROVED
    credit.approved_at = timezone.now(); credit.approved_by = user
    credit.save(update_fields=["accounting_journal", "status", "approved_at",
                               "approved_by", "updated_at"])
    return credit
