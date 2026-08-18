from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.accounting.models import Account
from apps.contacts.models import Contact
from apps.organisations.models import Organisation
from apps.sales.services.invoices import approve_invoice, create_invoice
from apps.purchases.services.bills import approve_bill, create_bill
from apps.sales.services.credit_notes import approve_customer_credit_note, create_customer_credit_note
from apps.purchases.services.credits import approve_supplier_credit, create_supplier_credit
from apps.tax.models import TaxRate, TaxTransaction
from apps.tax.services import calculate_tax, tax_summary


class TaxEngineTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="tax-owner", email="tax@example.com", password="x", first_name="Tax", last_name="Owner")
        self.org = Organisation.objects.create(name="Tax Test", base_currency="USD", tax_registered=True, created_by=self.user)
        from apps.organisations.models import OrganisationMember
        OrganisationMember.objects.create(organisation=self.org, user=self.user, role="owner")
        self.customer = Contact.objects.create(organisation=self.org, created_by=self.user, name="Customer", is_customer=True, currency="USD")
        self.supplier = Contact.objects.create(organisation=self.org, created_by=self.user, name="Supplier", is_supplier=True, currency="USD")
        self.revenue = self.account("4000", "Revenue", "revenue", "sales")
        self.expense = self.account("6000", "Expense", "expense", "operating_expense")
        self.ar = self.account("1100", "AR", "asset", "receivable")
        self.ap = self.account("2100", "AP", "liability", "payable")
        self.output = self.account("2200", "Output tax", "liability", "current_liability")
        self.input = self.account("1200", "Input tax", "asset", "current_asset")

    def account(self, code, name, account_type, account_class):
        return Account.objects.create(organisation=self.org, created_by=self.user, code=code, name=name,
                                      account_type=account_type, account_class=account_class, currency="USD")

    def rate(self, code, percent, recoverable=True):
        return TaxRate.objects.create(organisation=self.org, code=code, name=code, rate=percent,
                                      tax_type="OTHER", scope="BOTH", effective_from="2026-01-01",
                                      input_tax_account=self.input, output_tax_account=self.output,
                                      recoverable=recoverable, created_by=self.user)

    def test_decimal_exclusive_and_inclusive_calculation(self):
        self.assertEqual(calculate_tax(quantity=1, unit_price=1000, tax_rate=15), {
            "net_amount": Decimal("1000.00"), "tax_amount": Decimal("150.00"), "gross_amount": Decimal("1150.00")})
        self.assertEqual(calculate_tax(quantity=1, unit_price=115, tax_rate=15, tax_inclusive=True)["tax_amount"], Decimal("15.00"))

    def test_sales_and_purchase_posting_and_summary(self):
        sales_rate = self.rate("SALE15", 15)
        invoice = create_invoice(organisation=self.org, customer=self.customer, invoice_number="INV-TAX",
            issue_date=__import__("datetime").date(2026, 8, 1), due_date=__import__("datetime").date(2026, 8, 31),
            currency="USD", user=self.user, lines=[{"description": "Service", "quantity": 1,
            "unit_price": 1000, "revenue_account": self.revenue, "tax_rate_config": sales_rate}])
        approve_invoice(invoice=invoice, user=self.user)
        bill_rate = self.rate("BUY10", 10)
        bill = create_bill(organisation=self.org, supplier=self.supplier, bill_number="BILL-TAX",
            issue_date=__import__("datetime").date(2026, 8, 2), due_date=__import__("datetime").date(2026, 9, 1),
            currency="USD", user=self.user, lines=[{"description": "Cost", "quantity": 1,
            "unit_price": 500, "expense_account": self.expense, "tax_rate_config": bill_rate}])
        approve_bill(bill=bill, user=self.user)
        self.assertEqual(TaxTransaction.objects.count(), 2)
        totals = tax_summary(organisation=self.org)
        self.assertEqual(totals["output_tax"], Decimal("150.00"))
        self.assertEqual(totals["input_tax"], Decimal("50.00"))
        self.assertEqual(totals["net_tax_due_or_refundable"], Decimal("100.00"))

    def test_nonrecoverable_purchase_tax_is_expensed(self):
        rate = self.rate("NONREC10", 10, recoverable=False)
        bill = create_bill(organisation=self.org, supplier=self.supplier, bill_number="BILL-NR",
            issue_date=__import__("datetime").date(2026, 8, 2), due_date=__import__("datetime").date(2026, 9, 1),
            currency="USD", user=self.user, lines=[{"description": "Cost", "quantity": 1,
            "unit_price": 100, "expense_account": self.expense, "tax_rate_config": rate}])
        bill = approve_bill(bill=bill, user=self.user)
        expense_line = bill.accounting_journal.lines.get(account=self.expense)
        self.assertEqual(expense_line.debit, Decimal("110.00"))
        self.assertFalse(TaxTransaction.objects.exists())

    def test_rate_change_does_not_recalculate_posted_history(self):
        rate = self.rate("HIST10", 10)
        invoice = create_invoice(organisation=self.org, customer=self.customer, invoice_number="INV-HIST",
            issue_date=__import__("datetime").date(2026, 8, 1), due_date=__import__("datetime").date(2026, 8, 31),
            currency="USD", user=self.user, lines=[{"description": "Historical", "quantity": 1,
            "unit_price": 100, "revenue_account": self.revenue, "tax_rate_config": rate}])
        approve_invoice(invoice=invoice, user=self.user)
        rate.rate = Decimal("12.0000"); rate.save()
        invoice.refresh_from_db(); transaction = TaxTransaction.objects.get(source_id=invoice.id)
        self.assertEqual(invoice.lines.get().tax_rate, Decimal("10.0000"))
        self.assertEqual(invoice.lines.get().tax_amount, Decimal("10.00"))
        self.assertEqual(transaction.tax_rate_percent, Decimal("10.0000"))
        self.assertEqual(transaction.tax_amount, Decimal("10.00"))

    def test_customer_and_supplier_credits_reverse_tax(self):
        rate = self.rate("CREDIT10", 10)
        invoice = create_invoice(organisation=self.org, customer=self.customer, invoice_number="INV-CREDIT",
            issue_date=__import__("datetime").date(2026, 8, 1), due_date=__import__("datetime").date(2026, 8, 31),
            currency="USD", user=self.user, lines=[{"description": "Sale", "quantity": 1,
            "unit_price": 100, "revenue_account": self.revenue, "tax_rate_config": rate}])
        invoice = approve_invoice(invoice=invoice, user=self.user)
        credit = create_customer_credit_note(organisation=self.org, customer=self.customer,
            credit_note_number="CN-TAX", issue_date=__import__("datetime").date(2026, 8, 3), currency="USD",
            invoice=invoice, user=self.user, lines=[{"source_line_id": invoice.lines.get().id,
            "description": "Sale reversal", "quantity": 1, "unit_price": 100, "revenue_account": self.revenue}])
        approve_customer_credit_note(credit_note=credit, user=self.user)
        bill = create_bill(organisation=self.org, supplier=self.supplier, bill_number="BILL-CREDIT",
            issue_date=__import__("datetime").date(2026, 8, 1), due_date=__import__("datetime").date(2026, 8, 31),
            currency="USD", user=self.user, lines=[{"description": "Purchase", "quantity": 1,
            "unit_price": 100, "expense_account": self.expense, "tax_rate_config": rate}])
        bill = approve_bill(bill=bill, user=self.user)
        supplier_credit = create_supplier_credit(organisation=self.org, supplier=self.supplier,
            credit_number="SC-TAX", issue_date=__import__("datetime").date(2026, 8, 4), currency="USD",
            bill=bill, user=self.user, lines=[{"source_line_id": bill.lines.get().id,
            "description": "Purchase reversal", "quantity": 1, "unit_price": 100, "expense_account": self.expense}])
        approve_supplier_credit(credit=supplier_credit, user=self.user)
        totals = tax_summary(organisation=self.org)
        self.assertEqual(totals["output_tax"], Decimal("0.00"))
        self.assertEqual(totals["input_tax"], Decimal("0.00"))
