"""Approve a supplier bill and post expense, inventory, tax, and payable entries."""

from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from common.exceptions import BusinessRuleError

from apps.accounting.models import Account, JournalEntry
from apps.accounting.services.journals import (
    create_journal_entry,
    post_journal_entry,
)
from apps.purchases.models import Bill
from apps.organisations.permissions import APPROVE_BILL
from apps.organisations.services import require_organisation_permission
from apps.tax.models import TaxTransaction
from apps.tax.services.ledger_service import record_tax_transactions
from apps.fx.services import convert_amount

from .helpers import money


@transaction.atomic
def approve_bill(
    *,
    bill,
    user,
):
    bill = (
        Bill.objects
        .select_for_update()
        .select_related(
            "organisation",
            "supplier",
        )
        .prefetch_related(
            "lines__expense_account",
            "lines__inventory_receipt",
            "lines__tax_rate_config__input_tax_account",
        )
        .get(pk=bill.pk)
    )
    require_organisation_permission(
        organisation=bill.organisation, user=user, permission=APPROVE_BILL,
    )
    if bill.organisation.require_separate_approver and bill.created_by_id == user.id:
        raise BusinessRuleError("You cannot approve a transaction you created.")

    if bill.status not in {
        Bill.Status.DRAFT,
        Bill.Status.AWAITING_APPROVAL,
    }:
        raise BusinessRuleError(
            "Only draft or awaiting approval bills can be approved."
        )

    if bill.accounting_journal_id:
        raise BusinessRuleError(
            "This bill already has an accounting journal."
        )

    if bill.total <= Decimal("0.00"):
        raise BusinessRuleError(
            "Bill total must be greater than zero."
        )

    lines = list(
        bill.lines.all()
    )

    if not lines:
        raise BusinessRuleError(
            "A bill must contain at least one line before approval."
        )

    payable_accounts = Account.objects.filter(
        organisation=bill.organisation,
        account_class=Account.AccountClass.PAYABLE,
        status=Account.Status.ACTIVE,
    )

    payable_count = payable_accounts.count()

    if payable_count == 0:
        raise BusinessRuleError(
            "The organisation does not have an active "
            "Accounts Payable account."
        )

    if payable_count > 1:
        raise BusinessRuleError(
            "The organisation has more than one active "
            "Accounts Payable account."
        )

    payable_account = payable_accounts.get()

    expense_totals = {}

    for line in lines:
        account = line.expense_account

        if account.organisation_id != bill.organisation_id:
            raise BusinessRuleError(
                f"Expense account {account.code} does not "
                f"belong to this organisation."
            )

        if account.status != Account.Status.ACTIVE:
            raise BusinessRuleError(
                f"Expense account {account.code} is not active."
            )

        if line.inventory_receipt_id:
            receipt = line.inventory_receipt
            if receipt.organisation_id != bill.organisation_id:
                raise BusinessRuleError("Inventory receipt belongs to another organisation.")
            if receipt.debit_credit_account_id != account.id:
                raise BusinessRuleError("Bill GRNI account differs from its purchase receipt.")
        elif account.account_type != Account.AccountType.EXPENSE:
            raise BusinessRuleError(
                f"Account {account.code} is not an expense account."
            )

        rate = line.tax_rate_config
        if line.tax_amount and rate is None:
            raise BusinessRuleError("Taxed bill lines require a configured tax rate.")
        expense_amount = money(line.line_total - line.tax_amount)
        if line.tax_amount and not rate.recoverable:
            expense_amount = money(expense_amount + line.tax_amount)

        if account.id not in expense_totals:
            expense_totals[account.id] = {
                "account": account,
                "amount": Decimal("0.00"),
            }

        expense_totals[account.id]["amount"] += expense_amount

    journal_lines = []

    total_expense = Decimal("0.00")

    for item in expense_totals.values():
        amount = money(
            item["amount"]
        )

        total_expense += amount

        journal_lines.append(
            {
                "account": item["account"],
                "description": (
                    f"Bill cost/GRNI - {bill.bill_number}"
                ),
                "debit": convert_amount(amount=amount, rate=bill.exchange_rate),
                "credit": Decimal("0.00"),
            }
        )

    total_expense = money(total_expense)

    nonrecoverable = money(sum((line.tax_amount for line in lines
                                if line.tax_rate_config and not line.tax_rate_config.recoverable), Decimal("0.00")))
    if total_expense != money(bill.subtotal + nonrecoverable):
        raise BusinessRuleError(
            "Bill expense total does not match the bill subtotal."
        )

    tax_totals = {}
    for line in lines:
        rate = line.tax_rate_config
        if not line.tax_amount or not rate.recoverable:
            continue
        account = rate.input_tax_account
        if account is None or account.organisation_id != bill.organisation_id or account.status != Account.Status.ACTIVE:
            raise BusinessRuleError("Recoverable purchase tax requires a valid input tax account.")
        tax_totals.setdefault(account.id, [account, Decimal("0.00")])[1] += line.tax_amount
    for account, amount in tax_totals.values():
        journal_lines.append({"account": account, "description": f"Input tax - Bill {bill.bill_number}",
                              "debit": convert_amount(amount=amount, rate=bill.exchange_rate), "credit": Decimal("0.00")})

    journal_lines.append(
        {
            "account": payable_account,
            "description": (
                f"Bill {bill.bill_number} "
                f"- {bill.supplier.name}"
            ),
            "debit": Decimal("0.00"),
            "credit": convert_amount(amount=bill.total, rate=bill.exchange_rate),
        }
    )

    journal = create_journal_entry(
        organisation=bill.organisation,
        date=bill.issue_date,
        description=(
            f"Bill {bill.bill_number} "
            f"- {bill.supplier.name}"
        ),
        lines=journal_lines,
        user=user,
        reference=bill.bill_number,
        source_type=JournalEntry.SourceType.BILL,
        source_id=bill.id,
    )
    journal.transaction_currency=bill.currency;journal.transaction_amount=bill.total;journal.exchange_rate=bill.exchange_rate
    journal.save(update_fields=["transaction_currency","transaction_amount","exchange_rate"])

    post_journal_entry(
        journal_entry=journal,
        user=user,
    )
    recoverable_lines = [line for line in lines if line.tax_rate_config and line.tax_rate_config.recoverable]
    record_tax_transactions(document=bill, lines=recoverable_lines, journal_entry=journal,
                            source_type="bill", direction=TaxTransaction.Direction.INPUT,
                            document_number=bill.bill_number, contact=bill.supplier)

    bill.accounting_journal = journal
    bill.status = Bill.Status.APPROVED
    bill.approved_at = timezone.now()
    bill.approved_by = user

    bill.save(
        update_fields=[
            "accounting_journal",
            "status",
            "approved_at",
            "approved_by",
            "updated_at",
        ]
    )

    return bill
