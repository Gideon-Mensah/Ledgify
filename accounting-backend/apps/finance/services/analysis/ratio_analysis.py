"""Calculate financial ratios from existing statements, aging, and inventory reports."""

from calendar import monthrange
from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP

from apps.accounting.models import Account
from apps.accounting.services.reports import balance_sheet, profit_loss
from apps.finance.services.aging import aged_payables, aged_receivables
from apps.inventory.services.valuation import get_inventory_valuation

ZERO = Decimal("0")
TWO = Decimal("0.01")


def _sum_rows(rows, classes):
    return sum((row["amount"] for row in rows if row["account"]["account_class"] in classes), ZERO)


def _average(opening, closing):
    return (opening + closing) / Decimal("2")


def _value(numerator, denominator, multiplier=Decimal("1")):
    if denominator == ZERO:
        return None
    return ((numerator / denominator) * multiplier).quantize(TWO, rounding=ROUND_HALF_UP)


def _overdue(aging):
    return sum((value for key, value in aging["buckets"].items() if key != "current"), ZERO)


def _source(name, path):
    return {"name": name, "path": path}


def _snapshot(*, organisation, start_date, end_date):
    opening_date = start_date - timedelta(days=1)
    opening_bs = balance_sheet(organisation=organisation, as_of_date=opening_date)
    closing_bs = balance_sheet(organisation=organisation, as_of_date=end_date)
    pnl = profit_loss(organisation=organisation, start_date=start_date, end_date=end_date)
    opening_inventory = get_inventory_valuation(organisation=organisation, as_of_date=opening_date)["value"]
    closing_inventory = get_inventory_valuation(organisation=organisation, as_of_date=end_date)["value"]
    ar = aged_receivables(organisation=organisation, as_of_date=end_date)
    ap = aged_payables(organisation=organisation, as_of_date=end_date)
    current_asset_classes = {Account.AccountClass.BANK, Account.AccountClass.CURRENT_ASSET, Account.AccountClass.RECEIVABLE}
    current_liability_classes = {Account.AccountClass.CURRENT_LIABILITY, Account.AccountClass.PAYABLE}
    current_assets = _sum_rows(closing_bs["assets"], current_asset_classes)
    current_liabilities = _sum_rows(closing_bs["liabilities"], current_liability_classes)
    cash = _sum_rows(closing_bs["assets"], {Account.AccountClass.BANK})
    receivables_open = _sum_rows(opening_bs["assets"], {Account.AccountClass.RECEIVABLE})
    receivables_close = _sum_rows(closing_bs["assets"], {Account.AccountClass.RECEIVABLE})
    revenue = _sum_rows(pnl["income"], {Account.AccountClass.SALES})
    cogs = _sum_rows(pnl["expenses"], {Account.AccountClass.COST_OF_SALES})
    operating_expenses = _sum_rows(pnl["expenses"], {Account.AccountClass.OPERATING_EXPENSE})
    gross_profit = revenue - cogs
    operating_profit = gross_profit - operating_expenses
    days = Decimal(str((end_date - start_date).days + 1))
    return {
        "current_assets": current_assets, "current_liabilities": current_liabilities,
        "quick_assets": current_assets - closing_inventory, "cash": cash,
        "revenue": revenue, "cogs": cogs, "gross_profit": gross_profit,
        "operating_profit": operating_profit, "net_profit": pnl["net_profit"],
        "average_assets": _average(opening_bs["total_assets"], closing_bs["total_assets"]),
        "average_equity": _average(opening_bs["total_equity"], closing_bs["total_equity"]),
        "average_receivables": _average(receivables_open, receivables_close),
        "average_inventory": _average(opening_inventory, closing_inventory),
        "total_assets": closing_bs["total_assets"], "total_liabilities": closing_bs["total_liabilities"],
        "total_equity": closing_bs["total_equity"], "inventory_open": opening_inventory,
        "inventory_close": closing_inventory, "days": days,
        "receivables": ar["total_outstanding"], "overdue_receivables": _overdue(ar),
        "payables": ap["total_outstanding"], "overdue_payables": _overdue(ap),
    }


