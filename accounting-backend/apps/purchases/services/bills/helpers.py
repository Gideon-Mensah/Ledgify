from decimal import Decimal, ROUND_HALF_UP


MONEY_PLACES = Decimal("0.01")


def money(value):
    return Decimal(str(value)).quantize(
        MONEY_PLACES,
        rounding=ROUND_HALF_UP,
    )
