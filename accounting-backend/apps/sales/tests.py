from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.accounting.models import Account
from apps.contacts.models import Contact
from apps.organisations.models import Organisation, OrganisationMember


class SalesApiWorkflowTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="sales-owner", email="sales@example.com", password="test-pass",
            first_name="Sales", last_name="Owner",
        )
        self.organisation = Organisation.objects.create(name="Sales Test", created_by=self.user)
        OrganisationMember.objects.create(
            organisation=self.organisation, user=self.user, role=OrganisationMember.Role.OWNER,
        )
        self.customer = Contact.objects.create(
            organisation=self.organisation, created_by=self.user, name="Demo Customer",
            is_customer=True, currency="GBP",
        )
        self.revenue = self._account("4000", "Sales", "revenue", "sales")
        self._account("1100", "Receivables", "asset", "receivable")
        self.bank = self._account("1000", "Bank", "asset", "bank")
        self.client.force_authenticate(self.user)
        self.headers = {"HTTP_X_ORGANISATION_ID": str(self.organisation.id)}

    def _account(self, code, name, account_type, account_class):
        return Account.objects.create(
            organisation=self.organisation, created_by=self.user, code=code, name=name,
            account_type=account_type, account_class=account_class, currency="GBP",
        )

    def test_draft_invoice_can_be_edited_but_approved_invoice_cannot(self):
        payload = {
            "invoice_number": "INV-EDIT-1", "customer_id": str(self.customer.id),
            "issue_date": "2026-08-13", "due_date": "2026-09-12", "currency": "GBP",
            "reference": "before", "notes": "", "lines": [{
                "description": "Services", "quantity": "1.0000", "unit_price": "100.00",
                "discount_amount": "0.00", "tax_rate": "0",
                "revenue_account_id": str(self.revenue.id),
            }],
        }
        created = self.client.post("/api/v1/invoices/", payload, format="json", **self.headers)
        self.assertEqual(created.status_code, 201, created.data)
        invoice_id = created.data["id"]
        payload["reference"] = "after"
        payload["lines"][0]["quantity"] = "2.0000"
        updated = self.client.patch(f"/api/v1/invoices/{invoice_id}/", payload, format="json", **self.headers)
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(updated.data["reference"], "after")
        self.assertEqual(updated.data["total"], "200.00")
        self.client.post(f"/api/v1/invoices/{invoice_id}/approve/", {}, format="json", **self.headers)
        rejected = self.client.patch(f"/api/v1/invoices/{invoice_id}/", payload, format="json", **self.headers)
        self.assertEqual(rejected.status_code, 400, rejected.data)

    def test_invoice_approval_and_partial_then_final_payment(self):
        response = self.client.post("/api/v1/invoices/", {
            "invoice_number": "INV-DEMO-1", "customer_id": str(self.customer.id),
            "issue_date": "2026-08-13", "due_date": "2026-09-12", "currency": "GBP",
            "reference": "demo", "notes": "", "lines": [{
                "description": "Services", "quantity": "1", "unit_price": "1000.00",
                "discount_amount": "0", "tax_rate": "0",
                "revenue_account_id": str(self.revenue.id),
            }],
        }, format="json", **self.headers)
        self.assertEqual(response.status_code, 201, response.data)
        invoice_id = response.data["id"]

        response = self.client.post(
            f"/api/v1/invoices/{invoice_id}/approve/", {}, format="json", **self.headers
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "approved")

        for amount, expected in (("400.00", "partly_paid"), ("600.00", "paid")):
            response = self.client.post("/api/v1/customer-payments/", {
                "customer_id": str(self.customer.id), "invoice_id": invoice_id,
                "bank_account_id": str(self.bank.id), "payment_date": "2026-08-13",
                "amount": amount, "currency": "GBP", "reference": "demo payment", "notes": "",
            }, format="json", **self.headers)
            self.assertEqual(response.status_code, 201, response.data)
            invoice = self.client.get(f"/api/v1/invoices/{invoice_id}/", **self.headers)
            self.assertEqual(invoice.data["status"], expected)

    def test_quote_acceptance_and_invoice_conversion(self):
        response = self.client.post("/api/v1/quotes/", {
            "quote_number": "QUO-1", "customer_id": str(self.customer.id),
            "issue_date": "2026-08-13", "expiry_date": "2026-09-13", "currency": "GBP",
            "reference": "proposal", "notes": "", "lines": [{
                "description": "Consulting", "quantity": "2", "unit_price": "75",
                "discount_amount": "0", "tax_rate": "0",
                "revenue_account_id": str(self.revenue.id),
            }],
        }, format="json", **self.headers)
        self.assertEqual(response.status_code, 201, response.data)
        quote_id=response.data["id"]
        accepted=self.client.post(f"/api/v1/quotes/{quote_id}/accept/", {}, format="json", **self.headers)
        self.assertEqual(accepted.status_code, 200, accepted.data)
        converted=self.client.post(f"/api/v1/quotes/{quote_id}/convert-to-invoice/", {
            "document_number": "INV-QUOTE-1", "issue_date": "2026-08-13",
            "due_date": "2026-09-13",
        }, format="json", **self.headers)
        self.assertEqual(converted.status_code, 201, converted.data)
        self.assertEqual(converted.data["total"], "150.00")
