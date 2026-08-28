"""Canonical ISO 4217 currency codes accepted by Ledgify."""
from django.core.exceptions import ValidationError

SUPPORTED_CURRENCIES = ("GBP", "GHS", "USD", "EUR", "CAD", "AUD", "JPY", "NZD")
LEGACY_GHANA_CURRENCY_VALUES = {"GH¢", "GH₵", "GHC"}


def validate_currency_code(value, *, allow_blank=False):
    code = str(value or "").strip().upper()
    if not code and allow_blank:
        return ""
    if code in LEGACY_GHANA_CURRENCY_VALUES:
        raise ValidationError("Use the ISO currency code GHS for Ghanaian cedi.")
    if code not in SUPPORTED_CURRENCIES:
        raise ValidationError(f"Unsupported currency code. Use one of: {', '.join(SUPPORTED_CURRENCIES)}.")
    return code


def validate_optional_currency_code(value):
    return validate_currency_code(value, allow_blank=True)


def require_currency_code(value, *, allow_blank=False):
    """Business-service variant that produces Ledgify's normal safe API error."""
    try:
        return validate_currency_code(value, allow_blank=allow_blank)
    except ValidationError as error:
        from common.exceptions import BusinessRuleError
        raise BusinessRuleError(error.messages[0]) from error
