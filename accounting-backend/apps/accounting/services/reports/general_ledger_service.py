"""List posted activity and running balances for organisation ledger accounts."""

from collections import OrderedDict

from apps.accounting.models import (
    LEDGER_EFFECTIVE_JOURNAL_STATUSES,
    Account,
    JournalEntry,
    JournalLine,
)
from .base import ReportQuery, ZERO
from .utils import balance_position, statement_amount


def _normal_side(account):
    return "debit" if account.account_type in (Account.AccountType.ASSET, Account.AccountType.EXPENSE) else "credit"


class GeneralLedgerReport(ReportQuery):
    def run(
        self,
        account_id=None,
        report_type=None,
    ):
        queryset = self.journal_lines()

        if report_type == "profit_loss":
            queryset = queryset.exclude(
                journal_entry__source_type=JournalEntry.SourceType.YEAR_END_CLOSE,
            )

        opening_by_account = {}
        if self.start_date:
            opening = JournalLine.objects.select_related("account").filter(
                journal_entry__organisation=self.organisation,
                journal_entry__status__in=LEDGER_EFFECTIVE_JOURNAL_STATUSES,
                journal_entry__date__lt=self.start_date,
            )
            if report_type == "profit_loss":
                opening = opening.exclude(
                    journal_entry__source_type=JournalEntry.SourceType.YEAR_END_CLOSE,
                )
            if account_id:
                opening = opening.filter(account_id=account_id)
            for line in opening:
                values = opening_by_account.setdefault(line.account_id, [ZERO, ZERO])
                values[0] += line.debit
                values[1] += line.credit

        if account_id:
            queryset = queryset.filter(
                account_id=account_id,
            )

        queryset = queryset.order_by(
            "account__code",
            "journal_entry__date",
            "journal_entry__entry_number",
            "created_at",
        )

        accounts = OrderedDict()

        if account_id:
            selected_account = Account.objects.filter(
                id=account_id, organisation=self.organisation,
            ).first()
            if selected_account:
                opening_debit, opening_credit = opening_by_account.get(selected_account.id, [ZERO, ZERO])
                opening = balance_position(opening_debit, opening_credit)
                accounts[selected_account.id] = {
                    "account": {
                        "id": str(selected_account.id), "code": selected_account.code,
                        "name": selected_account.name, "account_type": selected_account.account_type,
                        "account_class": selected_account.account_class,
                        "normal_balance": _normal_side(selected_account),
                    },
                    "opening_balance": opening["net_balance"], "opening_debit": opening["debit_balance"],
                    "opening_credit": opening["credit_balance"], "opening_balance_side": opening["balance_side"], "total_debit": ZERO,
                    "total_credit": ZERO, "period_debit": ZERO, "period_credit": ZERO,
                    "period_activity": ZERO, "period_debit_balance": ZERO, "period_credit_balance": ZERO,
                    "period_balance_side": "balanced", "closing_balance": opening["net_balance"],
                    "closing_debit": opening["debit_balance"], "closing_credit": opening["credit_balance"],
                    "balance": opening["net_balance"], "balance_side": opening["balance_side"], "transactions": [],
                    "profit_loss_amount": ZERO,
                    "balance_sheet_amount": statement_amount(
                        selected_account.account_type, opening_debit, opening_credit,
                    ),
                }

        for line in queryset:
            account = line.account

            if account.id not in accounts:
                opening_debit, opening_credit = opening_by_account.get(account.id, [ZERO, ZERO])
                opening = balance_position(opening_debit, opening_credit)
                accounts[account.id] = {
                    "account": {
                        "id": str(account.id),
                        "code": account.code,
                        "name": account.name,
                        "account_type": account.account_type,
                        "account_class": account.account_class,
                        "normal_balance": _normal_side(account),
                    },
                    "opening_balance": opening["net_balance"],
                    "opening_debit": opening["debit_balance"],
                    "opening_credit": opening["credit_balance"],
                    "opening_balance_side": opening["balance_side"],
                    "total_debit": ZERO,
                    "total_credit": ZERO,
                    "period_debit": ZERO,
                    "period_credit": ZERO,
                    "period_activity": ZERO,
                    "period_debit_balance": ZERO,
                    "period_credit_balance": ZERO,
                    "period_balance_side": "balanced",
                    "closing_balance": opening["net_balance"],
                    "closing_debit": opening["debit_balance"],
                    "closing_credit": opening["credit_balance"],
                    "balance": opening["net_balance"],
                    "balance_side": opening["balance_side"],
                    "transactions": [],
                    "profit_loss_amount": ZERO,
                    "balance_sheet_amount": statement_amount(
                        account.account_type, opening_debit, opening_credit,
                    ),
                }

            ledger = accounts[account.id]

            ledger["total_debit"] += line.debit
            ledger["total_credit"] += line.credit

            ledger["period_debit"] = ledger["total_debit"]
            ledger["period_credit"] = ledger["total_credit"]
            ledger["period_activity"] = ledger["total_debit"] - ledger["total_credit"]
            period = balance_position(ledger["total_debit"], ledger["total_credit"])
            ledger["period_debit_balance"] = period["debit_balance"]
            ledger["period_credit_balance"] = period["credit_balance"]
            ledger["period_balance_side"] = period["balance_side"]
            running_balance = ledger["opening_balance"] + ledger["period_activity"]
            closing = balance_position(
                ledger["opening_debit"] + ledger["total_debit"],
                ledger["opening_credit"] + ledger["total_credit"],
            )

            ledger["balance"] = running_balance
            ledger["closing_balance"] = closing["net_balance"]
            ledger["closing_debit"] = closing["debit_balance"]
            ledger["closing_credit"] = closing["credit_balance"]
            ledger["balance_side"] = closing["balance_side"]
            ledger["profit_loss_amount"] = statement_amount(
                account.account_type, ledger["total_debit"], ledger["total_credit"],
            )
            ledger["balance_sheet_amount"] = statement_amount(
                account.account_type,
                ledger["opening_debit"] + ledger["total_debit"],
                ledger["opening_credit"] + ledger["total_credit"],
            )

            ledger["transactions"].append(
                {
                    "date": line.journal_entry.date,
                    "entry_number": line.journal_entry.entry_number,
                    "journal_id": str(line.journal_entry_id),
                    "reference": line.journal_entry.reference,
                    "description": (
                        line.description
                        or line.journal_entry.description
                    ),
                    "debit": line.debit,
                    "credit": line.credit,
                    "running_balance": running_balance,
                    "running_debit": closing["debit_balance"],
                    "running_credit": closing["credit_balance"],
                    "running_balance_side": closing["balance_side"],
                    "source_type": line.journal_entry.source_type,
                    "journal_status": line.journal_entry.status,
                    "is_reversal": bool(line.journal_entry.reversal_of_id),
                    "source_id": (
                        str(line.journal_entry.source_id)
                        if line.journal_entry.source_id
                        else None
                    ),
                }
            )

        return list(accounts.values())


def general_ledger(
    *,
    organisation,
    start_date=None,
    end_date=None,
    account_id=None,
    report_type=None,
):
    return (
        GeneralLedgerReport(
            organisation=organisation,
            start_date=start_date,
            end_date=end_date,
        )
        .run(
            account_id=account_id,
            report_type=report_type,
        )
    )
