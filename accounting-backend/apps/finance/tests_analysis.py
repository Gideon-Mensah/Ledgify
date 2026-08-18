from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.finance.services.analysis import get_ratio_analysis


class RatioAnalysisTests(SimpleTestCase):
    def setUp(self):
        self.organisation = SimpleNamespace(base_currency="GBP")
        self.balance_reports = [
            {"assets": [], "liabilities": [], "total_assets": Decimal("180000"), "total_liabilities": Decimal("90000"), "total_equity": Decimal("90000")},
            {"assets": [
                {"account": {"account_class": "bank"}, "amount": Decimal("60000")},
                {"account": {"account_class": "current_asset"}, "amount": Decimal("100000")},
                {"account": {"account_class": "receivable"}, "amount": Decimal("40000")},
            ], "liabilities": [{"account": {"account_class": "current_liability"}, "amount": Decimal("100000")}],
             "total_assets": Decimal("220000"), "total_liabilities": Decimal("100000"), "total_equity": Decimal("120000")},
        ]

    def test_authoritative_ratios_and_zero_safety(self):
        pnl = {"income": [{"account": {"account_class": "sales"}, "amount": Decimal("100000")}], "expenses": [{"account": {"account_class": "cost_of_sales"}, "amount": Decimal("120000")}],
               "total_income": Decimal("100000"), "total_expenses": Decimal("80000"), "net_profit": Decimal("20000")}
        aging = {"total_outstanding": Decimal("40000"), "buckets": {"current": Decimal("30000"), "1_30": Decimal("10000")}}
        inventories = [{"value": Decimal("20000")}, {"value": Decimal("40000")}]
        with patch("apps.finance.services.analysis.ratio_analysis.balance_sheet", side_effect=self.balance_reports), \
             patch("apps.finance.services.analysis.ratio_analysis.profit_loss", return_value=pnl), \
             patch("apps.finance.services.analysis.ratio_analysis.get_inventory_valuation", side_effect=inventories), \
             patch("apps.finance.services.analysis.ratio_analysis.aged_receivables", return_value=aging), \
             patch("apps.finance.services.analysis.ratio_analysis.aged_payables", return_value=aging):
            report = get_ratio_analysis(organisation=self.organisation, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31))
        ratios = {item["key"]: item for group in ("liquidity", "profitability", "efficiency", "leverage") for item in report[group]}
        self.assertEqual(ratios["current_ratio"]["value"], Decimal("2.00"))
        self.assertEqual(ratios["net_profit_margin"]["value"], Decimal("20.00"))
        self.assertEqual(ratios["return_on_assets"]["value"], Decimal("10.00"))
        self.assertEqual(ratios["inventory_turnover"]["value"], Decimal("4.00"))

    def test_zero_current_liabilities_is_not_available(self):
        reports = [{"assets": [], "liabilities": [], "total_assets": Decimal("0"), "total_liabilities": Decimal("0"), "total_equity": Decimal("0")}] * 2
        empty = {"total_outstanding": Decimal("0"), "buckets": {"current": Decimal("0")}}
        pnl = {"income": [], "expenses": [], "total_income": Decimal("0"), "total_expenses": Decimal("0"), "net_profit": Decimal("0")}
        with patch("apps.finance.services.analysis.ratio_analysis.balance_sheet", side_effect=reports), patch("apps.finance.services.analysis.ratio_analysis.profit_loss", return_value=pnl), patch("apps.finance.services.analysis.ratio_analysis.get_inventory_valuation", return_value={"value": Decimal("0")}), patch("apps.finance.services.analysis.ratio_analysis.aged_receivables", return_value=empty), patch("apps.finance.services.analysis.ratio_analysis.aged_payables", return_value=empty):
            report = get_ratio_analysis(organisation=self.organisation, start_date=date(2026, 1, 1), end_date=date(2026, 1, 31))
        ratio = next(item for item in report["liquidity"] if item["key"] == "current_ratio")
        self.assertEqual(ratio["status"], "not_available")
        self.assertIsNone(ratio["value"])
