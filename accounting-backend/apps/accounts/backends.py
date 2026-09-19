"""One password check for unknown, inactive, unverified and incorrect sign-ins."""
from django.contrib.auth.backends import ModelBackend
from django.contrib.auth import get_user_model


class VerifiedEmailBackend(ModelBackend):
    def authenticate(self, request, username=None, password=None, **kwargs):
        User = get_user_model()
        email = str(kwargs.get("email", username) or "").strip().lower()
        if password is None:
            return None
        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            User().set_password(password)
            return None
        valid = user.check_password(password)
        return user if valid and self.user_can_authenticate(user) else None

    def user_can_authenticate(self, user):
        return user.is_active and user.is_email_verified
