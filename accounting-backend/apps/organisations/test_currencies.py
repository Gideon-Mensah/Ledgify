from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from rest_framework.test import APIClient

from apps.organisations.models import Organisation, OrganisationMember
from common.currencies import validate_currency_code


class CurrencyValidationTests(TestCase):
    def setUp(self):
        self.user=get_user_model().objects.create_user(username="currency-owner",password="x")
        self.org=Organisation.objects.create(name="Currency Org",base_currency="GBP",created_by=self.user)
        OrganisationMember.objects.create(organisation=self.org,user=self.user,role="owner")
        self.client=APIClient();self.client.force_authenticate(self.user)
    def test_supported_iso_codes_are_accepted(self):
        for code in ["GHS","GBP","USD","EUR","CAD"]: self.assertEqual(validate_currency_code(code.lower()),code)
    def test_symbols_blank_unknown_and_legacy_ghana_code_are_rejected(self):
        for value in ["GH¢","GH₵","GHC","","XYZ","$"]:
            with self.assertRaises(ValidationError): validate_currency_code(value)
    def test_organisation_api_rejects_symbol_and_accepts_ghs(self):
        headers={"HTTP_X_ORGANISATION_ID":str(self.org.id)}
        bad=self.client.patch(f"/api/v1/organisations/{self.org.id}/",{"base_currency":"GH¢"},format="json",**headers)
        self.assertEqual(bad.status_code,400,bad.content)
        good=self.client.patch(f"/api/v1/organisations/{self.org.id}/",{"base_currency":"GHS"},format="json",**headers)
        self.assertEqual(good.status_code,200,good.content);self.org.refresh_from_db();self.assertEqual(self.org.base_currency,"GHS")