DEFINITIONS = [
    ("liquidity", "working_capital", "Working Capital", "currency", "Current Assets − Current Liabilities", "current_assets", "current_liabilities", "difference", "Short-term resources remaining after current obligations.", ["balance_sheet"]),
    ("liquidity", "current_ratio", "Current Ratio", "ratio", "Current Assets / Current Liabilities", "current_assets", "current_liabilities", "ratio", "Compares short-term assets with short-term liabilities.", ["balance_sheet"]),
    ("liquidity", "quick_ratio", "Quick Ratio", "ratio", "(Current Assets − Inventory) / Current Liabilities", "quick_assets", "current_liabilities", "ratio", "Measures short-term cover after excluding inventory.", ["balance_sheet", "inventory"]),
    ("liquidity", "cash_ratio", "Cash Ratio", "ratio", "Cash and Cash Equivalents / Current Liabilities", "cash", "current_liabilities", "ratio", "Compares bank and cash balances with current liabilities.", ["balance_sheet"]),
    ("profitability", "gross_profit_margin", "Gross Profit Margin", "percent", "Gross Profit / Revenue × 100", "gross_profit", "revenue", "percent", "Shows gross profit retained from revenue.", ["profit_loss"]),
    ("profitability", "operating_profit_margin", "Operating Profit Margin", "percent", "Operating Profit / Revenue × 100", "operating_profit", "revenue", "percent", "Shows profit after classified cost of sales and operating expenses.", ["profit_loss"]),
    ("profitability", "net_profit_margin", "Net Profit Margin", "percent", "Net Profit / Revenue × 100", "net_profit", "revenue", "percent", "Shows net profit generated from revenue.", ["profit_loss"]),
    ("profitability", "return_on_assets", "Return on Assets", "percent", "Net Profit / Average Total Assets × 100", "net_profit", "average_assets", "percent", "Relates profit to average opening and closing assets.", ["profit_loss", "balance_sheet"]),
    ("profitability", "return_on_equity", "Return on Equity", "percent", "Net Profit / Average Equity × 100", "net_profit", "average_equity", "percent", "Relates profit to average opening and closing equity.", ["profit_loss", "balance_sheet"]),
    ("efficiency", "receivable_days", "Receivable Days", "days", "Average Trade Receivables / Revenue × Days", "average_receivables", "revenue", "days", "Estimates collection time using revenue as the sales basis.", ["balance_sheet", "profit_loss", "aged_receivables"]),
    ("efficiency", "inventory_turnover", "Inventory Turnover", "times", "Cost of Goods Sold / Average Inventory", "cogs", "average_inventory", "inverse", "Shows how often average inventory is consumed by cost of sales.", ["profit_loss", "inventory"]),
    ("efficiency", "inventory_days", "Inventory Days", "days", "Average Inventory / Cost of Goods Sold × Days", "average_inventory", "cogs", "days", "Estimates the number of period days held in inventory.", ["profit_loss", "inventory"]),
    ("efficiency", "asset_turnover", "Asset Turnover", "times", "Revenue / Average Total Assets", "revenue", "average_assets", "ratio", "Relates revenue to average assets employed.", ["profit_loss", "balance_sheet"]),
    ("leverage", "debt_to_equity", "Debt-to-Equity", "ratio", "Total Liabilities / Total Equity", "total_liabilities", "total_equity", "ratio", "Compares liabilities with accounting equity.", ["balance_sheet"]),
    ("leverage", "debt_ratio", "Debt Ratio", "percent", "Total Liabilities / Total Assets × 100", "total_liabilities", "total_assets", "percent", "Shows the proportion of assets financed by liabilities.", ["balance_sheet"]),
]

SOURCE_PATHS = {
    "balance_sheet": _source("Balance Sheet", "/accounting/balance-sheet"),
    "profit_loss": _source("Profit & Loss", "/accounting/profit-and-loss"),
    "aged_receivables": _source("Aged Receivables", "/accounting/aged-receivables"),
    "aged_payables": _source("Aged Payables", "/accounting/aged-payables"),
    "inventory": _source("Inventory Valuation", "/inventory/reports"),
}


def _calculated(definition, data):
    group, key, name, unit, formula, numerator_key, denominator_key, calculation, help_text, sources = definition
    numerator, denominator = data[numerator_key], data[denominator_key]
    if calculation == "difference":
        value = (numerator - denominator).quantize(TWO)
    elif calculation == "percent":
        value = _value(numerator, denominator, Decimal("100"))
    elif calculation == "days":
        value = _value(numerator, denominator, data["days"])
    elif calculation == "inverse":
        value = _value(numerator, denominator)
    else:
        value = _value(numerator, denominator)
    limitations = []
    if key == "receivable_days": limitations.append("Revenue is used as an approximation because credit sales are not separately classified.")
    if key == "quick_ratio": limitations.append("Inventory is excluded using the perpetual inventory valuation service.")
    if key == "return_on_equity" and denominator < ZERO: limitations.append("Average equity is negative; interpret the result with care.")
    reason = None if value is not None else f"{formula.split('/')[-1].strip()} is zero."
    return group, {"key": key, "name": name, "value": value, "current_value": value, "comparison_value": None,
                   "change": None, "change_percent": None, "unit": unit, "formula": formula,
                   "numerator": numerator, "denominator": denominator, "status": "available" if value is not None else "not_available",
                   "reason": reason, "interpretation_data": {"summary": help_text, "trend": "not_comparable"},
                   "sources": [SOURCE_PATHS[item] for item in sources], "limitations": limitations}


