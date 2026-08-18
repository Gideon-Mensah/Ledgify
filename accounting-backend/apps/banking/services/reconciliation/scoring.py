from decimal import Decimal


def score_amount_match(bank_amount, candidate_amount):
    bank_amount = Decimal(str(bank_amount))
    candidate_amount = Decimal(str(candidate_amount))
    difference = abs(bank_amount - candidate_amount)

    if difference == 0:
        return 60
    if bank_amount == 0:
        return 0

    percentage = difference / abs(bank_amount)
    if percentage <= Decimal("0.01"):
        return 45
    if percentage <= Decimal("0.05"):
        return 25
    return 0


def score_date_match(bank_date, candidate_date):
    difference = abs((bank_date - candidate_date).days)
    if difference == 0:
        return 20
    if difference <= 1:
        return 18
    if difference <= 3:
        return 15
    if difference <= 7:
        return 10
    if difference <= 14:
        return 5
    return 0


def score_reference_match(bank_reference, candidate_reference):
    bank_reference = str(bank_reference or "").strip().lower()
    candidate_reference = str(candidate_reference or "").strip().lower()
    if not bank_reference or not candidate_reference:
        return 0
    if bank_reference == candidate_reference:
        return 20
    if bank_reference in candidate_reference or candidate_reference in bank_reference:
        return 12
    return 0


def clamp_confidence(value):
    return max(0, min(100, int(value)))


def confidence_label(value):
    value = clamp_confidence(value)
    if value >= 90:
        return "very_high"
    if value >= 75:
        return "high"
    if value >= 50:
        return "medium"
    if value >= 25:
        return "low"
    return "very_low"
