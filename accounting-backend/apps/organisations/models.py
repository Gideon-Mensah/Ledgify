import uuid

from django.conf import settings
from django.db import models


class Organisation(models.Model):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    name = models.CharField(
        max_length=255,
    )

    legal_name = models.CharField(
        max_length=255,
        blank=True,
    )

    registration_number = models.CharField(
        max_length=100,
        blank=True,
    )

    tax_number = models.CharField(
        max_length=100,
        blank=True,
    )
    tax_registered = models.BooleanField(default=False)
    tax_registration_number = models.CharField(max_length=100, blank=True)
    tax_scheme = models.CharField(max_length=50, blank=True)
    tax_reporting_currency = models.CharField(max_length=3, blank=True)
    tax_period_frequency = models.CharField(
        max_length=20,
        choices=(("monthly", "Monthly"), ("quarterly", "Quarterly"), ("annual", "Annual")),
        blank=True,
    )
    tax_effective_date = models.DateField(null=True, blank=True)

    country_code = models.CharField(
        max_length=2,
        default="GB",
    )

    base_currency = models.CharField(
        max_length=3,
        default="GBP",
    )
    reporting_currency = models.CharField(max_length=3, blank=True)
    fx_gain_account = models.ForeignKey("accounting.Account", on_delete=models.PROTECT, null=True, blank=True, related_name="organisations_fx_gain")
    fx_loss_account = models.ForeignKey("accounting.Account", on_delete=models.PROTECT, null=True, blank=True, related_name="organisations_fx_loss")

    timezone = models.CharField(
        max_length=100,
        default="Europe/London",
    )

    financial_year_start_month = models.PositiveSmallIntegerField(
        default=1,
    )

    address_line_1 = models.CharField(
        max_length=255,
        blank=True,
    )

    address_line_2 = models.CharField(
        max_length=255,
        blank=True,
    )

    city = models.CharField(
        max_length=100,
        blank=True,
    )

    region = models.CharField(
        max_length=100,
        blank=True,
    )

    postal_code = models.CharField(
        max_length=30,
        blank=True,
    )

    phone = models.CharField(
        max_length=50,
        blank=True,
    )

    email = models.EmailField(
        blank=True,
    )

    website = models.URLField(
        blank=True,
    )

    require_separate_approver = models.BooleanField(default=False)

    is_active = models.BooleanField(
        default=True,
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="organisations_created",
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        self.base_currency = self.base_currency.upper().strip()
        self.reporting_currency = self.reporting_currency.upper().strip()
        if self.pk:
            previous = Organisation.objects.filter(pk=self.pk).values_list("base_currency", flat=True).first()
            if previous and previous != self.base_currency and self.journal_entries.exists():
                from common.exceptions import BusinessRuleError
                raise BusinessRuleError("Base currency cannot change after accounting transactions exist.")
        return super().save(*args, **kwargs)


class OrganisationMember(models.Model):
    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        ADMIN = "admin", "Administrator"
        ACCOUNTANT = "accountant", "Accountant"
        BOOKKEEPER = "bookkeeper", "Bookkeeper"
        APPROVER = "approver", "Approver"
        EMPLOYEE = "employee", "Employee"
        VIEWER = "viewer", "Read only"

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    organisation = models.ForeignKey(
        Organisation,
        on_delete=models.CASCADE,
        related_name="members",
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="organisation_memberships",
    )

    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.EMPLOYEE,
    )

    is_active = models.BooleanField(
        default=True,
    )

    joined_at = models.DateTimeField(
        auto_now_add=True,
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["organisation", "user"],
                name="unique_organisation_user",
            )
        ]

    def __str__(self):
        return f"{self.user} - {self.organisation} ({self.role})"
