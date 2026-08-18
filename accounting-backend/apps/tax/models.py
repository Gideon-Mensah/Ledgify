"""Country-neutral tax configuration and posted tax transaction audit records."""

import uuid
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


class TaxRate(models.Model):
    class TaxType(models.TextChoices):
        VAT = "VAT", "VAT"
        GST = "GST", "GST"
        SALES_TAX = "SALES_TAX", "Sales tax"
        OTHER = "OTHER", "Other"

    class Scope(models.TextChoices):
        SALES = "SALES", "Sales"
        PURCHASES = "PURCHASES", "Purchases"
        BOTH = "BOTH", "Both"

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        INACTIVE = "INACTIVE", "Inactive"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey("organisations.Organisation", on_delete=models.CASCADE, related_name="tax_rates")
    code = models.CharField(max_length=30)
    name = models.CharField(max_length=100)
    rate = models.DecimalField(max_digits=7, decimal_places=4)
    tax_type = models.CharField(max_length=20, choices=TaxType.choices)
    scope = models.CharField(max_length=20, choices=Scope.choices, default=Scope.BOTH)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    input_tax_account = models.ForeignKey("accounting.Account", on_delete=models.PROTECT, related_name="input_tax_rates", null=True, blank=True)
    output_tax_account = models.ForeignKey("accounting.Account", on_delete=models.PROTECT, related_name="output_tax_rates", null=True, blank=True)
    recoverable = models.BooleanField(default=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="tax_rates_created")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code"]
        constraints = [
            models.UniqueConstraint(fields=["organisation", "code"], name="unique_tax_rate_code_per_org"),
            models.CheckConstraint(condition=models.Q(rate__gte=0), name="tax_rate_non_negative"),
        ]

    def clean(self):
        if self.effective_to and self.effective_to < self.effective_from:
            raise ValidationError("Effective end date cannot precede the start date.")
        for account in (self.input_tax_account, self.output_tax_account):
            if account and account.organisation_id != self.organisation_id:
                raise ValidationError("Tax accounts must belong to the same organisation.")

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        self.full_clean()
        return super().save(*args, **kwargs)


class TaxTransaction(models.Model):
    class Direction(models.TextChoices):
        OUTPUT = "OUTPUT", "Output"
        INPUT = "INPUT", "Input"
    class Status(models.TextChoices):
        POSTED = "POSTED", "Posted"
        ADJUSTMENT = "ADJUSTMENT", "Adjustment"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey("organisations.Organisation", on_delete=models.CASCADE, related_name="tax_transactions")
    tax_rate = models.ForeignKey(TaxRate, on_delete=models.PROTECT, related_name="transactions")
    tax_rate_percent = models.DecimalField(max_digits=7, decimal_places=4)
    transaction_date = models.DateField()
    source_type = models.CharField(max_length=30)
    source_id = models.UUIDField()
    document_number = models.CharField(max_length=50)
    contact = models.ForeignKey("contacts.Contact", on_delete=models.PROTECT, related_name="tax_transactions")
    net_amount = models.DecimalField(max_digits=18, decimal_places=2)
    tax_amount = models.DecimalField(max_digits=18, decimal_places=2)
    gross_amount = models.DecimalField(max_digits=18, decimal_places=2)
    direction = models.CharField(max_length=10, choices=Direction.choices)
    tax_account = models.ForeignKey("accounting.Account", on_delete=models.PROTECT, related_name="tax_transactions")
    journal_entry = models.ForeignKey("accounting.JournalEntry", on_delete=models.PROTECT, related_name="tax_transactions")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.POSTED)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-transaction_date", "-created_at"]
        constraints = [models.UniqueConstraint(
            fields=["organisation", "source_type", "source_id", "tax_rate", "direction"],
            name="unique_tax_transaction_source_rate_direction",
        )]

    def save(self, *args, **kwargs):
        if self.pk and TaxTransaction.objects.filter(pk=self.pk).exists():
            raise ValidationError("Posted tax transactions are immutable.")
        return super().save(*args, **kwargs)


class TaxPeriod(models.Model):
    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        PREPARED = "PREPARED", "Prepared"
        FILED = "FILED", "Filed"
        LOCKED = "LOCKED", "Locked"
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey("organisations.Organisation", on_delete=models.CASCADE, related_name="tax_periods")
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    filed_at = models.DateTimeField(null=True, blank=True)
    filed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="tax_periods_filed")
    payment_due_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-start_date"]
        constraints = [
            models.UniqueConstraint(fields=["organisation", "start_date", "end_date"], name="unique_tax_period_per_org"),
            models.CheckConstraint(condition=models.Q(end_date__gte=models.F("start_date")), name="tax_period_dates_valid"),
        ]
