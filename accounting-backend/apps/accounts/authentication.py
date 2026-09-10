"""Reject tokens from sessions revoked by logout, in addition to password changes."""
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication


class SessionVersionJWTAuthentication(JWTAuthentication):
    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if validated_token.get('auth_version') != user.auth_version:
            raise AuthenticationFailed('This session is no longer valid.')
        return user
