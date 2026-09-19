"""Public identity flows. Tokens exist only in memory and outgoing email messages."""
import hashlib
import secrets
from email.utils import parseaddr
from datetime import timedelta
from urllib.parse import urlsplit

from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.core.mail import EmailMultiAlternatives
from django.core.validators import validate_email
from django.db import transaction
from django.utils import timezone
from django.utils.html import escape
from django.utils.crypto import salted_hmac
from rest_framework.exceptions import APIException, ValidationError

from common.rate_limits import client_ip, ThrottleUnavailable
from .models import User, EmailVerification, IdentityEmailAttempt

PUBLIC_REGISTRATION = "If this address is eligible, we will send instructions to verify it. Check your email or request another verification message."
PUBLIC_RESEND = "If verification is needed for this address, we will send instructions."
INVALID_LINK = "This link is invalid or has expired. Request a new link."


class IdentityUnavailable(APIException):
    status_code = 503
    default_detail = "Account services are temporarily unavailable. Please try again later."


def normalise_email(value):
    return str(value or '').strip().lower()


def token_digest(raw):
    if not isinstance(raw, str) or not 32 <= len(raw) <= 200:
        raise ValidationError(INVALID_LINK)
    return hashlib.sha256(raw.encode()).hexdigest()


def frontend_origin():
    value = settings.FRONTEND_URL.rstrip('/')
    parsed = urlsplit(value)
    local = settings.DEBUG and parsed.hostname in {'127.0.0.1', 'localhost'} and parsed.scheme == 'http'
    if (not (local or parsed.scheme == 'https') or not parsed.netloc or parsed.path not in {'', '/'}
            or parsed.query or parsed.fragment or parsed.username or parsed.password):
        raise IdentityUnavailable()
    return value


def require_email_configuration():
    frontend_origin()
    backend = settings.EMAIL_BACKEND
    blocked = {'django.core.mail.backends.console.EmailBackend', 'django.core.mail.backends.filebased.EmailBackend', 'django.core.mail.backends.dummy.EmailBackend'}
    if backend in blocked or (not settings.DEBUG and (backend != 'django.core.mail.backends.smtp.EmailBackend' or not settings.EMAIL_HOST)):
        raise IdentityUnavailable()
    try:
        sender = settings.DEFAULT_FROM_EMAIL
        if '\r' in sender or '\n' in sender:
            raise ValueError()
        _, address = parseaddr(sender)
        validate_email(address)
        if not settings.DEBUG and ('localhost' in address or address.endswith('.invalid')):
            raise ValueError()
    except Exception:
        raise IdentityUnavailable() from None


def require_registration_configuration():
    if not settings.REGISTRATION_ENABLED:
        raise IdentityUnavailable()
    require_email_configuration()
    require_policy_configuration()


def require_policy_configuration():
    for version, url in [(settings.TERMS_VERSION, settings.TERMS_URL), (settings.PRIVACY_VERSION, settings.PRIVACY_URL)]:
        parsed = urlsplit(url)
        if not version or not parsed.netloc or (not settings.DEBUG and (parsed.scheme != 'https' or version == 'development-draft')):
            raise IdentityUnavailable()


def challenge(request):
    return signing.dumps({'nonce': secrets.token_urlsafe(24), 'ip': salted_hmac('registration-ip', client_ip(request)).hexdigest()}, salt='registration-challenge')


def check_challenge(request, raw):
    try:
        value = signing.loads(raw, salt='registration-challenge', max_age=1800)
        if value['ip'] != salted_hmac('registration-ip', client_ip(request)).hexdigest():
            raise ValueError()
        key = 'registration-challenge:' + hashlib.sha256(value['nonce'].encode()).hexdigest()
        if not cache.add(key, True, timeout=1800):
            raise ValueError()
    except (signing.BadSignature, ValueError, TypeError, KeyError):
        raise ValidationError('Refresh the registration page and try again.') from None
    except Exception:
        raise ThrottleUnavailable() from None


def audit(event, user=None, organisation=None, subject=None, **details):
    from apps.organisations.models import AccessAuditEvent
    return AccessAuditEvent.objects.create(event=event, actor=user, organisation=organisation,
        subject_id=getattr(subject, 'pk', None), details=details)


def queue_verification(user):
    """Caller locks the user. A cooldown and durable intent suppress rapid repeats."""
    if IdentityEmailAttempt.objects.filter(user=user, purpose='verification', status='pending').exists():
        return
    recent = timezone.now() - timedelta(seconds=settings.IDENTITY_EMAIL_COOLDOWN_SECONDS)
    if IdentityEmailAttempt.objects.filter(user=user, purpose='verification', created_at__gte=recent).exists():
        return
    IdentityEmailAttempt.objects.create(user=user, purpose='verification', deduplication_key=secrets.token_hex(32))


