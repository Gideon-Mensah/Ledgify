"""Build period income, expenses, and profit from posted revenue and expense lines."""

from django.db.models import Sum

from apps.accounting.models import Account, JournalEntry

from .base import ReportQuery, ZERO
from .utils import statement_amount


class ProfitLossReport(ReportQuery):
    def run(self):
        queryset = (
            self.journal_lines()
            .exclude(
                journal_entry__source_type=JournalEntry.SourceType.YEAR_END_CLOSE,
            )
            .filter(
                account__account_type__in=[
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

        income = []
        expenses = []
        total_income = ZERO
        total_expenses = ZERO

        for item in queryset:
            total_debit = item["total_debit"] or ZERO
            total_credit = item["total_credit"] or ZERO
            account_type = item["account__account_type"]

            amount = statement_amount(account_type, total_debit, total_credit)

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

            if account_type == Account.AccountType.REVENUE:
                income.append(row)
                total_income += amount
            else:
                expenses.append(row)
                total_expenses += amount

        return {
            "income": income,
            "expenses": expenses,
            "total_income": total_income,
            "total_expenses": total_expenses,
            "net_profit": total_income - total_expenses,
        }


def profit_loss(
    *,
    organisation,
    start_date=None,
    end_date=None,
):
    return (
        ProfitLossReport(
            organisation=organisation,
            start_date=start_date,
            end_date=end_date,
        )
        .run()
    )
