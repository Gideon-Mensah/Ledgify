from django.contrib.auth import get_user_model, password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from django.db import transaction
from rest_framework_simplejwt.tokens import UntypedToken
from rest_framework_simplejwt.serializers import TokenRefreshSerializer, TokenObtainPairSerializer
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.utils import get_md5_hash_password


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254, trim_whitespace=True)

    def validate_email(self, value):
        return value.strip().lower()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField(max_length=128, trim_whitespace=True)
    token = serializers.CharField(max_length=256, trim_whitespace=True)
    new_password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)
    confirm_password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)

    def validate_uid(self, value):
        try:
            user_id = force_str(urlsafe_base64_decode(value))
            return get_user_model().objects.get(pk=user_id, is_active=True)
        except (ValueError, TypeError, OverflowError, UnicodeDecodeError, get_user_model().DoesNotExist):
            raise serializers.ValidationError("This password reset link is invalid or has expired.")

    def validate(self, attrs):
        if attrs["new_password"] != attrs["confirm_password"]:
            raise serializers.ValidationError({"confirm_password": "The passwords do not match."})
        try:
            password_validation.validate_password(attrs["new_password"], user=attrs["uid"])
        except DjangoValidationError as error:
            raise serializers.ValidationError({"new_password": list(error.messages)})
        return attrs


class SessionTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["auth_version"] = user.auth_version
        return token

    def validate(self, attrs):
        attrs["email"] = attrs.get("email", "").strip()
        return super().validate(attrs)


class PasswordAwareTokenRefreshSerializer(TokenRefreshSerializer):
    @transaction.atomic
    def validate(self, attrs):
        # Lock the same user row as logout before checking/rotating the token.
        refresh = UntypedToken(attrs["refresh"])
        user_id = refresh.payload.get(api_settings.USER_ID_CLAIM)
        try:
            user = get_user_model().objects.select_for_update().get(
                **{api_settings.USER_ID_FIELD: user_id})
        except (get_user_model().DoesNotExist, TypeError, ValueError, DjangoValidationError):
            raise AuthenticationFailed("This session is no longer valid.") from None
        if (not user.is_active or refresh.get("auth_version") != user.auth_version
                or refresh.get(api_settings.REVOKE_TOKEN_CLAIM) != get_md5_hash_password(user.password)):
            raise AuthenticationFailed("This session is no longer valid.")
        return super().validate(attrs)