class CurrencyWorkflowTests(TestCase):
    def setUp(self):
        from apps.accounting.models import Account
        from apps.contacts.models import Contact
        self.user = get_user_model().objects.create_user(username="currency-workflow", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.orgs = {}
        for code in ("GBP", "GHS", "USD", "EUR"):
            org = Organisation.objects.create(name=code, base_currency=code, created_by=self.user)
            OrganisationMember.objects.create(organisation=org, user=self.user, role="owner")
            contact = Contact.objects.create(organisation=org, created_by=self.user, name=code, currency=code, is_customer=True, is_supplier=True)
            revenue = Account.objects.create(organisation=org, created_by=self.user, code="4000", name="Sales", account_type="revenue", account_class="sales", currency=code)
            expense = Account.objects.create(organisation=org, created_by=self.user, code="5000", name="Expense", account_type="expense", account_class="operating_expense", currency=code)
            self.orgs[code] = (org, contact, revenue, expense)

    def document(self, code, kind="invoice", **changes):
        org, contact, revenue, expense = self.orgs[code]
        payload = {
            f"{kind}_number": f"{code}-{kind}",
            "customer_id" if kind == "invoice" else "supplier_id": str(contact.id),
            "issue_date": "2026-08-13", "due_date": "2026-09-13",
            "lines": [{"description": "Service", "quantity": "1", "unit_price": "1000", "discount_amount": "0", "tax_rate": "0",
                       "revenue_account_id" if kind == "invoice" else "expense_account_id": str((revenue if kind == "invoice" else expense).id)}],
            **changes,
        }
        return self.client.post(f"/api/v1/{kind}s/", payload, format="json", HTTP_X_ORGANISATION_ID=str(org.id))

    def test_organisation_defaults_for_invoices_and_bills_and_switching(self):
        for code in self.orgs:
            for kind in ("invoice", "bill"):
                result = self.document(code, kind, currency="")
                self.assertEqual(result.status_code, 201, result.data)
                self.assertEqual(result.data["currency"], code)
                self.assertEqual(result.data["total"], "1000.00")
        result = self.document("GHS", invoice_number="GHS-omitted")
        self.assertEqual(result.status_code, 201, result.data)
        self.assertEqual(result.data["currency"], "GHS")

    def test_explicit_gbp_invoice_in_ghs_organisation_and_invalid_patch(self):
        from apps.fx.models import Currency, ExchangeRate
        from datetime import date
        org = self.orgs["GHS"][0]
        for code in ("GBP", "GHS"):
            Currency.objects.get_or_create(code=code, defaults={"name": code})
        ExchangeRate.objects.create(organisation=org, base_currency_id="GBP", target_currency_id="GHS", effective_date=date(2026, 1, 1), rate="15")
        result = self.document("GHS", currency="GBP")
        self.assertEqual(result.status_code, 201, result.data)
        self.assertEqual(result.data["currency"], "GBP")
        for invalid in ("£", "GH₵", "GHC", "XYZ"):
            patch = self.client.patch(f"/api/v1/invoices/{result.data['id']}/", {"currency": invalid}, format="json", HTTP_X_ORGANISATION_ID=str(org.id))
            self.assertEqual(patch.status_code, 400, patch.data)

        changed = self.client.patch(f"/api/v1/invoices/{result.data['id']}/", {"currency": "GHS"}, format="json", HTTP_X_ORGANISATION_ID=str(org.id))
        self.assertEqual(changed.status_code, 200, changed.data)
        from apps.sales.models import Invoice
        invoice = Invoice.objects.get(pk=result.data["id"])
        self.assertEqual(invoice.exchange_rate, 1)
        self.assertEqual(invoice.base_currency_amount, 1000)

    def test_currency_cannot_come_from_another_organisation_contact(self):
        result = self.document("GHS", customer_id=str(self.orgs["GBP"][1].id))
        self.assertEqual(result.status_code, 400, result.data)

    def test_shared_field_restricts_unsupported_precision(self):
        from common.currency_serializers import CurrencyCodeField
        from rest_framework.exceptions import ValidationError as ApiValidationError
        field = CurrencyCodeField()
        self.assertEqual(field.run_validation("ghs"), "GHS")
        for invalid in ("£", "$", "GH¢", "GH₵", "GHC", "XYZ", "BHD", "JPY"):
            with self.assertRaises(ApiValidationError):
                field.run_validation(invalid)

    def test_legacy_cleanup_preserves_unknown_and_valid_codes(self):
        from importlib import import_module
        from django.apps import apps
        from django.db import connection
        from types import SimpleNamespace
        from apps.contacts.models import Contact
        migration = import_module("apps.organisations.migrations.0006_normalise_legacy_currencies")
        contact = self.orgs["GHS"][1]
        for legacy in ("GH¢", "GH₵", "GHC"):
            Contact.objects.filter(pk=contact.pk).update(currency=legacy)
            migration.normalise_legacy(apps, SimpleNamespace(connection=connection))
            contact.refresh_from_db()
            self.assertEqual(contact.currency, "GHS")
        Contact.objects.filter(pk=contact.pk).update(currency="XYZ")
        migration.normalise_legacy(apps, SimpleNamespace(connection=connection))
        contact.refresh_from_db()
        self.assertEqual(contact.currency, "XYZ")
        self.assertEqual(Contact.objects.get(pk=self.orgs["GBP"][1].pk).currency, "GBP")

    def test_organisation_creation_requires_explicit_base_currency(self):
        with self.assertRaises(ValidationError):
            Organisation.objects.create(name="No currency", created_by=self.user)

    def test_invalid_organisation_default_is_not_saved_to_contacts(self):
        from common.currency_serializers import CurrencyCodeField, OrganisationCurrencyDefault
        from rest_framework import serializers
        from types import SimpleNamespace
        class Payload(serializers.Serializer):
            currency = CurrencyCodeField(default=OrganisationCurrencyDefault())
        for value in ("GH₵", "XYZ", ""):
            payload = Payload(data={}, context={"organisation": SimpleNamespace(base_currency=value)})
            self.assertFalse(payload.is_valid())
            self.assertIn("currency", payload.errors)
