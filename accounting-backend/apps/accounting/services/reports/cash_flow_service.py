"""Classify posted cash movements into operating, investing, and financing activity."""

from collections import OrderedDict

from django.db.models import Q, Sum

from apps.accounting.models import Account, JournalEntry

from .base import ReportQuery, ZERO


class CashFlowReport(ReportQuery):
    """Direct-method cash flow derived only from ledger-effective cash lines.

    Cash accounts are identified by explicit cash-flow metadata, the Chart of
    Accounts ``bank`` class, or a linked Banking profile. Counterpart accounts
    use an explicit cash-flow category first, then the central class mapping
    below. No account names, descriptions, or hard-coded codes are inspected.
    """

    SECTION_NAMES = {
        Account.CashFlowCategory.OPERATING: "operating",
        Account.CashFlowCategory.INVESTING: "investing",
        Account.CashFlowCategory.FINANCING: "financing",
    }

    CLASSIFICATION_BY_ACCOUNT_CLASS = {
        Account.AccountClass.FIXED_ASSET: "investing",
        Account.AccountClass.EQUITY: "financing",
        Account.AccountClass.RETAINED_EARNINGS: "financing",
        Account.AccountClass.LONG_TERM_LIABILITY: "financing",
        Account.AccountClass.CURRENT_ASSET: "operating",
        Account.AccountClass.RECEIVABLE: "operating",
        Account.AccountClass.CURRENT_LIABILITY: "operating",
        Account.AccountClass.PAYABLE: "operating",
        Account.AccountClass.SALES: "operating",
        Account.AccountClass.OTHER_INCOME: "operating",
        Account.AccountClass.COST_OF_SALES: "operating",
        Account.AccountClass.OPERATING_EXPENSE: "operating",
        Account.AccountClass.OTHER_EXPENSE: "operating",
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
                allocation["counterpart_line"].account,
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
            line = allocation["counterpart_line"]
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
                "journal_status": journal.status,
                "reversal_of": (
                    {
                        "id": str(journal.reversal_of_id),
                        "entry_number": journal.reversal_of.entry_number,
                    }
                    if journal.reversal_of_id else None
                ),
                "reversal_entry": (
                    {
                        "id": str(journal.reversal_entry.id),
                        "entry_number": journal.reversal_entry.entry_number,
                    }
                    if hasattr(journal, "reversal_entry") else None
                ),
                "cash_accounts": allocation["cash_accounts"],
                "account": {
                    "id": str(account.id),
                    "code": account.code,
                    "name": account.name,
                },
                "cash_flow_category": allocation["section"],
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
        queryset = self.journal_lines().select_related(
            "account__bank_profile",
            "journal_entry__reversal_of",
            "journal_entry__reversal_entry",
        ).order_by(
            "journal_entry__date",
            "journal_entry__entry_number",
            "created_at",
        )
        for line in queryset:
            journal_groups.setdefault(line.journal_entry_id, []).append(line)

        for lines in journal_groups.values():
            # Conversion cash is a brought-forward balance, never a current
            # operating, investing, or financing cash movement.
            if lines[0].journal_entry.source_type == JournalEntry.SourceType.OPENING_BALANCE:
                continue
            cash_lines = [
                line for line in lines
                if self._is_cash_account(line.account)
            ]
            if not cash_lines:
                continue
            non_cash_lines = [
                line for line in lines
                if not self._is_cash_account(line.account)
            ]
            # A journal containing only cash accounts is an internal transfer.
            if not non_cash_lines:
                continue
            cash_movement = sum(
                (line.debit - line.credit for line in cash_lines), ZERO,
            )
            # A pure/internal cash transfer, including a multi-bank transfer,
            # does not change organisation-wide cash and is excluded.
            if cash_movement == ZERO:
                continue
            cash_accounts = [
                {
                    "id": str(line.account_id),
                    "code": line.account.code,
                    "name": line.account.name,
                    "account_class": line.account.account_class,
                    "amount": line.debit - line.credit,
                }
                for line in cash_lines
            ]
            # In a balanced journal, the signed cash effect attributable to a
            # counterpart is credit minus debit. These amounts reconcile to the
            # journal's net cash movement without proportional/absolute-value
            # distortion and naturally support compound journals.
            allocations = [
                (line, line.credit - line.debit)
                for line in non_cash_lines
                if line.credit - line.debit != ZERO
            ]
            if sum((amount for _, amount in allocations), ZERO) != cash_movement:
                # Posted journals should be balanced. Do not manufacture a cash
                # classification if corrupt historical data violates that rule.
                continue
            for line, allocated_cash in allocations:
                yield {
                    "section": self._classify_counterpart(line.account),
                    "counterpart_line": line,
                    "amount": allocated_cash,
                    "cash_accounts": cash_accounts,
                }

    @staticmethod
    def _is_cash_account(account):
        return (
            account.cash_flow_category == Account.CashFlowCategory.CASH
            or account.account_class == Account.AccountClass.BANK
            or hasattr(account, "bank_profile")
        )

    def _classify_counterpart(self, account):
        explicit = self.SECTION_NAMES.get(account.cash_flow_category)
        if explicit:
            return explicit
        return self.CLASSIFICATION_BY_ACCOUNT_CLASS.get(
            account.account_class,
            "operating" if account.account_type != Account.AccountType.EQUITY else "financing",
        )

    def _cash_account_filter(self):
        return (
            Q(account__cash_flow_category=Account.CashFlowCategory.CASH)
            | Q(account__account_class=Account.AccountClass.BANK)
            | Q(account__bank_profile__organisation=self.organisation)
        )

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
            )
            .filter(
                self._cash_account_filter(),
            )
            .distinct()
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
                self._cash_account_filter(),
            )
            .distinct()
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
