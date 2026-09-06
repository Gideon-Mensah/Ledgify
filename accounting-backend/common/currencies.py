"""Canonical ISO 4217 currency codes accepted by Ledgify."""
from django.core.exceptions import ValidationError

SUPPORTED_CURRENCIES = ("AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN", "BAM", "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BRL", "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHF", "CLP", "CNY", "COP", "CRC", "CUC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP", "ERN", "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS", "GIP", "GMD", "GNF", "GTQ", "GYD", "HKD", "HNL", "HRK", "HTG", "HUF", "IDR", "ILS", "INR", "IQD", "IRR", "ISK", "JMD", "JOD", "JPY", "KES", "KGS", "KHR", "KMF", "KPW", "KRW", "KWD", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "LYD", "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR", "MWK", "MXN", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR", "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SHP", "SLE", "SLL", "SOS", "SRD", "SSP", "STN", "SVC", "SYP", "SZL", "THB", "TJS", "TMT", "TND", "TOP", "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "USD", "UYU", "UZS", "VES", "VND", "VUV", "WST", "XAF", "XCD", "XCG", "XDR", "XOF", "XPF", "XSU", "YER", "ZAR", "ZMW", "ZWG", "ZWL")
LEGACY_GHANA_CURRENCY_VALUES = {"GH¢", "GH₵", "GHC"}


def validate_currency_code(value, *, allow_blank=False):
    code = str(value or "").strip().upper()
    if not code and allow_blank:
        return ""
    if code in LEGACY_GHANA_CURRENCY_VALUES:
        raise ValidationError("Use the ISO currency code GHS for Ghanaian cedi.")
    if code not in SUPPORTED_CURRENCIES:
        raise ValidationError("Use a valid ISO 4217 currency code, such as GHS, GBP, USD or EUR.")
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
