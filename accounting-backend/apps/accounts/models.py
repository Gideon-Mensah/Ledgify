from django.db import models

# Create your models here.
import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    email = models.EmailField(
        unique=True,
    )

    first_name = models.CharField(
        max_length=150,
    )

    last_name = models.CharField(
        max_length=150,
    )

    auth_version = models.PositiveBigIntegerField(default=0)

    is_email_verified = models.BooleanField(
        default=False,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["username", "first_name", "last_name"]

    class Meta:
        constraints = [models.UniqueConstraint(models.functions.Lower(models.functions.Trim("email")), name="accounts_user_email_ci_unique")]

    def save(self, *args, **kwargs):
        self.email = self.email.strip().lower()
        previous = type(self).objects.filter(pk=self.pk).values("email", "auth_version").first()
        if previous and previous["email"] != self.email:
            self.is_email_verified = False
            self.auth_version = previous["auth_version"] + 1
            if kwargs.get("update_fields"):
                kwargs["update_fields"] = set(kwargs["update_fields"]) | {"email", "is_email_verified", "auth_version"}
        return super().save(*args, **kwargs)

    def __str__(self):
        return self.email


class EmailVerification(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="email_verifications")
    email = models.EmailField()
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)
    consumed_at = models.DateTimeField(null=True)
    revoked_at = models.DateTimeField(null=True)


class PolicyAcceptance(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name="policy_acceptances")
    terms_version = models.CharField(max_length=100)
    privacy_version = models.CharField(max_length=100)
    terms_url = models.URLField()
    privacy_url = models.URLField()
    accepted_at = models.DateTimeField(auto_now_add=True)
    ip_address = models.GenericIPAddressField(null=True)
    marketing_consent = models.BooleanField(default=False)


class IdentityEmailAttempt(models.Model):
    """Durable intent, never a rendered message or plaintext token. Claimed once."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, null=True)
    invitation = models.ForeignKey("organisations.OrganisationInvitation", on_delete=models.CASCADE, null=True)
    purpose = models.CharField(max_length=20, choices=[("verification", "Verification"), ("invitation", "Invitation")])
    deduplication_key = models.CharField(max_length=64, unique=True)
    status = models.CharField(max_length=16, default="pending", choices=[(s,s) for s in ("pending","sending","sent","failed","cancelled")])
    failure_category = models.CharField(max_length=40, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True)
