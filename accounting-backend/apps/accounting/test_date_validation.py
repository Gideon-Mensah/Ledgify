"""Regression tests for strict accounting calendar-date API inputs."""

from django.test import SimpleTestCase

from apps.accounting.serializers import ManualJournalInputSerializer
from apps.purchases.serializers import BillSerializer, SupplierPaymentSerializer
from apps.sales.serializers import CustomerPaymentSerializer, InvoiceSerializer


class AccountingDateValidationTests(SimpleTestCase):
    def assert_date_error(self, serializer_class, field, value, message):
        serializer = serializer_class(data={field: value}, partial=True)
        self.assertFalse(serializer.is_valid())
        self.assertEqual(str(serializer.errors[field][0]), message)

    def test_rejects_ambiguous_and_impossible_document_dates(self):
        self.assert_date_error(
            InvoiceSerializer,
            "issue_date",
            "27/08/2026",
            "Enter a valid invoice date in YYYY-MM-DD format.",
        )
        self.assert_date_error(
            BillSerializer,
            "due_date",
            "2026-02-29",
            "Enter a valid bill due date in YYYY-MM-DD format.",
        )

    def test_rejects_ambiguous_transaction_dates(self):
        self.assert_date_error(
            CustomerPaymentSerializer,
            "payment_date",
            "08/27/2026",
            "Enter a valid payment date in YYYY-MM-DD format.",
        )
        self.assert_date_error(
            SupplierPaymentSerializer,
            "payment_date",
            "2026-13-01",
            "Enter a valid payment date in YYYY-MM-DD format.",
        )
        self.assert_date_error(
            ManualJournalInputSerializer,
            "date",
            "2026-04-31",
            "Enter a valid journal date in YYYY-MM-DD format.",
        )
