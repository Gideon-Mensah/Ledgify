from decimal import Decimal

from django.db import models
from django.db.models import Sum

from common.exceptions import BusinessRuleError
from apps.accounting.models import LEDGER_EFFECTIVE_JOURNAL_STATUSES
from apps.banking.models import BankAccount, BankTransaction


ZERO = Decimal("0.00")


def get_reconciliation_summary(*, organisation, bank_account, reconciliation_date):
    """Return comparable ledger and statement balances at one explicit date."""
    bank_account = (
        BankAccount.objects.filter(organisation=organisation, pk=bank_account.pk)
        .select_related("ledger_account")
        .first()
    )
    if bank_account is None:
        raise BusinessRuleError("Bank account was not found.")
    if not bank_account.ledger_account_id:
        raise BusinessRuleError("This bank account is not linked to a ledger account.")
    if bank_account.ledger_account.organisation_id != organisation.id:
        raise BusinessRuleError("The linked ledger account belongs to another organisation.")

    ledger_totals = bank_account.ledger_account.journal_lines.filter(
        journal_entry__organisation=organisation,
        journal_entry__status__in=LEDGER_EFFECTIVE_JOURNAL_STATUSES,
        journal_entry__date__lte=reconciliation_date,
    ).aggregate(debit=Sum("debit"), credit=Sum("credit"))
    book_balance = (ledger_totals["debit"] or ZERO) - (ledger_totals["credit"] or ZERO)

    statement_rows = bank_account.transactions.filter(
        organisation=organisation,
        transaction_date__lte=reconciliation_date,
    )
    statement_totals = statement_rows.aggregate(
        money_in=Sum("amount", filter=models.Q(transaction_type=BankTransaction.TransactionType.MONEY_IN)),
        money_out=Sum("amount", filter=models.Q(transaction_type=BankTransaction.TransactionType.MONEY_OUT)),
    )
    statement_available = bool(
        statement_rows.exists()
        or (
            bank_account.opening_balance_date
            and bank_account.opening_balance_date <= reconciliation_date
        )
    )
    statement_balance = None
    difference = None
    if statement_available:
        statement_balance = bank_account.opening_balance + (statement_totals["money_in"] or ZERO) - (statement_totals["money_out"] or ZERO)
        difference = statement_balance - book_balance

    unreconciled = statement_rows.filter(status=BankTransaction.Status.UNRECONCILED).count()
    total = statement_rows.exclude(status=BankTransaction.Status.IGNORED).count()
    reconciled = statement_rows.filter(status=BankTransaction.Status.RECONCILED).count()
    latest = statement_rows.filter(status=BankTransaction.Status.RECONCILED, reconciled_at__isnull=False).order_by("-reconciled_at").first()

    return {
        "bank_account": {
            "id": str(bank_account.id), "name": bank_account.name,
            "currency": bank_account.currency,
            "ledger_account": {
                "id": str(bank_account.ledger_account_id),
                "code": bank_account.ledger_account.code,
                "name": bank_account.ledger_account.name,
            },
        },
        "reconciliation_date": reconciliation_date,
        "book_balance": book_balance,
        "statement_balance": statement_balance,
        "statement_balance_available": statement_available,
        "difference": difference,
        "unreconciled_count": unreconciled,
        "reconciled_count": reconciled,
        "transaction_count": total,
        "last_reconciled_at": latest.reconciled_at if latest else None,
        "complete": statement_available and difference == ZERO and unreconciled == 0,
        "difference_convention": "statement_balance_minus_book_balance",
    }
