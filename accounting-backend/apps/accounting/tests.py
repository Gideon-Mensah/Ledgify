from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from common.exceptions import BusinessRuleError
from apps.organisations.models import Organisation, OrganisationMember
from apps.accounting.models import Account, AccountingPeriod, FinancialYear
from apps.accounting.services.journals import create_journal_entry, post_journal_entry, reverse_journal_entry
from apps.accounting.services.periods.year_end_close import (
    close_financial_year_with_retained_earnings,
    reopen_financial_year,
)
from apps.accounting.services.reports import (
    balance_sheet, cash_flow, cash_flow_drilldown, general_ledger,
    profit_loss, trial_balance,
)


class YearEndCloseTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="year-close", email="year-close@example.com", password="test"
        )
        self.organisation = Organisation.objects.create(
            name="Year Close Test", created_by=self.user
        )
        OrganisationMember.objects.create(
            organisation=self.organisation,
            user=self.user,
            role=OrganisationMember.Role.OWNER,
        )
        self.year = FinancialYear.objects.create(
            organisation=self.organisation,
            name="FY 2026",
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
        )
        self.period = AccountingPeriod.objects.create(
            organisation=self.organisation,
            name="FY 2026 final",
            start_date=self.year.start_date,
            end_date=self.year.end_date,
        )
        self.bank = self._account(
            "BANK", Account.AccountType.ASSET, Account.AccountClass.BANK
        )
        self.revenue = self._account(
            "REV", Account.AccountType.REVENUE, Account.AccountClass.SALES
        )
        self.expense = self._account(
            "EXP", Account.AccountType.EXPENSE,
            Account.AccountClass.OPERATING_EXPENSE,
        )
        self.retained = self._account(
            "RE", Account.AccountType.EQUITY,
            Account.AccountClass.RETAINED_EARNINGS,
        )

    def _account(self, code, account_type, account_class):
        return Account.objects.create(
            organisation=self.organisation,
            code=code,
            name=code,
            account_type=account_type,
            account_class=account_class,
            created_by=self.user,
        )

    def _post(self, description, lines):
        journal = create_journal_entry(
            organisation=self.organisation,
            date=date(2026, 12, 1),
            description=description,
            lines=lines,
            user=self.user,
        )
        return post_journal_entry(journal_entry=journal, user=self.user)

    def test_profit_close_zeroes_nominal_accounts_and_reopen_reverses_close(self):
        zero = Decimal("0.00")
        self._post("Revenue", [
            {"account": self.bank, "debit": Decimal("1000.00"), "credit": zero},
            {"account": self.revenue, "debit": zero, "credit": Decimal("1000.00")},
        ])
        self._post("Expense", [
            {"account": self.expense, "debit": Decimal("600.00"), "credit": zero},
            {"account": self.bank, "debit": zero, "credit": Decimal("600.00")},
        ])

        closed = close_financial_year_with_retained_earnings(
            organisation=self.organisation,
            financial_year=self.year,
            user=self.user,
        )
        self.assertEqual(closed.profit_or_loss, Decimal("400.00"))
        self.assertEqual(closed.status, FinancialYear.Status.CLOSED)
        amounts = {
            line.account_id: (line.debit, line.credit)
            for line in closed.closing_journal.lines.all()
        }
        self.assertEqual(amounts[self.revenue.id], (Decimal("1000.00"), zero))
        self.assertEqual(amounts[self.expense.id], (zero, Decimal("600.00")))
        self.assertEqual(amounts[self.retained.id], (zero, Decimal("400.00")))
        self.assertEqual(profit_loss(
            organisation=self.organisation,
            start_date=self.year.start_date,
            end_date=self.year.end_date,
        )["net_profit"], Decimal("400.00"))
        trial_rows = trial_balance(
            organisation=self.organisation, as_of_date=self.year.end_date
        )["rows"]
        self.assertNotIn(str(self.revenue.id), {row["account"]["id"] for row in trial_rows})
        self.assertNotIn(str(self.expense.id), {row["account"]["id"] for row in trial_rows})

        reopened = reopen_financial_year(
            organisation=self.organisation,
            financial_year=closed,
            user=self.user,
            reason="Correction required",
        )
        self.assertEqual(reopened.status, FinancialYear.Status.OPEN)
        self.assertIsNotNone(reopened.closing_reversal_journal_id)

    def test_no_activity_closes_without_journal_and_duplicate_is_rejected(self):
        closed = close_financial_year_with_retained_earnings(
            organisation=self.organisation,
            financial_year=self.year,
            user=self.user,
        )
        self.assertEqual(closed.profit_or_loss, Decimal("0.00"))
        self.assertIsNone(closed.closing_journal_id)
        with self.assertRaises(BusinessRuleError):
            close_financial_year_with_retained_earnings(
                organisation=self.organisation,
                financial_year=closed,
                user=self.user,
            )

    def test_loss_is_debited_to_retained_earnings(self):
        zero = Decimal("0.00")
        self._post("Revenue", [
            {"account": self.bank, "debit": Decimal("500.00"), "credit": zero},
            {"account": self.revenue, "debit": zero, "credit": Decimal("500.00")},
        ])
        self._post("Expense", [
            {"account": self.expense, "debit": Decimal("800.00"), "credit": zero},
            {"account": self.bank, "debit": zero, "credit": Decimal("800.00")},
        ])
        closed = close_financial_year_with_retained_earnings(
            organisation=self.organisation,
            financial_year=self.year,
            user=self.user,
        )
        retained_line = closed.closing_journal.lines.get(account=self.retained)
        self.assertEqual(closed.profit_or_loss, Decimal("-300.00"))
        self.assertEqual(retained_line.debit, Decimal("300.00"))
        self.assertEqual(retained_line.credit, zero)

    def test_general_ledger_uses_normal_balance_and_carries_opening_balance(self):
        zero = Decimal("0.00")
        journal = self._post("Opening revenue", [
            {"account": self.bank, "debit": Decimal("250.00"), "credit": zero},
            {"account": self.revenue, "debit": zero, "credit": Decimal("250.00")},
        ])
        ledger = general_ledger(
            organisation=self.organisation, start_date=date(2026, 12, 2),
            end_date=date(2026, 12, 31), account_id=self.revenue.id,
        )[0]
        self.assertEqual(ledger["account"]["normal_balance"], "credit")
        self.assertEqual(ledger["opening_balance"], Decimal("-250.00"))
        self.assertEqual(ledger["opening_credit"], Decimal("250.00"))
        self.assertEqual(ledger["closing_credit"], Decimal("250.00"))
        self.assertEqual(ledger["balance"], Decimal("-250.00"))
        self.assertEqual(ledger["transactions"], [])
        full_ledger = general_ledger(
            organisation=self.organisation, end_date=date(2026, 12, 31),
            account_id=self.revenue.id,
        )[0]
        self.assertEqual(full_ledger["transactions"][0]["journal_id"], str(journal.id))
        trial_row = next(row for row in trial_balance(
            organisation=self.organisation, as_of_date=date(2026, 12, 31),
        )["rows"] if row["account"]["id"] == str(self.revenue.id))
        self.assertEqual(trial_row["credit"], full_ledger["closing_credit"])
        self.assertEqual(trial_row["debit"], full_ledger["closing_debit"])

    def test_every_trial_balance_account_reconciles_to_ledger_closing_position(self):
        zero = Decimal("0.00")
        liability = self._account(
            "LIAB", Account.AccountType.LIABILITY, Account.AccountClass.CURRENT_LIABILITY,
        )
        receivable = self._account(
            "AR", Account.AccountType.ASSET, Account.AccountClass.RECEIVABLE,
        )
        self._post("All account types", [
            {"account": self.bank, "debit": Decimal("100.00"), "credit": zero},
            {"account": self.expense, "debit": Decimal("50.00"), "credit": zero},
            {"account": receivable, "debit": Decimal("200.00"), "credit": zero},
            {"account": liability, "debit": zero, "credit": Decimal("50.00")},
            {"account": self.revenue, "debit": zero, "credit": Decimal("200.00")},
            {"account": self.retained, "debit": zero, "credit": Decimal("100.00")},
        ])
        report = trial_balance(
            organisation=self.organisation, as_of_date=date(2026, 12, 31),
        )
        self.assertEqual(report["difference"], zero)
        for row in report["rows"]:
            ledger = general_ledger(
                organisation=self.organisation, account_id=row["account"]["id"],
                end_date=date(2026, 12, 31),
            )[0]
            self.assertEqual(row["debit"], ledger["closing_debit"])
            self.assertEqual(row["credit"], ledger["closing_credit"])
            self.assertEqual(ledger["transactions"][-1]["running_balance"], ledger["closing_balance"])

    def test_reversal_reconciles_trial_balance_and_ledger_to_zero(self):
        zero = Decimal("0.00")
        original = self._post("Reversible", [
            {"account": self.bank, "debit": Decimal("75.00"), "credit": zero},
            {"account": self.revenue, "debit": zero, "credit": Decimal("75.00")},
        ])
        reversal = reverse_journal_entry(
            journal_entry=original, user=self.user, reversal_date=date(2026, 12, 2),
            check_permissions=False,
        )
        original.refresh_from_db()
        reversal.refresh_from_db()
        self.assertEqual(original.status, "reversed")
        self.assertEqual(reversal.status, "posted")
        report = trial_balance(
            organisation=self.organisation, as_of_date=date(2026, 12, 31),
        )
        self.assertNotIn(str(self.bank.id), {row["account"]["id"] for row in report["rows"]})
        ledger = general_ledger(
            organisation=self.organisation, account_id=self.bank.id,
            end_date=date(2026, 12, 31),
        )[0]
        self.assertEqual(ledger["closing_balance"], zero)
        self.assertEqual(ledger["closing_debit"], zero)
        self.assertEqual(ledger["closing_credit"], zero)
        self.assertEqual(ledger["transactions"][-1]["running_balance"], zero)
        self.assertEqual(
            [item["entry_number"] for item in ledger["transactions"]],
            [original.entry_number, reversal.entry_number],
        )
        self.assertEqual(ledger["transactions"][0]["journal_status"], "reversed")
        self.assertFalse(ledger["transactions"][0]["is_reversal"])
        self.assertTrue(ledger["transactions"][1]["is_reversal"])

    def test_reversed_ar_and_expense_journals_remain_ledger_effective(self):
        zero = Decimal("0.00")
        receivable = self._account(
            "AR-REV", Account.AccountType.ASSET, Account.AccountClass.RECEIVABLE,
        )
        ar_original = self._post("Direct AR receipt", [
            {"account": self.bank, "debit": Decimal("375.00"), "credit": zero},
            {"account": receivable, "debit": zero, "credit": Decimal("375.00")},
        ])
        reverse_journal_entry(
            journal_entry=ar_original, user=self.user,
            reversal_date=date(2026, 12, 2), check_permissions=False,
        )
        ar_ledger = general_ledger(
            organisation=self.organisation, account_id=receivable.id,
            end_date=date(2026, 12, 31),
        )[0]
        self.assertEqual(len(ar_ledger["transactions"]), 2)
        self.assertEqual(ar_ledger["closing_balance"], zero)

        expense_original = self._post("Reversed expense", [
            {"account": self.expense, "debit": Decimal("100.00"), "credit": zero},
            {"account": self.bank, "debit": zero, "credit": Decimal("100.00")},
        ])
        reverse_journal_entry(
            journal_entry=expense_original, user=self.user,
            reversal_date=date(2026, 12, 2), check_permissions=False,
        )
        statement = profit_loss(
            organisation=self.organisation,
            start_date=date(2026, 12, 1), end_date=date(2026, 12, 31),
        )
        self.assertEqual(statement["total_expenses"], zero)
        self.assertEqual(statement["net_profit"], zero)
        self.assertTrue(trial_balance(
            organisation=self.organisation, as_of_date=date(2026, 12, 31),
        )["balanced"])

    def test_financial_statement_rows_reconcile_to_general_ledger(self):
        zero = Decimal("0.00")
        liability = self._account(
            "AP", Account.AccountType.LIABILITY, Account.AccountClass.PAYABLE,
        )
        self._post("Statement activity", [
            {"account": self.bank, "debit": Decimal("10000.00"), "credit": zero},
            {"account": self.revenue, "debit": zero, "credit": Decimal("10000.00")},
        ])
        self._post("Refund and expense", [
            {"account": self.revenue, "debit": Decimal("500.00"), "credit": zero},
            {"account": self.expense, "debit": Decimal("2000.00"), "credit": zero},
            {"account": liability, "debit": zero, "credit": Decimal("2500.00")},
        ])
        pnl = profit_loss(
            organisation=self.organisation,
            start_date=date(2026, 12, 1), end_date=date(2026, 12, 31),
        )
        for row in pnl["income"] + pnl["expenses"]:
            ledger = general_ledger(
                organisation=self.organisation, account_id=row["account"]["id"],
                start_date=date(2026, 12, 1), end_date=date(2026, 12, 31),
            )[0]
            self.assertEqual(row["amount"], ledger["profit_loss_amount"])
        self.assertEqual(pnl["income"][0]["amount"], Decimal("9500.00"))
        self.assertEqual(pnl["expenses"][0]["amount"], Decimal("2000.00"))

        statement = balance_sheet(
            organisation=self.organisation, as_of_date=date(2026, 12, 31),
        )
        rows = statement["assets"] + statement["liabilities"] + statement["equity"]
        for row in rows:
            if row["account"]["id"]:
                ledger = general_ledger(
                    organisation=self.organisation, account_id=row["account"]["id"],
                    end_date=date(2026, 12, 31),
                )[0]
                self.assertEqual(row["amount"], ledger["balance_sheet_amount"])

    def test_cash_flow_breakdown_reconciles_and_is_organisation_scoped(self):
        zero = Decimal("0.00")
        self.bank.cash_flow_category = Account.CashFlowCategory.CASH
        self.bank.save(update_fields=["cash_flow_category"])
        self.expense.cash_flow_category = Account.CashFlowCategory.OPERATING
        self.expense.save(update_fields=["cash_flow_category"])
        self._post("Supplier payments", [
            {"account": self.expense, "debit": Decimal("1750.00"), "credit": zero},
            {"account": self.bank, "debit": zero, "credit": Decimal("1750.00")},
        ])
        report = cash_flow(
            organisation=self.organisation,
            start_date=date(2026, 12, 1), end_date=date(2026, 12, 31),
        )
        row = report["operating"][0]
        breakdown = cash_flow_drilldown(
            organisation=self.organisation, row_key=row["row_key"],
            start_date=date(2026, 12, 1), end_date=date(2026, 12, 31),
        )
        self.assertEqual(row["amount"], breakdown["amount"])
        self.assertEqual(
            breakdown["amount"],
            sum((item["amount"] for item in breakdown["transactions"]), zero),
        )
        foreign = Organisation.objects.create(name="Foreign", created_by=self.user)
        self.assertIsNone(cash_flow_drilldown(
            organisation=foreign, row_key=self.expense.id,
            start_date=date(2026, 12, 1), end_date=date(2026, 12, 31),
        ))

    def test_manual_journal_api_posts_and_rejects_unbalanced_or_foreign_accounts(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        headers = {"HTTP_X_ORGANISATION_ID": str(self.organisation.id)}
        payload = {
            "date": "2026-12-01",
            "reference": "MJ-TEST",
            "description": "Manual rent adjustment",
            "post": True,
            "lines": [
                {"account_id": str(self.expense.id), "description": "Rent", "debit": "500.00", "credit": "0.00"},
                {"account_id": str(self.bank.id), "description": "Bank", "debit": "0.00", "credit": "500.00"},
            ],
        }
        response = self.client.post(
            "/api/v1/journals/manual/", payload,
            content_type="application/json", **headers,
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["status"], "posted")
        journal_id = response.json()["id"]
        self.assertIn(
            self.client.patch(
                f"/api/v1/journals/{journal_id}/", {},
                content_type="application/json", **headers,
            ).status_code,
            {403, 405},
        )
        self.assertEqual(
            profit_loss(
                organisation=self.organisation,
                start_date=date(2026, 12, 1), end_date=date(2026, 12, 31),
            )["total_expenses"],
            Decimal("500.00"),
        )

        before = self.organisation.journal_entries.count()
        payload["lines"][1]["credit"] = "400.00"
        response = self.client.post(
            "/api/v1/journals/manual/", payload,
            content_type="application/json", **headers,
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.organisation.journal_entries.count(), before)

        foreign = Organisation.objects.create(name="Other organisation", created_by=self.user)
        foreign_account = Account.objects.create(
            organisation=foreign, code="OTHER", name="Other bank",
            account_type=Account.AccountType.ASSET,
            account_class=Account.AccountClass.BANK, created_by=self.user,
        )
        payload["lines"][0]["account_id"] = str(foreign_account.id)
        payload["lines"][1]["credit"] = "500.00"
        response = self.client.post(
            "/api/v1/journals/manual/", payload,
            content_type="application/json", **headers,
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.organisation.journal_entries.count(), before)


class DirectCashFlowAccountingTests(TestCase):
    """Required direct-method scenarios using metadata, never names/codes."""

    ZERO = Decimal("0.00")
    PERIOD_START = date(2026, 4, 1)
    PERIOD_END = date(2026, 4, 30)

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="cash-flow-review", email="cash-flow-review@example.com", password="test"
        )
        self.organisation = Organisation.objects.create(
            name="Cash Flow Review", created_by=self.user,
        )
        OrganisationMember.objects.create(
            organisation=self.organisation, user=self.user,
            role=OrganisationMember.Role.OWNER,
        )
        self.bank = self.account("0010", Account.AccountType.ASSET, Account.AccountClass.BANK)
        self.savings = self.account("0011", Account.AccountType.ASSET, Account.AccountClass.BANK)
        self.capital = self.account("3000", Account.AccountType.EQUITY, Account.AccountClass.EQUITY)
        self.loan = self.account("2100", Account.AccountType.LIABILITY, Account.AccountClass.LONG_TERM_LIABILITY)
        self.receivable = self.account("1100", Account.AccountType.ASSET, Account.AccountClass.RECEIVABLE)
        self.payable = self.account("2000", Account.AccountType.LIABILITY, Account.AccountClass.PAYABLE)
        self.sales = self.account("4000", Account.AccountType.REVENUE, Account.AccountClass.SALES)
        self.rent = self.account("6000", Account.AccountType.EXPENSE, Account.AccountClass.OPERATING_EXPENSE)
        self.equipment = self.account("1500", Account.AccountType.ASSET, Account.AccountClass.FIXED_ASSET)

    def account(self, code, account_type, account_class):
        return Account.objects.create(
            organisation=self.organisation, code=code, name=f"Account {code}",
            account_type=account_type, account_class=account_class, created_by=self.user,
        )

    def post(self, posting_date, description, lines):
        journal = create_journal_entry(
            organisation=self.organisation, date=posting_date,
            description=description, lines=lines, user=self.user,
        )
        return post_journal_entry(journal_entry=journal, user=self.user)

    def report(self):
        return cash_flow(
            organisation=self.organisation,
            start_date=self.PERIOD_START, end_date=self.PERIOD_END,
        )

    def assert_reconciles(self, report):
        self.assertEqual(
            report["opening_cash"] + report["total_operating"]
            + report["total_investing"] + report["total_financing"]
            + report["total_unclassified"],
            report["closing_cash"],
        )
        self.assertEqual(report["closing_cash"], report["cash_ledger_balance"])
        self.assertEqual(report["difference"], self.ZERO)

    def test_initial_capital_during_period_is_financing_and_reconciles_to_balance_sheet(self):
        amount = Decimal("1000000.00")
        self.post(self.PERIOD_START, "Initial capital", [
            {"account": self.bank, "debit": amount, "credit": self.ZERO},
            {"account": self.capital, "debit": self.ZERO, "credit": amount},
        ])
        report = self.report()
        self.assertEqual(report["total_operating"], self.ZERO)
        self.assertEqual(report["total_investing"], self.ZERO)
        self.assertEqual(report["total_financing"], amount)
        self.assertEqual(report["opening_cash"], self.ZERO)
        self.assertEqual(report["net_cash_flow"], amount)
        self.assertEqual(report["closing_cash"], amount)
        self.assert_reconciles(report)
        statement = balance_sheet(
            organisation=self.organisation, as_of_date=self.PERIOD_END,
        )
        cash_on_balance_sheet = sum(
            (row["amount"] for row in statement["assets"] if row["account"]["account_class"] == Account.AccountClass.BANK),
            self.ZERO,
        )
        self.assertEqual(report["closing_cash"], cash_on_balance_sheet)

    def test_preperiod_capital_is_opening_cash_and_date_boundaries_are_inclusive(self):
        million = Decimal("1000000.00")
        self.post(date(2026, 3, 31), "Earlier capital", [
            {"account": self.bank, "debit": million, "credit": self.ZERO},
            {"account": self.capital, "debit": self.ZERO, "credit": million},
        ])
        self.post(self.PERIOD_START, "First-day receipt", [
            {"account": self.bank, "debit": Decimal("10.00"), "credit": self.ZERO},
            {"account": self.sales, "debit": self.ZERO, "credit": Decimal("10.00")},
        ])
        self.post(self.PERIOD_END, "Last-day rent", [
            {"account": self.rent, "debit": Decimal("2.00"), "credit": self.ZERO},
            {"account": self.bank, "debit": self.ZERO, "credit": Decimal("2.00")},
        ])
        report = self.report()
        self.assertEqual(report["opening_cash"], million)
        self.assertEqual(report["total_financing"], self.ZERO)
        self.assertEqual(report["total_operating"], Decimal("8.00"))
        self.assertEqual(report["closing_cash"], Decimal("1000008.00"))
        self.assert_reconciles(report)

    def test_cash_and_credit_trading_transactions_use_only_actual_cash(self):
        self.post(self.PERIOD_START, "Cash sale", [
            {"account": self.bank, "debit": Decimal("10000.00"), "credit": self.ZERO},
            {"account": self.sales, "debit": self.ZERO, "credit": Decimal("10000.00")},
        ])
        self.post(self.PERIOD_START, "Unpaid sale", [
            {"account": self.receivable, "debit": Decimal("7000.00"), "credit": self.ZERO},
            {"account": self.sales, "debit": self.ZERO, "credit": Decimal("7000.00")},
        ])
        self.post(date(2026, 4, 2), "Customer payment", [
            {"account": self.bank, "debit": Decimal("7000.00"), "credit": self.ZERO},
            {"account": self.receivable, "debit": self.ZERO, "credit": Decimal("7000.00")},
        ])
        self.post(date(2026, 4, 3), "Unpaid supplier bill", [
            {"account": self.rent, "debit": Decimal("3000.00"), "credit": self.ZERO},
            {"account": self.payable, "debit": self.ZERO, "credit": Decimal("3000.00")},
        ])
        self.post(date(2026, 4, 4), "Supplier payment", [
            {"account": self.payable, "debit": Decimal("3000.00"), "credit": self.ZERO},
            {"account": self.bank, "debit": self.ZERO, "credit": Decimal("3000.00")},
        ])
        report = self.report()
        self.assertEqual(report["total_operating"], Decimal("14000.00"))
        self.assertEqual(report["net_cash_flow"], Decimal("14000.00"))
        self.assert_reconciles(report)

    def test_investing_financing_loan_and_non_cash_transactions(self):
        self.post(self.PERIOD_START, "Equipment paid", [
            {"account": self.equipment, "debit": Decimal("50000.00"), "credit": self.ZERO},
            {"account": self.bank, "debit": self.ZERO, "credit": Decimal("50000.00")},
        ])
        self.post(date(2026, 4, 2), "Loan received", [
            {"account": self.bank, "debit": Decimal("100000.00"), "credit": self.ZERO},
            {"account": self.loan, "debit": self.ZERO, "credit": Decimal("100000.00")},
        ])
        self.post(date(2026, 4, 3), "Loan principal repaid", [
            {"account": self.loan, "debit": Decimal("25000.00"), "credit": self.ZERO},
            {"account": self.bank, "debit": self.ZERO, "credit": Decimal("25000.00")},
        ])
        self.post(date(2026, 4, 4), "Non-cash capital contribution", [
            {"account": self.equipment, "debit": Decimal("9000.00"), "credit": self.ZERO},
            {"account": self.capital, "debit": self.ZERO, "credit": Decimal("9000.00")},
        ])
        report = self.report()
        self.assertEqual(report["total_investing"], Decimal("-50000.00"))
        self.assertEqual(report["total_financing"], Decimal("75000.00"))
        self.assertEqual(report["net_cash_flow"], Decimal("25000.00"))
        self.assert_reconciles(report)

    def test_internal_transfer_compound_financing_and_multiple_banks_do_not_double_count(self):
        self.post(self.PERIOD_START, "Compound finance", [
            {"account": self.bank, "debit": Decimal("1000000.00"), "credit": self.ZERO},
            {"account": self.capital, "debit": self.ZERO, "credit": Decimal("800000.00")},
            {"account": self.loan, "debit": self.ZERO, "credit": Decimal("200000.00")},
        ])
        self.post(date(2026, 4, 2), "Internal transfer", [
            {"account": self.savings, "debit": Decimal("5000.00"), "credit": self.ZERO},
            {"account": self.bank, "debit": self.ZERO, "credit": Decimal("5000.00")},
        ])
        report = self.report()
        self.assertEqual(report["total_financing"], Decimal("1000000.00"))
        self.assertEqual(sum((row["amount"] for row in report["financing"]), self.ZERO), Decimal("1000000.00"))
        self.assertEqual(report["closing_cash"], Decimal("1000000.00"))
        self.assert_reconciles(report)

    def test_reversal_nets_to_zero_and_drilldown_is_auditable_and_scoped(self):
        original = self.post(self.PERIOD_START, "Receipt to reverse", [
            {"account": self.bank, "debit": Decimal("500.00"), "credit": self.ZERO},
            {"account": self.sales, "debit": self.ZERO, "credit": Decimal("500.00")},
        ])
        reverse_journal_entry(
            journal_entry=original, user=self.user, reversal_date=date(2026, 4, 2),
        )
        report = self.report()
        self.assertEqual(report["net_cash_flow"], self.ZERO)
        self.assertEqual(report["closing_cash"], self.ZERO)
        self.assert_reconciles(report)
        detail = cash_flow_drilldown(
            organisation=self.organisation, row_key=self.sales.id,
            start_date=self.PERIOD_START, end_date=self.PERIOD_END,
        )
        self.assertEqual(detail["amount"], self.ZERO)
        self.assertEqual(len(detail["transactions"]), 2)
        for transaction in detail["transactions"]:
            self.assertIn(transaction["journal_status"], {"posted", "reversed"})
            self.assertEqual(transaction["cash_accounts"][0]["account_class"], Account.AccountClass.BANK)
            self.assertEqual(transaction["cash_flow_category"], "operating")
        foreign = Organisation.objects.create(name="Foreign Cash Flow", created_by=self.user)
        self.assertIsNone(cash_flow_drilldown(
            organisation=foreign, row_key=self.sales.id,
            start_date=self.PERIOD_START, end_date=self.PERIOD_END,
        ))

    def test_cash_flow_api_requires_authentication_and_organisation_membership(self):
        endpoint = "/api/v1/reports/cash-flow/?start_date=2026-04-01&end_date=2026-04-30"
        client = APIClient()
        self.assertEqual(
            client.get(endpoint, HTTP_X_ORGANISATION_ID=str(self.organisation.id)).status_code,
            401,
        )
        client.force_authenticate(self.user)
        response = client.get(endpoint, HTTP_X_ORGANISATION_ID=str(self.organisation.id))
        self.assertEqual(response.status_code, 200, response.content)
        foreign = Organisation.objects.create(name="No Membership", created_by=self.user)
        self.assertEqual(
            client.get(endpoint, HTTP_X_ORGANISATION_ID=str(foreign.id)).status_code,
            403,
        )
