from datetime import date
from decimal import Decimal
from django.test import TestCase
from rest_framework.test import APIClient
from apps.tax.tests import TaxEngineTests
from apps.tax.models import TaxTransaction
from apps.tax.services.register_service import tax_register
from apps.tax.services import tax_summary
from apps.sales.services.invoices import create_invoice, approve_invoice
from apps.accounting.services.journals.reverse_journal import reverse_journal_entry
from apps.organisations.models import Organisation, OrganisationMember


class TaxWorkspaceTests(TestCase):
    setUp = TaxEngineTests.setUp
    account = TaxEngineTests.account
    rate = TaxEngineTests.rate

    def invoice(self, number="TAX-1", on=date(2026, 8, 1), amount=100):
        rate = self.rate(number, 10)
        document = create_invoice(organisation=self.org, customer=self.customer, invoice_number=number,
                                 issue_date=on, due_date=on, currency="USD", user=self.user,
                                 lines=[{"description": "Taxable sale", "quantity": 1, "unit_price": amount,
                                         "revenue_account": self.revenue, "tax_rate_config": rate}])
        return approve_invoice(invoice=document, user=self.user)

    def request(self, path, data=None, method="get", org=None):
        client = APIClient(); client.force_authenticate(self.user)
        return getattr(client, method)(f"/api/v1/{path}", data=data or {}, format="json", HTTP_X_ORGANISATION_ID=str((org or self.org).id))

    def test_dated_reversal_preserves_original_period_and_offsets_later_period(self):
        invoice = self.invoice()
        reverse_journal_entry(journal_entry=invoice.accounting_journal, user=self.user, reversal_date=date(2026, 9, 1))
        august = tax_summary(organisation=self.org, start_date=date(2026, 8, 1), end_date=date(2026, 8, 31))
        september = tax_summary(organisation=self.org, start_date=date(2026, 9, 1), end_date=date(2026, 9, 30))
        self.assertEqual(august["output_tax"], Decimal("10.00"))
        self.assertEqual(september["output_tax"], Decimal("-10.00"))
        self.assertEqual(tax_summary(organisation=self.org)["net_tax_due_or_refundable"], 0)
        register = tax_register(organisation=self.org)
        self.assertEqual(register["count"], 2)
        self.assertTrue(register["results"][0]["is_reversal"])
        self.assertEqual(TaxTransaction.objects.count(), 1)

    def test_summary_and_register_share_filters_and_inclusive_dates(self):
        first = self.invoice("FIRST")
        self.invoice("SECOND", date(2026, 8, 31), 200)
        self.invoice("OUTSIDE", date(2026, 9, 1), 300)
        filters = {"start_date": "2026-08-01", "end_date": "2026-08-31", "search": "FIRST", "direction": "OUTPUT"}
        report = self.request("tax-transactions/register/", filters)
        self.assertEqual(report.status_code, 200, report.data)
        self.assertEqual(report.data["count"], 1)
        summary = self.request("tax/reports/summary/", filters)
        self.assertEqual(summary.data["output_tax"], 10)
        tax_rate = str(first.lines.get().tax_rate_config_id)
        self.assertEqual(self.request("tax/reports/summary/", {"tax_rate": tax_rate}).data["output_tax"], 10)
        self.assertEqual(self.request("tax/reports/summary/", {"direction": "INPUT"}).data["output_tax"], 0)
        self.assertEqual(self.request("tax-transactions/register/", {"ordering": "tax_amount"}).data["results"][0]["document_number"], "FIRST")

    def test_invalid_filters_are_400_and_other_organisation_is_isolated(self):
        self.invoice()
        other = Organisation.objects.create(name="Other", base_currency="GHS", created_by=self.user)
        OrganisationMember.objects.create(organisation=other, user=self.user, role="owner")
        self.assertEqual(self.request("tax-transactions/register/", org=other).data["results"], [])
        for filters in ({"start_date": "bad"}, {"start_date": "2026-09-01", "end_date": "2026-08-01"}, {"tax_rate": "bad"}, {"ordering": "contact__email"}):
            self.assertEqual(self.request("tax-transactions/register/", filters).status_code, 400)
        self.assertEqual(self.request("tax-transactions/", {"start_date": "bad"}).status_code, 400)

    def test_excluded_and_awaiting_journals_do_not_contribute_to_totals(self):
        invoice = self.invoice()
        from apps.accounting.models import JournalEntry
        for status, treatment in [("void", "excluded"), ("draft", "awaiting")]:
            JournalEntry.objects.filter(pk=invoice.accounting_journal_id).update(status=status)
            result = tax_register(organisation=self.org)
            self.assertEqual(result["results"][0]["inclusion"], treatment)
            self.assertEqual(result["summary"]["output_tax"], 0)

    def test_rate_validation_permissions_defaults_and_safe_deletion(self):
        invoice = self.invoice()
        rate = invoice.lines.get().tax_rate_config
        self.assertEqual(self.request(f"tax-rates/{rate.id}/", method="delete").status_code, 400)
        for data in ({"rate": "-1"}, {"rate": "101"}, {"effective_to": "2025-01-01"}):
            self.assertEqual(self.request(f"tax-rates/{rate.id}/", data, "patch").status_code, 400)
        self.assertEqual(self.request(f"tax-rates/{rate.id}/", {"status": "INACTIVE"}, "patch").status_code, 200)
        transaction = TaxTransaction.objects.get(); self.assertEqual(transaction.tax_amount, 10)
        member = OrganisationMember.objects.get(organisation=self.org, user=self.user); member.role = "viewer"; member.save()
        self.assertEqual(self.request(f"tax-rates/{rate.id}/", {"status": "ACTIVE"}, "patch").status_code, 403)
        self.assertEqual(self.request("tax-transactions/register/").status_code, 200)

    def test_foreign_amounts_use_stored_journal_rate_and_do_not_rewrite_history(self):
        invoice = self.invoice()
        from apps.accounting.models import JournalEntry
        JournalEntry.objects.filter(pk=invoice.accounting_journal_id).update(exchange_rate=Decimal("2"))
        row = tax_register(organisation=self.org)["results"][0]
        self.assertEqual(row["tax_amount"], 20)
        self.assertEqual(row["currency"], self.org.base_currency)
        self.assertEqual(TaxTransaction.objects.get().tax_amount, 10)

    def test_input_tax_refund_and_recorded_adjustment_are_not_double_counted(self):
        from apps.purchases.services.bills import create_bill, approve_bill
        import uuid
        rate = self.rate("RECOVER", 10)
        bill = create_bill(organisation=self.org, supplier=self.supplier, bill_number="REFUND",
                           issue_date=date(2026, 8, 1), due_date=date(2026, 8, 31), currency="USD", user=self.user,
                           lines=[{"description": "Purchase", "quantity": 1, "unit_price": 1000, "expense_account": self.expense, "tax_rate_config": rate}])
        bill = approve_bill(bill=bill, user=self.user)
        self.assertEqual(tax_summary(organisation=self.org)["net_tax_due_or_refundable"], -100)
        TaxTransaction.objects.create(organisation=self.org, tax_rate=rate, tax_rate_percent=10,
            transaction_date=date(2026, 8, 2), source_type="manual_adjustment", source_id=uuid.uuid4(),
            document_number="ADJ-1", contact=self.supplier, net_amount=-100, tax_amount=-10, gross_amount=-110,
            direction="INPUT", tax_account=self.input, journal_entry=bill.accounting_journal, status="ADJUSTMENT")
        report = tax_register(organisation=self.org)
        self.assertEqual(report["summary"]["net_tax_due_or_refundable"], -90)
        self.assertEqual(report["summary"]["adjustments"], 10)
        self.assertEqual(tax_register(organisation=self.org, adjustments_only=True)["count"], 1)
        self.assertEqual(tax_summary(organisation=self.org, status="POSTED")["input_tax"], 100)

    def test_cross_organisation_tax_control_account_is_rejected(self):
        from apps.accounting.models import Account
        other = Organisation.objects.create(name="Private", base_currency="GHS", created_by=self.user)
        account = Account.objects.create(organisation=other, created_by=self.user, code="2200", name="Tax", account_type="liability", account_class="current_liability", currency="GHS")
        rate = self.rate("SAFE", 10)
        response = self.request(f"tax-rates/{rate.id}/", {"output_tax_account": str(account.id)}, "patch")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.request("tax-transactions/register/", org=other).status_code, 403)
