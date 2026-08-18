from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from apps.accounting.services.reports import balance_sheet, trial_balance
from apps.banking.models import BankTransaction
from apps.finance.services import (
    aged_payables,
    aged_receivables,
    customer_balance_summary,
    supplier_balance_summary,
)
from apps.inventory.models import StockMovement
from apps.organisations.models import Organisation
from apps.purchases.models import Bill, SupplierPayment
from apps.sales.models import CustomerPayment, Invoice


class DemoSeedCommandTests(TestCase):
    def test_seed_is_idempotent_and_financially_consistent(self):
        options = {"email": "demo-seed@example.com", "password": "test-password"}
        call_command("seed_demo_data", **options)
        call_command("seed_demo_data", **options)
        organisation = Organisation.objects.get(name="Ledgify Demo Ltd")
        today = timezone.localdate()

        self.assertEqual(Invoice.objects.filter(organisation=organisation).count(), 3)
        self.assertEqual(CustomerPayment.objects.filter(organisation=organisation).count(), 2)
        self.assertEqual(Bill.objects.filter(organisation=organisation).count(), 3)
        self.assertEqual(SupplierPayment.objects.filter(organisation=organisation).count(), 2)
        self.assertEqual(BankTransaction.objects.filter(organisation=organisation).count(), 2)
        self.assertEqual(StockMovement.objects.filter(organisation=organisation).count(), 4)
        self.assertTrue(trial_balance(organisation=organisation, as_of_date=today)["balanced"])
        self.assertTrue(balance_sheet(organisation=organisation, as_of_date=today)["balanced"])
        self.assertEqual(
            aged_receivables(organisation=organisation, as_of_date=today)["total_outstanding"],
            customer_balance_summary(organisation=organisation)["total_outstanding"],
        )
        self.assertEqual(
            aged_payables(organisation=organisation, as_of_date=today)["total_outstanding"],
            supplier_balance_summary(organisation=organisation)["total_outstanding"],
        )
        # The isolated seed database must also pass every deployment accounting
        # reconciliation, not only the individual report assertions above.
        call_command("accounting_health_check")
