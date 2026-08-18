"""Code an unmatched bank transaction and post one balanced accounting journal."""

from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from common.exceptions import BusinessRuleError

from apps.accounting.models import Account, JournalEntry
from apps.accounting.services.journals import (
    create_journal_entry,
    post_journal_entry,
)
from apps.banking.models import BankReconciliationHistory, BankTransaction
from apps.organisations.permissions import RECONCILE_BANK
from apps.organisations.services import require_organisation_permission


@transaction.atomic
def reconcile_bank_transaction_to_account(
    *,
    bank_transaction,
    target_account,
    user,
):
    bank_transaction = (
        BankTransaction.objects
        .select_for_update()
        .select_related(
            "organisation",
            "bank_account",
            "bank_account__ledger_account",
        )
        .get(pk=bank_transaction.pk)
    )
    require_organisation_permission(
        organisation=bank_transaction.organisation,
        user=user,
        permission=RECONCILE_BANK,
    )

    if bank_transaction.status != BankTransaction.Status.UNRECONCILED:
        raise BusinessRuleError(
            "Only unreconciled bank transactions can be reconciled."
        )

    if bank_transaction.accounting_journal_id:
        raise BusinessRuleError(
            "This bank transaction already has an accounting journal."
        )

    if target_account.organisation_id != bank_transaction.organisation_id:
        raise BusinessRuleError(
            "The target account does not belong to this organisation."
        )

    if target_account.status != Account.Status.ACTIVE:
        raise BusinessRuleError(
            f"Account {target_account.code} is not active."
        )

    if target_account.account_class in {
        Account.AccountClass.RECEIVABLE,
        Account.AccountClass.PAYABLE,
    }:
        raise BusinessRuleError(
            "Receivable and payable control accounts cannot be used for cash "
            "coding. Match the bank transaction to the customer or supplier "
            "payment instead."
        )

    bank_ledger_account = bank_transaction.bank_account.ledger_account

    if bank_ledger_account.organisation_id != bank_transaction.organisation_id:
        raise BusinessRuleError(
            "The bank ledger account belongs to another organisation."
        )

    if bank_ledger_account.status != Account.Status.ACTIVE:
        raise BusinessRuleError(
            "The bank ledger account is not active."
        )

    amount = bank_transaction.amount

    if (
        bank_transaction.transaction_type
        == BankTransaction.TransactionType.MONEY_IN
    ):
        journal_lines = [
            {
                "account": bank_ledger_account,
                "description": bank_transaction.description,
                "debit": amount,
                "credit": Decimal("0.00"),
            },
            {
                "account": target_account,
                "description": bank_transaction.description,
                "debit": Decimal("0.00"),
                "credit": amount,
            },
        ]

    else:
        journal_lines = [
            {
                "account": target_account,
                "description": bank_transaction.description,
                "debit": amount,
                "credit": Decimal("0.00"),
            },
            {
                "account": bank_ledger_account,
                "description": bank_transaction.description,
                "debit": Decimal("0.00"),
                "credit": amount,
            },
        ]

    journal = create_journal_entry(
        organisation=bank_transaction.organisation,
        date=bank_transaction.transaction_date,
        description=bank_transaction.description,
        reference=(
            bank_transaction.reference
            or bank_transaction.external_id
            or str(bank_transaction.id)
        ),
        source_type=JournalEntry.SourceType.BANK,
        source_id=bank_transaction.id,
        user=user,
        lines=journal_lines,
    )

    post_journal_entry(
        journal_entry=journal,
        user=user,
    )

    bank_transaction.accounting_journal = journal
    bank_transaction.status = BankTransaction.Status.RECONCILED
    bank_transaction.reconciliation_type = "manual_account"
    bank_transaction.reconciliation_object_id = target_account.id
    bank_transaction.reconciled_by = user

    bank_transaction.reconciled_at = timezone.now()

    bank_transaction.save(
        update_fields=[
            "accounting_journal",
            "status",
            "reconciliation_type",
            "reconciliation_object_id",
            "reconciled_by",
            "reconciled_at",
            "updated_at",
        ]
    )

    BankReconciliationHistory.objects.create(
        organisation=bank_transaction.organisation,
        bank_transaction=bank_transaction,
        action=BankReconciliationHistory.Action.RECONCILED,
        reconciliation_type="manual_account",
        reconciliation_object_id=target_account.id,
        accounting_journal=journal,
        performed_by=user,
        metadata={"target_account_id": str(target_account.id)},
    )

    return bank_transaction
