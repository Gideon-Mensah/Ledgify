"""Classify posted cash movements into operating, investing, and financing activity."""

from collections import OrderedDict

from django.db.models import Sum

from apps.accounting.models import Account

from .base import ReportQuery, ZERO


class CashFlowReport(ReportQuery):
    SECTION_NAMES = {
        Account.CashFlowCategory.OPERATING: "operating",
        Account.CashFlowCategory.INVESTING: "investing",
        Account.CashFlowCategory.FINANCING: "financing",
    }

    def run(self):
        section_rows = {
            "operating": {},
            "investing": {},
            "financing": {},
            "unclassified": {},
        }

        for allocation in self._allocations():
            self._add_amount(
                section_rows[allocation["section"]],
                allocation["line"].account,
                allocation["amount"],
            )

        operating = self._ordered_rows(section_rows["operating"])
        investing = self._ordered_rows(section_rows["investing"])
        financing = self._ordered_rows(section_rows["financing"])
        unclassified = self._ordered_rows(
            section_rows["unclassified"]
        )

        total_operating = self._section_total(operating)
        total_investing = self._section_total(investing)
        total_financing = self._section_total(financing)
        total_unclassified = self._section_total(unclassified)
        net_cash_flow = (
            total_operating
            + total_investing
            + total_financing
            + total_unclassified
        )

        opening_cash = self._opening_cash()
        closing_cash = opening_cash + net_cash_flow
        cash_ledger_balance = self._cash_ledger_balance()
        difference = closing_cash - cash_ledger_balance

        return {
            "operating": operating,
            "investing": investing,
            "financing": financing,
            "unclassified": unclassified,
            "total_operating": total_operating,
            "total_investing": total_investing,
            "total_financing": total_financing,
            "total_unclassified": total_unclassified,
            "net_cash_flow": net_cash_flow,
            "opening_cash": opening_cash,
            "closing_cash": closing_cash,
            "cash_ledger_balance": cash_ledger_balance,
            "difference": difference,
            "balanced": difference == ZERO,
        }

    def drilldown(self, row_key):
        account = Account.objects.filter(
            organisation=self.organisation,
            id=row_key,
        ).first()
        if not account:
            return None

        transactions = []
        total = ZERO
        for allocation in self._allocations():
            line = allocation["line"]
            if line.account_id != account.id:
                continue
            amount = allocation["amount"]
            total += amount
            journal = line.journal_entry
            transactions.append({
                "date": journal.date,
                "journal_id": str(journal.id),
                "journal": journal.entry_number,
                "reference": journal.reference,
                "description": line.description or journal.description,
                "source_type": journal.source_type,
                "source_id": str(journal.source_id) if journal.source_id else None,
                "account": {
                    "id": str(account.id),
                    "code": account.code,
                    "name": account.name,
                },
                "cash_in": amount if amount > ZERO else ZERO,
                "cash_out": -amount if amount < ZERO else ZERO,
                "amount": amount,
            })

        return {
            "row_key": str(account.id),
            "label": f"{account.code} · {account.name}",
            "account": {
                "id": str(account.id),
                "code": account.code,
                "name": account.name,
                "account_type": account.account_type,
                "account_class": account.account_class,
                "cash_flow_category": account.cash_flow_category,
            },
            "start_date": self.start_date,
            "end_date": self.end_date,
            "amount": total,
            "transactions": transactions,
        }

    def _allocations(self):
        journal_groups = OrderedDict()
        queryset = self.journal_lines().order_by(
            "journal_entry__date",
            "journal_entry__entry_number",
            "created_at",
        )
        for line in queryset:
            journal_groups.setdefault(line.journal_entry_id, []).append(line)

        for lines in journal_groups.values():
            cash_lines = [
                line for line in lines
                if line.account.cash_flow_category == Account.CashFlowCategory.CASH
            ]
            if not cash_lines:
                continue
            non_cash_lines = [
                line for line in lines
                if line.account.cash_flow_category != Account.CashFlowCategory.CASH
            ]
            # A journal containing only cash accounts is an internal transfer.
            if not non_cash_lines:
                continue
            cash_movement = sum(
                (line.debit - line.credit for line in cash_lines), ZERO,
            )
            weighted_lines = [
                (line, abs(line.debit - line.credit))
                for line in non_cash_lines
                if line.debit - line.credit != ZERO
            ]
            total_non_cash_amount = sum(
                (amount for _, amount in weighted_lines), ZERO,
            )
            if total_non_cash_amount == ZERO:
                continue
            allocated_total = ZERO
            for index, (line, amount) in enumerate(weighted_lines):
                if index == len(weighted_lines) - 1:
                    allocated_cash = cash_movement - allocated_total
                else:
                    allocated_cash = cash_movement * amount / total_non_cash_amount
                    allocated_total += allocated_cash
                yield {
                    "section": self.SECTION_NAMES.get(
                        line.account.cash_flow_category, "unclassified",
                    ),
                    "line": line,
                    "amount": allocated_cash,
                }

    def _opening_cash(self):
        if not self.start_date:
            return ZERO

        queryset = (
            ReportQuery(
                organisation=self.organisation,
                end_date=self.start_date,
            )
            .journal_lines()
            .filter(
                journal_entry__date__lt=self.start_date,
                account__cash_flow_category=(
                    Account.CashFlowCategory.CASH
                ),
            )
        )

        return self._cash_balance(queryset)

    def _cash_ledger_balance(self):
        queryset = (
            ReportQuery(
                organisation=self.organisation,
                end_date=self.end_date,
            )
            .journal_lines()
            .filter(
                account__cash_flow_category=(
                    Account.CashFlowCategory.CASH
                ),
            )
        )

        return self._cash_balance(queryset)

    @staticmethod
    def _cash_balance(queryset):
        totals = queryset.aggregate(
            total_debit=Sum("debit"),
            total_credit=Sum("credit"),
        )

        return (
            (totals["total_debit"] or ZERO)
            - (totals["total_credit"] or ZERO)
        )

    @staticmethod
    def _add_amount(rows, account, amount):
        if account.id not in rows:
            rows[account.id] = {
                "account": {
                    "id": str(account.id),
                    "code": account.code,
                    "name": account.name,
                    "account_type": account.account_type,
                    "account_class": account.account_class,
                    "cash_flow_category": account.cash_flow_category,
                },
                "amount": ZERO,
                "row_key": str(account.id),
                "drilldown_type": "cash_flow_category",
            }

        rows[account.id]["amount"] += amount

    @staticmethod
    def _ordered_rows(rows):
        return sorted(
            (
                row
                for row in rows.values()
                if row["amount"] != ZERO
            ),
            key=lambda row: row["account"]["code"],
        )

    @staticmethod
    def _section_total(rows):
        return sum(
            (row["amount"] for row in rows),
            ZERO,
        )


def cash_flow(
    *,
    organisation,
    start_date=None,
    end_date=None,
):
    return (
        CashFlowReport(
            organisation=organisation,
            start_date=start_date,
            end_date=end_date,
        )
        .run()
    )


def cash_flow_drilldown(
    *, organisation, row_key, start_date=None, end_date=None,
):
    return CashFlowReport(
        organisation=organisation,
        start_date=start_date,
        end_date=end_date,
    ).drilldown(row_key)
