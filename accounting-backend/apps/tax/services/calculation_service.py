"""Calculate tax deterministically from Decimal line values and configured rates."""

from decimal import Decimal, ROUND_HALF_UP

from common.exceptions import BusinessRuleError

MONEY = Decimal("0.01")
HUNDRED = Decimal("100")


def _money(value):
    return Decimal(str(value)).quantize(MONEY, rounding=ROUND_HALF_UP)


def calculate_tax(*, quantity, unit_price, discount=0, tax_rate=0, tax_inclusive=False):
    """Calculate and round tax once per document line using ROUND_HALF_UP."""
    quantity, unit_price = Decimal(str(quantity)), Decimal(str(unit_price))
    discount, rate = Decimal(str(discount)), Decimal(str(tax_rate))
    if quantity <= 0 or unit_price < 0 or discount < 0 or rate < 0:
        raise BusinessRuleError("Tax calculation values cannot be negative and quantity must be positive.")
    line_amount = _money(quantity * unit_price)
    if discount > line_amount:
        raise BusinessRuleError("Discount cannot exceed the line amount.")
    priced_amount = _money(line_amount - discount)
    if tax_inclusive:
        gross = priced_amount
        net = _money(gross / (Decimal("1") + rate / HUNDRED)) if rate else gross
        tax = _money(gross - net)
    else:
        net = priced_amount
        tax = _money(net * rate / HUNDRED)
        gross = _money(net + tax)
    return {"net_amount": net, "tax_amount": tax, "gross_amount": gross}
