"""Organisation-locked invitation and membership changes; no public account lookup."""
import secrets
from datetime import timedelta
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from apps.accounts.models import User, IdentityEmailAttempt
from apps.accounts.identity import audit, token_digest, INVALID_LINK, normalise_email, require_email_configuration
from apps.accounts.identity_throttles import consume_limits
from rest_framework.exceptions import Throttled
from .models import Organisation, OrganisationMember, OrganisationInvitation
from .permissions import MANAGE_ORGANISATION_USERS
from .services import has_organisation_permission


def allowed_roles(organisation, user):
    if not user.is_active or not user.is_email_verified:
        return []
    membership = OrganisationMember.objects.filter(organisation=organisation, user=user, is_active=True, organisation__is_active=True).first()
    if not membership or not has_organisation_permission(organisation=organisation, user=user, permission=MANAGE_ORGANISATION_USERS):
        return []
    if membership.role == 'owner':
        return list(OrganisationMember.Role.values)
    if membership.role == 'admin':
        return [r for r in OrganisationMember.Role.values if r not in {'owner', 'admin'}]
    return []


def invitation_limits(organisation, user):
    wait = consume_limits('invitations', [('user', user.pk, settings.INVITATION_USER_RATE), ('organisation', organisation.pk, settings.INVITATION_ORGANISATION_RATE)])
    if wait:
        raise Throttled(wait=wait)


def queue_invitation(invitation):
    if IdentityEmailAttempt.objects.filter(invitation=invitation, status='pending').exists():
        return
    cutoff = timezone.now() - timedelta(seconds=settings.IDENTITY_EMAIL_COOLDOWN_SECONDS)
    if IdentityEmailAttempt.objects.filter(invitation=invitation, created_at__gte=cutoff).exists():
        return
    # Revoke the previous link immediately; only the worker can issue its successor.
    invitation.token_hash = None
    invitation.save(update_fields=['token_hash'])
    IdentityEmailAttempt.objects.create(invitation=invitation, purpose='invitation', deduplication_key=secrets.token_hex(32))


@transaction.atomic
def create_invitation(organisation, user, email, role, message=''):
    Organisation.objects.select_for_update().get(pk=organisation.pk)
    if role not in allowed_roles(organisation, user):
        raise PermissionDenied('You cannot assign this role.')
    require_email_configuration()
    invitation_limits(organisation, user)
    email = normalise_email(email)
    now = timezone.now()
    OrganisationInvitation.objects.filter(organisation=organisation, email=email, status='pending', expires_at__lte=now).update(status='expired', token_hash=None)
    existing = OrganisationInvitation.objects.filter(organisation=organisation, email=email, status='pending').first()
    if existing:
        # An existing pending invitation must be revoked to change its intended role.
        if existing.role != role:
            raise ValidationError('Revoke the pending invitation before changing its role.')
        return existing
    invitation = OrganisationInvitation.objects.create(organisation=organisation, invited_by=user, email=email, role=role,
        message=message, expires_at=now + timedelta(seconds=settings.INVITATION_EXPIRY_SECONDS))
    queue_invitation(invitation)
    audit('INVITATION_CREATED', user, organisation, invitation, role=role)
    return invitation


@transaction.atomic
def change_invitation(organisation, user, invitation_id, action):
    Organisation.objects.select_for_update().get(pk=organisation.pk)
    invitation = OrganisationInvitation.objects.select_for_update().filter(organisation=organisation, pk=invitation_id).first()
    if not invitation or invitation.role not in allowed_roles(organisation, user):
        raise PermissionDenied('This invitation is unavailable.')
    if invitation.status != 'pending':
        raise ValidationError('This invitation is no longer pending.')
    if action == 'revoke':
        invitation.status, invitation.revoked_by, invitation.revoked_at, invitation.token_hash = 'revoked', user, timezone.now(), None
        invitation.save(update_fields=['status', 'revoked_by', 'revoked_at', 'token_hash'])
        IdentityEmailAttempt.objects.filter(invitation=invitation, status='pending').update(status='cancelled', completed_at=timezone.now())
    elif action == 'resend':
        require_email_configuration()
        invitation_limits(organisation, user)
        if invitation.expires_at <= timezone.now():
            raise ValidationError('Create a new invitation after expiry.')
        queue_invitation(invitation)
    else:
        raise ValidationError('Choose resend or revoke.')
    audit('INVITATION_' + action.upper(), user, organisation, invitation)
    return invitation


@transaction.atomic
def invitation_for_user(user, raw, accept=False):
    hashed = token_digest(raw)
    candidate = OrganisationInvitation.objects.filter(token_hash=hashed).values('organisation_id').first()
    if not candidate:
        raise ValidationError(INVALID_LINK)
    organisation = Organisation.objects.select_for_update().get(pk=candidate['organisation_id'])
    invitation = OrganisationInvitation.objects.select_for_update().filter(token_hash=hashed).first()
    if not invitation:
        raise ValidationError(INVALID_LINK)
    user = User.objects.select_for_update().get(pk=user.pk)
    if (not organisation.is_active or not user.is_active or not user.is_email_verified or user.email != invitation.email
            or invitation.status != 'pending' or invitation.expires_at <= timezone.now()
            or invitation.role not in allowed_roles(organisation, invitation.invited_by)):
        raise ValidationError(INVALID_LINK)
    if accept:
        membership = OrganisationMember.objects.filter(organisation=organisation, user=user).first()
        if membership and not membership.is_active:
            raise ValidationError('An administrator must review your existing membership.')
        if not membership:
            OrganisationMember.objects.create(organisation=organisation, user=user, role=invitation.role)
        # Never overwrite an existing role, including an owner, by accepting an invitation.
        invitation.status, invitation.accepted_by, invitation.accepted_at = 'accepted', user, timezone.now()
        invitation.save(update_fields=['status', 'accepted_by', 'accepted_at'])
        audit('INVITATION_ACCEPTED', user, organisation, invitation, role=membership.role if membership else invitation.role)
    return invitation