def _unsupported(key, name, formula, reason):
    return {"key": key, "name": name, "value": None, "current_value": None, "comparison_value": None,
            "change": None, "change_percent": None, "unit": "ratio", "formula": formula,
            "numerator": None, "denominator": None, "status": "not_available", "reason": reason,
            "interpretation_data": {"summary": reason, "trend": "not_comparable"}, "sources": [], "limitations": [reason]}


def _comparison(current, previous):
    old = previous["value"]
    current["comparison_value"] = old
    if current["value"] is None or old is None:
        return
    current["change"] = (current["value"] - old).quantize(TWO)
    current["change_percent"] = _value(current["change"], abs(old), Decimal("100")) if old != ZERO else None
    direction = "stable" if current["change"] == ZERO else "increased" if current["change"] > ZERO else "decreased"
    current["interpretation_data"]["trend"] = direction
    current["interpretation_data"]["commentary"] = f'{current["name"]} {direction} from {old} to {current["value"]}.'


def get_ratio_analysis(*, organisation, start_date, end_date, comparison_start_date=None, comparison_end_date=None):
    current_data = _snapshot(organisation=organisation, start_date=start_date, end_date=end_date)
    groups = {key: [] for key in ("liquidity", "profitability", "efficiency", "leverage")}
    for definition in DEFINITIONS:
        group, result = _calculated(definition, current_data)
        groups[group].append(result)
    groups["efficiency"].append(_unsupported("payable_days", "Payable Days", "Average Trade Payables / Credit Purchases × Days", "Credit purchases are not separately classified in the current reporting model."))
    groups["leverage"].append(_unsupported("interest_coverage", "Interest Coverage", "EBIT / Interest Expense", "Interest expense is not separately classified in the current chart-of-accounts metadata."))
    if comparison_start_date and comparison_end_date:
        comparison_data = _snapshot(organisation=organisation, start_date=comparison_start_date, end_date=comparison_end_date)
        prior = {}
        for definition in DEFINITIONS:
            _, item = _calculated(definition, comparison_data)
            prior[item["key"]] = item
        for items in groups.values():
            for item in items:
                if item["key"] in prior: _comparison(item, prior[item["key"]])
    supporting = [
        {"key": "total_receivables", "name": "Total Receivables", "value": current_data["receivables"], "unit": "currency", "sources": [SOURCE_PATHS["aged_receivables"]]},
        {"key": "overdue_receivables", "name": "Overdue Receivables", "value": current_data["overdue_receivables"], "unit": "currency", "sources": [SOURCE_PATHS["aged_receivables"]]},
        {"key": "total_payables", "name": "Total Payables", "value": current_data["payables"], "unit": "currency", "sources": [SOURCE_PATHS["aged_payables"]]},
        {"key": "overdue_payables", "name": "Overdue Payables", "value": current_data["overdue_payables"], "unit": "currency", "sources": [SOURCE_PATHS["aged_payables"]]},
    ]
    return {**groups, "supporting_metrics": supporting, "period": {"start_date": start_date, "end_date": end_date,
            "days": int(current_data["days"]), "comparison_start_date": comparison_start_date,
            "comparison_end_date": comparison_end_date}, "currency": organisation.base_currency,
            "methodology": "Posted ledger financial statements, aging services and perpetual inventory valuation."}


def get_ratio_trend(*, organisation, ratio_key, start_date, end_date, interval="month"):
    points, cursor = [], start_date
    while cursor <= end_date:
        if interval == "month": period_end = cursor.replace(day=monthrange(cursor.year, cursor.month)[1])
        elif interval == "quarter":
            month = ((cursor.month - 1) // 3 + 1) * 3
            period_end = cursor.replace(month=month, day=monthrange(cursor.year, month)[1])
        else: period_end = cursor.replace(month=12, day=31)
        period_end = min(period_end, end_date)
        report = get_ratio_analysis(organisation=organisation, start_date=cursor, end_date=period_end)
        item = next((row for group in ("liquidity", "profitability", "efficiency", "leverage") for row in report[group] if row["key"] == ratio_key), None)
        if item is None: raise ValueError("Unknown ratio key.")
        points.append({"start_date": cursor, "end_date": period_end, "value": item["value"], "status": item["status"]})
        cursor = period_end + timedelta(days=1)
    return {"ratio_key": ratio_key, "interval": interval, "points": points}
