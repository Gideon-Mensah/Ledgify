from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.core.cache import cache
from django.test import TestCase
from django.test import override_settings
from django.urls import reverse
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
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


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    FRONTEND_URL="https://ledgify-staging.vercel.app",
    PASSWORD_RESET_TIMEOUT=3600,
    REST_FRAMEWORK={
        "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
        "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework_simplejwt.authentication.JWTAuthentication"],
        "DEFAULT_THROTTLE_RATES": {"password_reset": "5/hour"},
    },
)
class PasswordResetTests(TestCase):
    public_message = "If an account exists for this email address, a password reset link has been sent."

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(
            username="reset-user", email="Reset.User@example.com", password="OldPassword123!",
            first_name="Reset", last_name="User", is_active=True,
        )

    def request_reset(self, email="reset.user@EXAMPLE.com"):
        return self.client.post(reverse("password-reset-request"), {"email": email}, format="json")

    def reset_parts(self):
        uid = urlsafe_base64_encode(force_bytes(self.user.pk))
        return uid, default_token_generator.make_token(self.user)

    def confirm(self, uid, token, password="NewPassword837!", confirmation=None):
        return self.client.post(reverse("password-reset-confirm"), {
            "uid": uid, "token": token, "new_password": password,
            "confirm_password": password if confirmation is None else confirmation,
        }, format="json")

    def test_active_email_sends_professional_email_with_configured_frontend_link(self):
        response = self.request_reset()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"detail": self.public_message})
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("https://ledgify-staging.vercel.app/reset-password/", mail.outbox[0].body)
        self.assertIn("expires in 60 minutes", mail.outbox[0].body)
        self.assertEqual(len(mail.outbox[0].alternatives), 1)

    def test_unknown_and_inactive_email_have_same_response_and_send_nothing(self):
        unknown = self.request_reset("missing@example.com")
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])
        inactive = self.request_reset()
        self.assertEqual(unknown.data, inactive.data)
        self.assertEqual(unknown.data["detail"], self.public_message)
        self.assertEqual(len(mail.outbox), 0)

    def test_endpoints_need_neither_authentication_nor_organisation_header(self):
        request = self.request_reset()
        uid, token = self.reset_parts()
        confirm = self.confirm(uid, token)
        self.assertEqual(request.status_code, 200)
        self.assertEqual(confirm.status_code, 200)

    def test_valid_token_changes_password_and_cannot_be_reused(self):
        existing_tokens = self.client.post(reverse("token_obtain_pair"), {
            "email": self.user.email, "password": "OldPassword123!",
        }, format="json").data
        uid, token = self.reset_parts()
        response = self.confirm(uid, token)
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertFalse(self.user.check_password("OldPassword123!"))
        self.assertTrue(self.user.check_password("NewPassword837!"))
        self.assertEqual(self.confirm(uid, token).status_code, 400)
        old_login = self.client.post(reverse("token_obtain_pair"), {"email": self.user.email, "password": "OldPassword123!"})
        new_login = self.client.post(reverse("token_obtain_pair"), {"email": self.user.email, "password": "NewPassword837!"})
        self.assertEqual(old_login.status_code, 401)
        self.assertEqual(new_login.status_code, 200)
        revoked_refresh = self.client.post(reverse("token_refresh"), {
            "refresh": existing_tokens["refresh"],
        }, format="json")
        self.assertEqual(revoked_refresh.status_code, 401)

    def test_mismatch_and_weak_password_return_field_errors(self):
        uid, token = self.reset_parts()
        mismatch = self.confirm(uid, token, confirmation="DifferentPassword837!")
        weak = self.confirm(uid, token, password="password")
        self.assertEqual(mismatch.status_code, 400)
        self.assertIn("confirm_password", mismatch.data)
        self.assertEqual(weak.status_code, 400)
        self.assertIn("new_password", weak.data)

    def test_invalid_uid_token_and_expired_token_are_rejected(self):
        uid, token = self.reset_parts()
        self.assertEqual(self.confirm("not-a-uid", token).status_code, 400)
        self.assertEqual(self.confirm(uid, f"{token}altered").status_code, 400)
        future = default_token_generator._now().replace(year=default_token_generator._now().year + 1)
        with patch.object(default_token_generator, "_now", return_value=future):
            self.assertEqual(self.confirm(uid, token).status_code, 400)

    def test_request_validation_limits_input_without_exposing_secrets(self):
        response = self.request_reset("not-an-email")
        self.assertEqual(response.status_code, 400)
        rendered = str(response.data)
        self.assertNotIn("OldPassword123!", rendered)
        self.assertNotIn("token", rendered.lower())

    def test_request_rate_limiting(self):
        cache.clear()
        for number in range(5):
            self.assertEqual(self.request_reset(f"missing{number}@example.com").status_code, 200)
        self.assertEqual(self.request_reset("limited@example.com").status_code, 429)
