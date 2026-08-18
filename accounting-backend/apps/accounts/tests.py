from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.organisations.models import Organisation, OrganisationMember


class AuthenticationIntegrationTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="demo", email="demo@example.com", password="demo-password",
            first_name="Demo", last_name="User",
        )
        self.organisation = Organisation.objects.create(
            name="Demo Organisation", created_by=self.user,
        )
        OrganisationMember.objects.create(
            organisation=self.organisation, user=self.user,
            role=OrganisationMember.Role.OWNER,
        )
        self.client = APIClient()

    def test_token_profile_organisation_and_permissions_flow(self):
        token = self.client.post(reverse("token_obtain_pair"), {
            "email": "demo@example.com", "password": "demo-password",
        }, format="json")
        self.assertEqual(token.status_code, 200)
        self.assertIn("access", token.data)
        self.assertIn("refresh", token.data)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.data['access']}")

        profile = self.client.get(reverse("current-user"))
        organisations = self.client.get(reverse("organisation-list"))
        permissions = self.client.get(
            reverse("organisation-my-permissions", kwargs={"pk": self.organisation.id})
        )
        self.assertEqual(profile.status_code, 200)
        self.assertEqual(profile.data["email"], self.user.email)
        self.assertEqual(organisations.status_code, 200)
        self.assertEqual(organisations.data[0]["id"], str(self.organisation.id))
        self.assertEqual(permissions.status_code, 200)
        self.assertEqual(permissions.data["role"], OrganisationMember.Role.OWNER)
