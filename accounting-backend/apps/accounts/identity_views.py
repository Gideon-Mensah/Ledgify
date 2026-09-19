import ipaddress
import uuid
from django.conf import settings
from django.contrib.auth import password_validation
from django.contrib.auth.hashers import make_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.debug import sensitive_post_parameters
from rest_framework import serializers
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from common.rate_limits import client_ip
from .identity import (PUBLIC_REGISTRATION, PUBLIC_RESEND, normalise_email, require_registration_configuration,
    require_email_configuration, check_challenge, challenge, queue_verification, verify_email, audit)
from .identity_throttles import PublicIdentityThrottle
from .models import User, PolicyAcceptance, EmailVerification, IdentityEmailAttempt


class RegistrationSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)
    confirm_password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)
    terms_accepted = serializers.BooleanField()
    terms_version = serializers.CharField(max_length=100)
    privacy_version = serializers.CharField(max_length=100)
    marketing_consent = serializers.BooleanField(default=False)
    challenge = serializers.CharField(max_length=1000)
    website = serializers.CharField(required=False, allow_blank=True, max_length=255)

    def validate(self, data):
        data['email'] = normalise_email(data['email'])
        if not data['terms_accepted'] or data['terms_version'] != settings.TERMS_VERSION or data['privacy_version'] != settings.PRIVACY_VERSION:
            raise serializers.ValidationError({'terms_accepted': 'Review and accept the current Terms and Privacy Policy.'})
        if data['password'] != data['confirm_password']:
            raise serializers.ValidationError({'confirm_password': 'The passwords do not match.'})
        try:
            password_validation.validate_password(data['password'], User(email=data['email'], first_name=data['first_name'], last_name=data['last_name']))
        except DjangoValidationError as error:
            raise serializers.ValidationError({'password': list(error.messages)}) from None
        return data


@method_decorator(sensitive_post_parameters(), name='dispatch')
class PublicIdentityView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PublicIdentityThrottle]


class RegistrationOptionsView(PublicIdentityView):
    def get(self, request):
        require_registration_configuration()
        return Response({'challenge': challenge(request), 'terms_version': settings.TERMS_VERSION, 'privacy_version': settings.PRIVACY_VERSION,
            'terms_url': settings.TERMS_URL, 'privacy_url': settings.PRIVACY_URL,
            'password_requirements': password_validation.password_validators_help_texts()})


class RegistrationView(PublicIdentityView):
    registration = True
    def post(self, request):
        require_registration_configuration()
        serializer = RegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        check_challenge(request, data['challenge'])
        # Equal password-hashing work for duplicate and new valid registrations.
        encoded = make_password(data['password'])
        if data.get('website'):
            return Response({'detail': PUBLIC_REGISTRATION}, status=202)
        try:
            with transaction.atomic():
                user = User.objects.create(username=str(uuid.uuid4()), email=data['email'], password=encoded,
                    first_name=data['first_name'], last_name=data['last_name'], is_email_verified=False)
                address = None
                if settings.POLICY_RECORD_IP:
                    try: address = str(ipaddress.ip_address(client_ip(request)))
                    except ValueError: pass
                PolicyAcceptance.objects.create(user=user, terms_version=settings.TERMS_VERSION, privacy_version=settings.PRIVACY_VERSION,
                    terms_url=settings.TERMS_URL, privacy_url=settings.PRIVACY_URL, ip_address=address, marketing_consent=data['marketing_consent'])
                queue_verification(user)
                audit('REGISTRATION_REQUESTED', user, subject=user)
        except IntegrityError:
            # The DB lower(email) constraint also handles simultaneous case variants.
            pass
        return Response({'detail': PUBLIC_REGISTRATION}, status=202)


class ResendVerificationView(PublicIdentityView):
    def post(self, request):
        require_email_configuration()
        email = serializers.EmailField().run_validation(request.data.get('email'))
        with transaction.atomic():
            user = User.objects.select_for_update().filter(email__iexact=normalise_email(email), is_active=True, is_email_verified=False).first()
            if user:
                queue_verification(user)
        return Response({'detail': PUBLIC_RESEND}, status=202)


class VerifyEmailView(PublicIdentityView):
    def post(self, request):
        verify_email(request.data.get('token'))
        return Response({'detail': 'Email verified. You can now sign in.'})


@method_decorator(sensitive_post_parameters(), name='dispatch')
class ChangeEmailView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [PublicIdentityThrottle]
    def post(self, request):
        require_email_configuration()
        email = normalise_email(serializers.EmailField().run_validation(request.data.get('email')))
        try:
            with transaction.atomic():
                user = User.objects.select_for_update().get(pk=request.user.pk)
                if not user.is_active or not user.is_email_verified or not user.check_password(str(request.data.get('password', ''))):
                    raise serializers.ValidationError('Unable to change email. Check the details and try again.')
                if email != user.email:
                    user.email = email
                    user.save(update_fields=['email', 'updated_at'])
                    EmailVerification.objects.filter(user=user, consumed_at__isnull=True).update(revoked_at=timezone.now())
                    IdentityEmailAttempt.objects.filter(user=user, status='pending').update(status='cancelled', completed_at=timezone.now())
                    # Explicitly changed address starts a fresh delivery intent, independent of old-address cooldown.
                    IdentityEmailAttempt.objects.create(user=user, purpose='verification', deduplication_key=uuid.uuid4().hex)
                    audit('EMAIL_CHANGE_REQUESTED', user, subject=user)
        except IntegrityError:
            pass
        return Response({'detail': 'If eligible, verification instructions will be sent. Sign in again after verification.'}, status=202)
