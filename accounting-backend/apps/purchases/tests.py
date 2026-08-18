from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.accounting.models import Account
from apps.contacts.models import Contact
from apps.organisations.models import Organisation, OrganisationMember


class PurchasesApiWorkflowTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="purchases-owner", email="purchases@example.com", password="test-pass",
            first_name="Purchases", last_name="Owner",
        )
        self.organisation = Organisation.objects.create(name="Purchases Test", created_by=self.user)
        OrganisationMember.objects.create(
            organisation=self.organisation, user=self.user, role=OrganisationMember.Role.OWNER,
        )
        self.supplier = Contact.objects.create(
            organisation=self.organisation, created_by=self.user, name="Demo Supplier",
            is_supplier=True, currency="GBP",
        )
        self.expense = self._account("5000", "Office expense", "expense", "operating_expense")
        self._account("2100", "Payables", "liability", "payable")
        self.bank = self._account("1000", "Bank", "asset", "bank")
        self.client.force_authenticate(self.user)
        self.headers = {"HTTP_X_ORGANISATION_ID": str(self.organisation.id)}

    def _account(self, code, name, account_type, account_class):
        return Account.objects.create(
            organisation=self.organisation, created_by=self.user, code=code, name=name,
            account_type=account_type, account_class=account_class, currency="GBP",
        )

    def test_bill_approval_and_partial_then_final_payment(self):
        response = self.client.post("/api/v1/bills/", {
            "bill_number": "BILL-DEMO-1", "supplier_id": str(self.supplier.id),
            "supplier_reference": "SUP-1", "issue_date": "2026-08-13",
            "due_date": "2026-09-12", "currency": "GBP", "notes": "", "lines": [{
                "description": "Office costs", "quantity": "1", "unit_price": "500.00",
                "discount_amount": "0", "tax_rate": "0",
                "expense_account_id": str(self.expense.id),
            }],
        }, format="json", **self.headers)
        self.assertEqual(response.status_code, 201, response.data)
        bill_id = response.data["id"]

        response = self.client.post(
            f"/api/v1/bills/{bill_id}/approve/", {}, format="json", **self.headers
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "approved")

        for amount, expected in (("200.00", "partly_paid"), ("300.00", "paid")):
            response = self.client.post("/api/v1/supplier-payments/", {
                "supplier_id": str(self.supplier.id), "bill_id": bill_id,
                "bank_account_id": str(self.bank.id), "payment_date": "2026-08-13",
                "amount": amount, "currency": "GBP", "reference": "demo payment", "notes": "",
            }, format="json", **self.headers)
            self.assertEqual(response.status_code, 201, response.data)
            bill = self.client.get(f"/api/v1/bills/{bill_id}/", **self.headers)
            self.assertEqual(bill.data["status"], expected)

    def test_purchase_order_approval_and_bill_conversion(self):
        response=self.client.post("/api/v1/purchase-orders/", {
            "purchase_order_number": "PO-1", "supplier_id": str(self.supplier.id),
            "order_date": "2026-08-13", "expected_delivery_date": "2026-08-20",
            "currency": "GBP", "supplier_reference": "SUP-PO", "notes": "", "lines": [{
                "description": "Office costs", "quantity": "2", "unit_price": "25",
                "discount_amount": "0", "tax_rate": "0",
                "expense_account_id": str(self.expense.id),
            }],
        }, format="json", **self.headers)
        self.assertEqual(response.status_code, 201, response.data)
        order_id=response.data["id"]
        approved=self.client.post(f"/api/v1/purchase-orders/{order_id}/approve/", {}, format="json", **self.headers)
        self.assertEqual(approved.status_code, 200, approved.data)
        converted=self.client.post(f"/api/v1/purchase-orders/{order_id}/convert-to-bill/", {
            "bill_number": "BILL-PO-1", "issue_date": "2026-08-13", "due_date": "2026-09-13",
        }, format="json", **self.headers)
        self.assertEqual(converted.status_code, 201, converted.data)
        self.assertEqual(converted.data["total"], "50.00")