@transaction.atomic
def verify_email(raw):
    hashed = token_digest(raw)
    candidate = EmailVerification.objects.filter(token_hash=hashed).values('user_id').first()
    if not candidate:
        raise ValidationError(INVALID_LINK)
    user = User.objects.select_for_update().get(pk=candidate['user_id'])
    token = EmailVerification.objects.select_for_update().filter(token_hash=hashed).first()
    if not token:
        raise ValidationError(INVALID_LINK)
    now = timezone.now()
    if token.consumed_at or token.revoked_at or token.expires_at <= now or token.email != user.email or not user.is_active:
        raise ValidationError(INVALID_LINK)
    token.consumed_at = now
    token.save(update_fields=['consumed_at'])
    EmailVerification.objects.filter(user=user, consumed_at__isnull=True, revoked_at__isnull=True).update(revoked_at=now)
    user.is_email_verified = True
    user.auth_version += 1
    user.save(update_fields=['is_email_verified', 'auth_version', 'updated_at'])
    audit('EMAIL_VERIFIED', user, subject=user)


def deliver_identity_emails(limit=100):
    """Run via management command in a worker. Never retry ambiguous sending attempts."""
    require_email_configuration()
    sent = 0
    for _ in range(limit):
        with transaction.atomic():
            candidate = IdentityEmailAttempt.objects.filter(status='pending').order_by('created_at').first()
            if not candidate:
                break
            # Match request-side lock ordering: owner first, delivery intent second.
            # Revocation/email changes must never deadlock against a worker holding
            # an intent lock while waiting for that same organisation/user.
            if candidate.purpose == 'verification':
                User.objects.select_for_update().get(pk=candidate.user_id)
            else:
                from apps.organisations.models import OrganisationInvitation, Organisation
                organisation_id = OrganisationInvitation.objects.values_list('organisation_id', flat=True).get(pk=candidate.invitation_id)
                Organisation.objects.select_for_update().get(pk=organisation_id)
            attempt = IdentityEmailAttempt.objects.select_for_update(skip_locked=True).filter(pk=candidate.pk, status='pending').first()
            if not attempt:
                continue
            raw = secrets.token_urlsafe(48)
            now = timezone.now()
            if attempt.purpose == 'verification':
                user = User.objects.select_for_update().get(pk=attempt.user_id)
                if user.is_email_verified or not user.is_active:
                    attempt.status = 'cancelled'
                    attempt.completed_at = now
                    attempt.save(update_fields=['status', 'completed_at'])
                    continue
                EmailVerification.objects.filter(user=user, consumed_at__isnull=True, revoked_at__isnull=True).update(revoked_at=now)
                EmailVerification.objects.create(user=user, email=user.email, token_hash=token_digest(raw), expires_at=now + timedelta(seconds=settings.VERIFICATION_EXPIRY_SECONDS))
                recipient, path, title = user.email, '/verify-email', 'Verify your Ledgify email address'
                text = 'Confirm this email address to continue to Ledgify. If you did not request this, ignore this message.'
            else:
                from apps.organisations.models import OrganisationInvitation, Organisation
                # Inviter must still have authority when a queued message is delivered.
                invitation = OrganisationInvitation.objects.select_related('organisation').get(pk=attempt.invitation_id)
                Organisation.objects.select_for_update().get(pk=invitation.organisation_id)
                invitation = OrganisationInvitation.objects.select_for_update().get(pk=invitation.pk)
                from apps.organisations.invitation_services import allowed_roles
                if invitation.status != 'pending' or invitation.expires_at <= now or invitation.role not in allowed_roles(invitation.organisation, invitation.invited_by):
                    attempt.status = 'cancelled'
                    attempt.completed_at = now
                    attempt.save(update_fields=['status', 'completed_at'])
                    continue
                invitation.token_hash = token_digest(raw)
                invitation.save(update_fields=['token_hash'])
                recipient, path, title = invitation.email, '/accept-invitation', 'Invitation to Ledgify'
                text = f'You have been invited to {invitation.organisation.name} as {invitation.get_role_display()}. Sign in with your verified invited email to review and accept.\n\n{invitation.message}'
            attempt.status = 'sending'
            attempt.save(update_fields=['status'])
        # Committed before SMTP. Raw tokens are never in a database/outbox/log/URL path.
        url = frontend_origin() + path + '#token=' + raw
        message = EmailMultiAlternatives(title, text + '\n\n' + url, settings.DEFAULT_FROM_EMAIL, [recipient])
        message.attach_alternative('<p>' + escape(text).replace('\n', '<br>') + '</p><p><a href="' + escape(url) + '">Continue to Ledgify</a></p>', 'text/html')
        try:
            accepted = message.send(fail_silently=False) == 1
            attempt.status = 'sent' if accepted else 'failed'
            attempt.failure_category = '' if accepted else 'not_accepted'
            sent += int(accepted)
        except Exception:
            attempt.status = 'failed'
            attempt.failure_category = 'delivery_unknown'
        attempt.completed_at = timezone.now()
        attempt.save(update_fields=['status', 'failure_category', 'completed_at'])
    return sent
