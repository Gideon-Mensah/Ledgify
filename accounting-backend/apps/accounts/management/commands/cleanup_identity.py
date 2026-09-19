from datetime import timedelta
from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone
from apps.accounts.models import EmailVerification, IdentityEmailAttempt
from apps.organisations.models import OrganisationInvitation, OnboardingDraft


class Command(BaseCommand):
    help = 'Expire invitations and remove old identity secrets, delivery attempts and abandoned setup drafts.'
    def handle(self, *args, **options):
        now = timezone.now()
        cutoff = now - timedelta(days=settings.IDENTITY_RETENTION_DAYS)
        OrganisationInvitation.objects.filter(status='pending', expires_at__lte=now).update(status='expired', token_hash=None)
        EmailVerification.objects.filter(expires_at__lt=cutoff).delete()
        IdentityEmailAttempt.objects.filter(created_at__lt=cutoff).exclude(status='pending').delete()
        OrganisationInvitation.objects.filter(status__in=['expired','revoked'], expires_at__lt=cutoff).delete()
        OrganisationInvitation.objects.filter(status='accepted', expires_at__lt=cutoff).update(token_hash=None, message='')
        OnboardingDraft.objects.filter(organisation__isnull=True, updated_at__lt=now-timedelta(days=settings.ONBOARDING_DRAFT_RETENTION_DAYS)).delete()
        self.stdout.write('Identity retention cleanup completed; durable access audit events retained.')
