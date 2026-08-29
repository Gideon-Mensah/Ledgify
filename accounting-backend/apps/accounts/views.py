import logging
from urllib.parse import urlsplit

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.template.loader import render_to_string
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenRefreshView

from .serializers import PasswordAwareTokenRefreshSerializer, PasswordResetConfirmSerializer, PasswordResetRequestSerializer


logger = logging.getLogger(__name__)
PUBLIC_RESET_RESPONSE = "If an account exists for this email address, a password reset link has been sent."


class PasswordAwareTokenRefreshView(TokenRefreshView):
    serializer_class = PasswordAwareTokenRefreshSerializer


def _frontend_reset_url(uid, token):
    frontend_url = settings.FRONTEND_URL.rstrip("/")
    parsed = urlsplit(frontend_url)
    local_host = parsed.hostname in {"localhost", "127.0.0.1"}
    allowed_scheme = parsed.scheme == "https" or (settings.DEBUG and local_host and parsed.scheme == "http")
    if not allowed_scheme or not parsed.netloc or parsed.query or parsed.fragment:
        raise ValueError("FRONTEND_URL must be an HTTPS origin (HTTP localhost is allowed in development).")
    return f"{frontend_url}/reset-password/{uid}/{token}"


class PasswordResetRequestView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = get_user_model().objects.filter(
            email__iexact=serializer.validated_data["email"], is_active=True,
        ).first()
        if user:
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            try:
                reset_url = _frontend_reset_url(uid, token)
                context = {
                    "reset_url": reset_url,
                    "expiry_minutes": max(1, settings.PASSWORD_RESET_TIMEOUT // 60),
                }
                message = EmailMultiAlternatives(
                    subject="Reset your Ledgify password",
                    body=render_to_string("accounts/password_reset_email.txt", context),
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    to=[user.email],
                )
                message.attach_alternative(
                    render_to_string("accounts/password_reset_email.html", context), "text/html",
                )
                message.send(fail_silently=False)
            except Exception:
                # Never include an address, UID, token, or rendered email in logs.
                logger.exception("Password reset email delivery failed")
        return Response({"detail": PUBLIC_RESET_RESPONSE})


class PasswordResetConfirmView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            user = get_user_model().objects.select_for_update().get(pk=serializer.validated_data["uid"].pk)
            if not default_token_generator.check_token(user, serializer.validated_data["token"]):
                return Response(
                    {"token": ["This password reset link is invalid or has expired."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            user.set_password(serializer.validated_data["new_password"])
            user.save(update_fields=["password", "updated_at"])
        return Response({"detail": "Your password has been reset successfully."})


class CurrentUserView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        return Response({
            "id": str(user.id),
            "email": user.email,
            "username": user.username,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "is_email_verified": user.is_email_verified,
        })
