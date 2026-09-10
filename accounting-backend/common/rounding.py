"""Two-decimal HALF_UP conversion with an explicit, bounded FX residual."""
from decimal import Decimal
from common.exceptions import BusinessRuleError
from common.currencies import require_currency_code
from apps.fx.account_validation import validate_fx_account


def balance_converted_document(*, organisation, currency, lines):
    require_currency_code(currency)
    require_currency_code(organisation.base_currency)
    difference = sum((line["debit"] - line["credit"] for line in lines), Decimal("0.00"))
    if not difference:
        return lines
    if currency == organisation.base_currency or abs(difference) > Decimal("0.005") * len(lines):
        raise BusinessRuleError("Document components do not reconcile; this is not a valid FX rounding residual.")
    kind = "gain" if difference > 0 else "loss"
    account = organisation.fx_gain_account if difference > 0 else organisation.fx_loss_account
    validate_fx_account(organisation, account, kind)
    return [*lines, {"account": account, "description": "FX conversion rounding residual",
        "debit": abs(difference) if difference < 0 else Decimal("0.00"),
        "credit": difference if difference > 0 else Decimal("0.00")}]
