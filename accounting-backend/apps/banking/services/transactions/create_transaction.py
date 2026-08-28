from decimal import Decimal

from django.db import transaction

from common.exceptions import BusinessRuleError

from apps.banking.models import BankAccount, BankTransaction


@transaction.atomic
def create_bank_transaction(
    *,
    organisation,
    bank_account,
    transaction_date,
    description,
    transaction_type,
    amount,
    currency,
    user,
    reference="",
    external_id="",
):
    if bank_account.organisation_id != organisation.id:
        raise BusinessRuleError(
            "The bank account does not belong to this organisation."
        )

    if bank_account.status != BankAccount.Status.ACTIVE:
        raise BusinessRuleError(
            "The selected bank account is not active."
        )

    try:
        amount = Decimal(str(amount))
    except (ValueError, TypeError, ArithmeticError):
        raise BusinessRuleError(
            "Transaction amount is invalid."
        )

    if amount <= Decimal("0.00"):
        raise BusinessRuleError(
            "Transaction amount must be greater than zero."
        )

    from common.currencies import require_currency_code
    currency = require_currency_code(currency)

    if len(currency) != 3:
        raise BusinessRuleError(
            "Currency must be a 3-letter currency code."
        )

    if currency != bank_account.currency:
        raise BusinessRuleError(
            "Transaction currency must match the bank account currency."
        )

    if transaction_type not in {
        BankTransaction.TransactionType.MONEY_IN,
        BankTransaction.TransactionType.MONEY_OUT,
    }:
        raise BusinessRuleError(
            "Invalid bank transaction type."
        )

    description = str(description).strip()

    if not description:
        raise BusinessRuleError(
            "Bank transaction description is required."
        )

    if external_id:
        duplicate_exists = BankTransaction.objects.filter(
            organisation=organisation,
            bank_account=bank_account,
            external_id=external_id,
        ).exists()

        if duplicate_exists:
            raise BusinessRuleError(
                "This bank transaction has already been imported."
            )

    return BankTransaction.objects.create(
        organisation=organisation,
        bank_account=bank_account,
        transaction_date=transaction_date,
        description=description,
        reference=reference,
        transaction_type=transaction_type,
        amount=amount,
        currency=currency,
        external_id=external_id,
        status=BankTransaction.Status.UNRECONCILED,
        created_by=user,
    )
"""Create an organisation bank-statement transaction without posting accounting yet."""
