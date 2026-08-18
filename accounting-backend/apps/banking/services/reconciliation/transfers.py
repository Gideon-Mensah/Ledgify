from datetime import timedelta

from apps.banking.models import BankTransaction
from .scoring import clamp_confidence, score_amount_match, score_date_match
from .suggestions import ReconciliationSuggestion


def find_internal_transfer_matches(*, organisation, bank_transaction):
    opposite_type = (
        BankTransaction.TransactionType.MONEY_OUT
        if bank_transaction.transaction_type == BankTransaction.TransactionType.MONEY_IN
        else BankTransaction.TransactionType.MONEY_IN
    )
    start = bank_transaction.transaction_date - timedelta(days=3)
    end = bank_transaction.transaction_date + timedelta(days=3)
    candidates = BankTransaction.objects.filter(
        organisation=organisation,
        status=BankTransaction.Status.UNRECONCILED,
        transaction_type=opposite_type,
        currency=bank_transaction.currency,
        amount=bank_transaction.amount,
        transaction_date__range=(start, end),
    ).exclude(
        id=bank_transaction.id,
    ).exclude(
        bank_account_id=bank_transaction.bank_account_id,
    ).select_related("bank_account")

    suggestions = []
    for candidate in candidates:
        date_score = score_date_match(
            bank_transaction.transaction_date,
            candidate.transaction_date,
        )
        confidence = clamp_confidence(
            score_amount_match(bank_transaction.amount, candidate.amount)
            + date_score
            + 20
        )
        suggestions.append(ReconciliationSuggestion(
            match_type="bank_transfer", object_id=str(candidate.id),
            label=f"Internal transfer - {candidate.bank_account.name}",
            amount=candidate.amount, confidence=confidence,
            reasons=[
                "Exact amount",
                "Opposite direction",
                "Different bank account",
                (
                    "Date difference: "
                    f"{abs((bank_transaction.transaction_date - candidate.transaction_date).days)} "
                    "days"
                ),
            ],
            metadata={
                "opposite_bank_transaction_id": str(candidate.id),
                "current_bank_account": bank_transaction.bank_account.name,
                "opposite_bank_account": candidate.bank_account.name,
                "date_difference": abs(
                    (bank_transaction.transaction_date - candidate.transaction_date).days
                ),
            },
        ))
    return suggestions
