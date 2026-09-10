from decimal import Decimal
from django.test import SimpleTestCase
from common.currencies import money, require_currency_code
from common.exceptions import BusinessRuleError
from apps.tax.services import calculate_tax
from apps.fx.services import convert_amount


class CurrencyRoundingTests(SimpleTestCase):
    def test_half_cent_policy_and_supported_precision(self):
        self.assertEqual(money("0.005","GHS"),Decimal("0.01"))
        self.assertEqual(money("-0.005","GHS"),Decimal("-0.01"))
        self.assertEqual(money("1.005","USD"),Decimal("1.01"))
        for code in ("JPY","BHD","KWD"):
            with self.assertRaises(BusinessRuleError):require_currency_code(code)
        with self.assertRaises(BusinessRuleError):money(0.1,"GHS")

    def test_tax_is_rounded_per_transaction_line_and_fx_half_up(self):
        rows=[calculate_tax(quantity=1,unit_price=Decimal("0.05"),tax_rate=Decimal("10")) for _ in range(3)]
        self.assertEqual(sum(row["net_amount"] for row in rows),Decimal("0.15"))
        self.assertEqual(sum(row["tax_amount"] for row in rows),Decimal("0.03"))
        self.assertEqual(sum(row["gross_amount"] for row in rows),Decimal("0.18"))
        self.assertEqual(convert_amount(amount=Decimal("1"),rate=Decimal("1")/Decimal("3")),Decimal("0.33"))
        self.assertEqual(convert_amount(amount=Decimal("0.03"),rate=Decimal("1.5")),Decimal("0.05"))
