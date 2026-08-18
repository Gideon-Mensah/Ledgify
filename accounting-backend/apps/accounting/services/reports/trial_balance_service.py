"""Build a Trial Balance from posted journal lines up to the requested date."""

from django.db.models import Sum

from .base import ReportQuery, ZERO
from .utils import balance_position


class TrialBalanceReport(ReportQuery):
    """
    Produce a trial balance from posted journal entries.

    The report is cumulative up to end_date.
    """

    def run(self):
        queryset = (
            self.journal_lines()
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

        rows = []

        grand_debit = ZERO
        grand_credit = ZERO

        for item in queryset:
            total_debit = (
                item["total_debit"]
                or ZERO
            )

            total_credit = (
                item["total_credit"]
                or ZERO
            )

            position = balance_position(total_debit, total_credit)
            debit_balance, credit_balance = position["debit_balance"], position["credit_balance"]

            # Ignore accounts whose final balance is zero.
            if (
                debit_balance == ZERO
                and credit_balance == ZERO
            ):
                continue

            grand_debit += debit_balance
            grand_credit += credit_balance

            rows.append(
                {
                    "account": {
                        "id": str(
                            item["account_id"]
                        ),
                        "code": item[
                            "account__code"
                        ],
                        "name": item[
                            "account__name"
                        ],
                        "account_type": item[
                            "account__account_type"
                        ],
                        "account_class": item[
                            "account__account_class"
                        ],
                    },
                    "debit": debit_balance,
                    "credit": credit_balance,
                    "net_balance": position["net_balance"],
                    "balance_side": position["balance_side"],
                }
            )

        difference = (
            grand_debit
            - grand_credit
        )

        return {
            "rows": rows,
            "total_debit": grand_debit,
            "total_credit": grand_credit,
            "difference": difference,
            "balanced": difference == ZERO,
        }


def trial_balance(
    *,
    organisation,
    as_of_date=None,
):
    return (
        TrialBalanceReport(
            organisation=organisation,
            end_date=as_of_date,
        )
        .run()
    )
