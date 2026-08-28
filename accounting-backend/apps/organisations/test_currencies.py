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
