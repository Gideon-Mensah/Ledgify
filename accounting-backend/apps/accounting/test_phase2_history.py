"""Independent historical control-account examples: values are calculated by hand."""
from datetime import date
from decimal import Decimal
from django.test import TestCase
from . import test_phase2_integrity as fixtures
from .models import Account, AccountingPeriod
from apps.contacts.models import Contact
from apps.finance.services.aging import aged_receivables, aged_payables
from apps.finance.services.allocations.reverse_payment import reverse_payment
from apps.finance.services.corrections.reverse_document import reverse_document


class HistoricalControlTests(TestCase):
    def setUp(self):
        fixtures.AccountingIntegrityTests.setUp(self)
        AccountingPeriod.objects.create(organisation=self.org,name="February and March",start_date=date(2026,2,1),end_date=date(2026,3,31))
        def account(code,kind,klass):
            return Account.objects.create(organisation=self.org,code=code,name=klass,account_type=kind,account_class=klass,currency="GHS",created_by=self.user)
        self.ar=account("1100","asset","receivable");self.ap=account("2000","liability","payable")
        self.revenue=account("4000","revenue","sales");self.expense=account("5000","expense","operating_expense")
        self.customer=Contact.objects.create(organisation=self.org,name="Customer",currency="GHS",is_customer=True,created_by=self.user)
        self.supplier=Contact.objects.create(organisation=self.org,name="Supplier",currency="GHS",is_supplier=True,created_by=self.user)

    def invoice(self, number="INV", approve=True):
        from apps.sales.services.invoices import create_invoice, approve_invoice
        row=create_invoice(organisation=self.org,customer=self.customer,invoice_number=number,issue_date=date(2026,1,15),due_date=date(2026,1,31),currency="GHS",user=self.user,
            lines=[{"description":"Service","quantity":1,"unit_price":"120.00","revenue_account":self.revenue}])
        return approve_invoice(invoice=row,user=self.user) if approve else row

    def bill(self):
        from apps.purchases.services.bills import create_bill,approve_bill
        row=create_bill(organisation=self.org,supplier=self.supplier,bill_number="BILL",issue_date=date(2026,1,15),due_date=date(2026,1,31),currency="GHS",user=self.user,
            lines=[{"description":"Purchase","quantity":1,"unit_price":"120.00","expense_account":self.expense}])
        return approve_bill(bill=row,user=self.user)

    def assert_report(self, report, expected):
        self.assertEqual(report["total_outstanding"],Decimal(expected))
        self.assertEqual(report["control_balance"],Decimal(expected))
        self.assertEqual(report["other_control_movements"],0)
        self.assertTrue(report["reconciled"])
        self.assertEqual(report["reconciliation_difference"],0)

    def test_invoice_payment_and_reversal_preserve_january(self):
        from apps.sales.services.payments import create_customer_payment
        invoice=self.invoice()
        payment=create_customer_payment(organisation=self.org,customer=self.customer,invoice=invoice,bank_account=self.bank,payment_date=date(2026,2,1),amount="120",currency="GHS",user=self.user)
        report=lambda on:aged_receivables(organisation=self.org,as_of_date=on)
        self.assert_report(report(date(2026,1,31)),"120")
        self.assert_report(report(date(2026,2,1)),"0")
        reverse_payment(organisation=self.org,payment=payment,user=self.user,reversal_date=date(2026,2,10),reason="Bank returned receipt")
        self.assert_report(report(date(2026,1,31)),"120")
        self.assert_report(report(date(2026,2,9)),"0")
        self.assert_report(report(date(2026,2,10)),"120")
        self.assertEqual(report(date(2026,1,31))["buckets"]["current"],120)
        self.assertEqual(report(date(2026,2,10))["buckets"]["1_30"],120)

    def test_bill_payment_and_reversal_preserve_january(self):
        from apps.purchases.services.payments import create_supplier_payment
        bill=self.bill()
        payment=create_supplier_payment(organisation=self.org,supplier=self.supplier,bill=bill,bank_account=self.bank,payment_date=date(2026,2,1),amount="120",currency="GHS",user=self.user)
        report=lambda on:aged_payables(organisation=self.org,as_of_date=on)
        self.assert_report(report(date(2026,1,31)),"120")
        self.assert_report(report(date(2026,2,1)),"0")
        reverse_payment(organisation=self.org,payment=payment,user=self.user,reversal_date=date(2026,2,10),reason="Payment returned")
        self.assert_report(report(date(2026,2,9)),"0")
        self.assert_report(report(date(2026,2,10)),"120")

    def test_draft_and_later_document_reversal(self):
        self.invoice("DRAFT",approve=False)
        invoice=self.invoice()
        reverse_document(organisation=self.org,document=invoice,user=self.user,reversal_date=date(2026,2,1),reason="Cancel incorrect invoice")
        self.assert_report(aged_receivables(organisation=self.org,as_of_date=date(2026,1,31)),"120")
        self.assert_report(aged_receivables(organisation=self.org,as_of_date=date(2026,2,1)),"0")

    def test_future_writeoff_preserves_prior_balance(self):
        from apps.sales.services.write_offs import create_bad_debt_write_off
        invoice=self.invoice()
        create_bad_debt_write_off(organisation=self.org,invoice=invoice,write_off_date=date(2026,2,1),amount="20",bad_debt_account=self.expense,user=self.user,reason="Unrecoverable")
        self.assert_report(aged_receivables(organisation=self.org,as_of_date=date(2026,1,31)),"120")
        self.assert_report(aged_receivables(organisation=self.org,as_of_date=date(2026,2,1)),"100")

    def test_unallocated_receipt_and_later_allocation(self):
        from apps.sales.services.payments import create_customer_payment
        from apps.finance.services.allocations import allocate_customer_payment
        invoice=self.invoice()
        payment=create_customer_payment(organisation=self.org,customer=self.customer,bank_account=self.bank,payment_date=date(2026,1,20),amount="30",currency="GHS",user=self.user)
        allocate_customer_payment(organisation=self.org,payment=payment,invoice=invoice,amount="30",user=self.user,effective_date=date(2026,2,1))
        old=aged_receivables(organisation=self.org,as_of_date=date(2026,1,31))
        new=aged_receivables(organisation=self.org,as_of_date=date(2026,2,1))
        self.assert_report(old,"90");self.assert_report(new,"90")
        self.assertEqual(old["gross_outstanding"],120);self.assertEqual(old["unallocated_payments"],30)
        self.assertEqual(new["gross_outstanding"],90);self.assertEqual(new["unallocated_payments"],0)

    def test_fractional_fx_partial_payments_clear_exact_carrying_value(self):
        from apps.fx.models import Currency, ExchangeRate
        from apps.sales.services.invoices import create_invoice,approve_invoice
        from apps.sales.services.payments import create_customer_payment
        Currency.objects.get_or_create(code="USD",defaults={"name":"US dollar"})
        Currency.objects.get_or_create(code="GHS",defaults={"name":"Cedi"})
        ExchangeRate.objects.create(organisation=self.org,base_currency_id="USD",target_currency_id="GHS",effective_date=date(2026,1,1),rate=Decimal("1.5"))
        gain=Account.objects.create(organisation=self.org,code="4100",name="FX gain",account_type="revenue",account_class="other_income",currency="GHS",created_by=self.user)
        loss=Account.objects.create(organisation=self.org,code="5100",name="FX loss",account_type="expense",account_class="other_expense",currency="GHS",created_by=self.user)
        self.org.fx_gain_account=gain;self.org.fx_loss_account=loss;self.org.save()
        bank=Account.objects.create(organisation=self.org,code="1010",name="USD bank",account_type="asset",account_class="bank",currency="USD",created_by=self.user)
        invoice=create_invoice(organisation=self.org,customer=self.customer,invoice_number="FX-CENTS",issue_date=date(2026,1,15),due_date=date(2026,1,31),currency="USD",user=self.user,
            lines=[{"description":"Tiny foreign invoice","quantity":1,"unit_price":"0.03","revenue_account":self.revenue}])
        approve_invoice(invoice=invoice,user=self.user)
        for day in (20,21,22):
            create_customer_payment(organisation=self.org,customer=self.customer,invoice=invoice,bank_account=bank,payment_date=date(2026,1,day),amount="0.01",currency="USD",user=self.user)
        report=aged_receivables(organisation=self.org,as_of_date=date(2026,1,31))
        self.assert_report(report,"0")
        invoice.refresh_from_db()
        self.assertEqual(invoice.base_currency_amount,Decimal("0.05"))
        self.assertEqual(list(invoice.payment_allocations.order_by("effective_date").values_list("carrying_base_amount",flat=True)),[Decimal("0.02"),Decimal("0.02"),Decimal("0.01")])

    def test_later_customer_credit_and_allocation_preserve_cutoff(self):
        from apps.sales.services.credit_notes import create_customer_credit_note,approve_customer_credit_note,apply_customer_credit_note
        invoice=self.invoice()
        credit=create_customer_credit_note(organisation=self.org,customer=self.customer,credit_note_number="CREDIT",issue_date=date(2026,2,1),currency="GHS",user=self.user,
            lines=[{"description":"Credit","quantity":1,"unit_price":"20","revenue_account":self.revenue}])
        approve_customer_credit_note(credit_note=credit,user=self.user)
        apply_customer_credit_note(credit_note=credit,invoice=invoice,amount="20",user=self.user,effective_date=date(2026,2,2))
        self.assert_report(aged_receivables(organisation=self.org,as_of_date=date(2026,1,31)),"120")
        on_credit=aged_receivables(organisation=self.org,as_of_date=date(2026,2,1))
        self.assert_report(on_credit,"100");self.assertEqual(on_credit["unallocated_credits"],20)
        on_allocation=aged_receivables(organisation=self.org,as_of_date=date(2026,2,2))
        self.assert_report(on_allocation,"100");self.assertEqual(on_allocation["unallocated_credits"],0)

    def test_unallocation_effective_date_does_not_change_prior_report(self):
        from apps.sales.services.payments import create_customer_payment
        from apps.finance.services.allocations.unallocate_payment import unallocate_payment
        invoice=self.invoice()
        payment=create_customer_payment(organisation=self.org,customer=self.customer,invoice=invoice,bank_account=self.bank,payment_date=date(2026,1,20),amount="30",currency="GHS",user=self.user)
        unallocate_payment(organisation=self.org,allocation=payment.allocations.get(),user=self.user,effective_date=date(2026,2,1),reason="Reallocate to another invoice")
        before=aged_receivables(organisation=self.org,as_of_date=date(2026,1,31))
        after=aged_receivables(organisation=self.org,as_of_date=date(2026,2,1))
        self.assert_report(before,"90");self.assert_report(after,"90")
        self.assertEqual(before["gross_outstanding"],90);self.assertEqual(before["unallocated_payments"],0)
        self.assertEqual(after["gross_outstanding"],120);self.assertEqual(after["unallocated_payments"],30)

    def test_failed_posting_rolls_back_payment_allocation_and_journal(self):
        from unittest.mock import patch
        from apps.sales.services.payments import create_customer_payment
        from apps.sales.models import CustomerPayment,CustomerPaymentAllocation
        from .models import JournalEntry
        from common.exceptions import BusinessRuleError
        invoice=self.invoice();before=JournalEntry.objects.count()
        with patch('apps.sales.services.payments.create_customer_payment.post_journal_entry',side_effect=BusinessRuleError("Injected posting failure")):
            with self.assertRaises(BusinessRuleError):
                create_customer_payment(organisation=self.org,customer=self.customer,invoice=invoice,bank_account=self.bank,payment_date=date(2026,1,20),amount="30",currency="GHS",user=self.user)
        self.assertEqual(CustomerPayment.objects.count(),0)
        self.assertEqual(CustomerPaymentAllocation.objects.count(),0)
        self.assertEqual(JournalEntry.objects.count(),before)
        invoice.refresh_from_db();self.assertEqual(invoice.amount_paid,0)

    def test_supplier_credit_cutoffs_and_statement_reversal(self):
        from apps.purchases.services.credits import create_supplier_credit,approve_supplier_credit,apply_supplier_credit
        from apps.finance.services.statements import supplier_statement
        bill=self.bill()
        credit=create_supplier_credit(organisation=self.org,supplier=self.supplier,credit_number="SC",issue_date=date(2026,2,1),currency="GHS",user=self.user,
            lines=[{"description":"Supplier credit","quantity":1,"unit_price":"20","expense_account":self.expense}])
        approve_supplier_credit(credit=credit,user=self.user)
        apply_supplier_credit(credit=credit,bill=bill,amount="20",user=self.user,effective_date=date(2026,2,2))
        self.assert_report(aged_payables(organisation=self.org,as_of_date=date(2026,1,31)),"120")
        first=aged_payables(organisation=self.org,as_of_date=date(2026,2,1))
        self.assert_report(first,"100");self.assertEqual(first["unallocated_credits"],20)
        second=aged_payables(organisation=self.org,as_of_date=date(2026,2,2))
        self.assert_report(second,"100");self.assertEqual(second["unallocated_credits"],0)
        statement=supplier_statement(organisation=self.org,supplier=self.supplier,end_date=date(2026,1,31))
        self.assertEqual(statement["closing_balance"],120)
        self.assertEqual(statement["currency"],"GHS")

    def test_customer_statement_retains_original_before_payment_reversal(self):
        from apps.sales.services.payments import create_customer_payment
        from apps.finance.services.statements import customer_statement
        invoice=self.invoice()
        payment=create_customer_payment(organisation=self.org,customer=self.customer,invoice=invoice,bank_account=self.bank,payment_date=date(2026,1,20),amount="30",currency="GHS",user=self.user)
        reverse_payment(organisation=self.org,payment=payment,user=self.user,reversal_date=date(2026,2,1),reason="Receipt returned")
        before=customer_statement(organisation=self.org,customer=self.customer,end_date=date(2026,1,31))
        after=customer_statement(organisation=self.org,customer=self.customer,start_date=date(2026,2,1),end_date=date(2026,2,1))
        self.assertEqual(before["closing_balance"],90)
        self.assertEqual(after["opening_balance"],90)
        self.assertEqual(after["closing_balance"],120)
        self.assertEqual(after["transactions"][0]["type"],"reversal")

    def test_multiline_foreign_tax_and_rounding_residual_reconcile(self):
        from apps.fx.models import Currency,ExchangeRate
        from apps.tax.models import TaxRate
        from apps.tax.services import tax_summary
        from apps.sales.services.invoices import create_invoice,approve_invoice
        self.org.tax_registered=True
        gain=Account.objects.create(organisation=self.org,code="4100",name="Gain",account_type="revenue",account_class="other_income",currency="GHS",created_by=self.user)
        loss=Account.objects.create(organisation=self.org,code="5100",name="Loss",account_type="expense",account_class="other_expense",currency="GHS",created_by=self.user)
        tax=Account.objects.create(organisation=self.org,code="2200",name="Tax",account_type="liability",account_class="current_liability",currency="GHS",created_by=self.user)
        self.org.fx_gain_account=gain;self.org.fx_loss_account=loss;self.org.save()
        Currency.objects.get_or_create(code="USD",defaults={"name":"US dollar"});Currency.objects.get_or_create(code="GHS",defaults={"name":"Cedi"})
        ExchangeRate.objects.create(organisation=self.org,base_currency_id="USD",target_currency_id="GHS",effective_date=date(2026,1,1),rate=Decimal("1.5"))
        rate=TaxRate.objects.create(organisation=self.org,code="TEST10",name="Configurable fixture rate",rate=10,tax_type="OTHER",scope="SALES",effective_from=date(2026,1,1),output_tax_account=tax,created_by=self.user)
        invoice=create_invoice(organisation=self.org,customer=self.customer,invoice_number="FX-TAX",issue_date=date(2026,1,15),due_date=date(2026,1,31),currency="USD",user=self.user,
            lines=[{"description":"Fractional tax","quantity":1,"unit_price":"0.05","revenue_account":self.revenue,"tax_rate_config":rate} for _ in range(3)])
        invoice=approve_invoice(invoice=invoice,user=self.user)
        lines=list(invoice.accounting_journal.lines.all())
        self.assertEqual(sum(row.debit for row in lines),Decimal("0.28"))
        self.assertEqual(sum(row.credit for row in lines),Decimal("0.28"))
        self.assertEqual(invoice.accounting_journal.lines.get(account=tax).credit,Decimal("0.05"))
        self.assertEqual(invoice.accounting_journal.lines.get(account=loss).debit,Decimal("0.01"))
        self.assertEqual(tax_summary(organisation=self.org)["output_tax"],Decimal("0.05"))
