"""Canonical ISO 4217 currency codes accepted by Ledgify."""
from django.core.exceptions import ValidationError

import json
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP

CURRENCY_METADATA = json.loads(Path(__file__).with_name("currency_metadata.json").read_text())
SUPPORTED_CURRENCIES = tuple(CURRENCY_METADATA)


def money(value, currency="GHS"):
    require_currency_code(currency)
    if isinstance(value, float):
        from common.exceptions import BusinessRuleError
        raise BusinessRuleError("Financial calculations require decimal values, not binary floats.")
    amount = Decimal(value)
    if not amount.is_finite():
        from common.exceptions import BusinessRuleError
        raise BusinessRuleError("A finite monetary amount is required.")
    return amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


LEGACY_GHANA_CURRENCY_VALUES = {"GH¢", "GH₵", "GHC"}


def validate_currency_code(value, *, allow_blank=False):
    code = str(value or "").strip().upper()
    if not code and allow_blank:
        return ""
    if code in LEGACY_GHANA_CURRENCY_VALUES:
        raise ValidationError("Use the ISO currency code GHS for Ghanaian cedi.")
    if code not in SUPPORTED_CURRENCIES:
        raise ValidationError("Use a supported two-decimal currency, such as GHS, GBP, USD or EUR.")
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
