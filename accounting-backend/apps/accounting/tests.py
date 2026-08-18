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
