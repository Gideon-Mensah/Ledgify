"""Build the cumulative asset, liability, and equity position from posted journals."""

from django.db.models import Sum

from apps.accounting.models import Account

from .base import ReportQuery, ZERO
from .utils import statement_amount


class BalanceSheetReport(ReportQuery):
    def run(self):
        queryset = (
            self.journal_lines()
            .filter(
                account__account_type__in=[
                    Account.AccountType.ASSET,
                    Account.AccountType.LIABILITY,
                    Account.AccountType.EQUITY,
                    Account.AccountType.REVENUE,
                    Account.AccountType.EXPENSE,
                ],
            )
            .values(
                "account_id",
                "account__code",
                "account__name",
                "account__account_type",
                "account__account_class",
            )
            .annotate(
                total_debit=Sum("debit"),
                total_credit=Sum("credit"),
            )
            .order_by(
                "account__code",
            )
        )

        assets = []
        liabilities = []
        equity = []

        total_assets = ZERO
        total_liabilities = ZERO
        total_equity_accounts = ZERO
        total_revenue = ZERO
        total_expenses = ZERO

        for item in queryset:
            total_debit = item["total_debit"] or ZERO
            total_credit = item["total_credit"] or ZERO
            account_type = item["account__account_type"]

            amount = statement_amount(account_type, total_debit, total_credit)

            if account_type == Account.AccountType.REVENUE:
                total_revenue += amount
                continue

            if account_type == Account.AccountType.EXPENSE:
                total_expenses += amount
                continue

            if amount == ZERO:
                continue

            row = {
                "account": {
                    "id": str(item["account_id"]),
                    "code": item["account__code"],
                    "name": item["account__name"],
                    "account_type": account_type,
                    "account_class": item["account__account_class"],
                },
                "amount": amount,
            }

            if account_type == Account.AccountType.ASSET:
                assets.append(row)
                total_assets += amount
            elif account_type == Account.AccountType.LIABILITY:
                liabilities.append(row)
                total_liabilities += amount
            else:
                equity.append(row)
                total_equity_accounts += amount

        # Until financial year close is implemented, all cumulative posted
        # revenue less expenses is presented as Current Earnings.
        current_earnings = total_revenue - total_expenses

        if current_earnings != ZERO:
            equity.append(
                {
                    "account": {
                        "id": None,
                        "code": None,
                        "name": "Current Earnings",
                        "account_type": Account.AccountType.EQUITY,
                        "account_class": "current_earnings",
                    },
                    "amount": current_earnings,
                }
            )

        total_equity = total_equity_accounts + current_earnings
        total_liabilities_and_equity = (
            total_liabilities
            + total_equity
        )
        difference = total_assets - total_liabilities_and_equity

        return {
            "assets": assets,
            "liabilities": liabilities,
            "equity": equity,
            "total_assets": total_assets,
            "total_liabilities": total_liabilities,
            "total_equity": total_equity,
            "current_earnings": current_earnings,
            "total_liabilities_and_equity": (
                total_liabilities_and_equity
            ),
            "difference": difference,
            "balanced": difference == ZERO,
        }


def balance_sheet(
    *,
    organisation,
    as_of_date=None,
):
    return (
        BalanceSheetReport(
            organisation=organisation,
            end_date=as_of_date,
        )
        .run()
    )
