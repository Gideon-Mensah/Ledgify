import uuid

from django.conf import settings
from django.db import models

from apps.organisations.models import Organisation


class Contact(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        INACTIVE = "inactive", "Inactive"
        ARCHIVED = "archived", "Archived"

    class PaymentTerms(models.TextChoices):
        IMMEDIATE = "immediate", "Due immediately"
        DAYS_7 = "7_days", "7 days"
        DAYS_14 = "14_days", "14 days"
        DAYS_30 = "30_days", "30 days"
        DAYS_60 = "60_days", "60 days"

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    organisation = models.ForeignKey(
        Organisation,
        on_delete=models.CASCADE,
        related_name="contacts",
    )

    name = models.CharField(
        max_length=255,
    )

    account_number = models.CharField(
        max_length=100,
        blank=True,
    )

    contact_name = models.CharField(
        max_length=255,
        blank=True,
    )

    email = models.EmailField(
        blank=True,
    )

    phone = models.CharField(
        max_length=50,
        blank=True,
    )

    website = models.URLField(
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

    is_customer = models.BooleanField(
        default=False,
    )

    is_supplier = models.BooleanField(
        default=False,
    )

    payment_terms = models.CharField(
        max_length=20,
        choices=PaymentTerms.choices,
        default=PaymentTerms.DAYS_30,
    )

    currency = models.CharField(
        max_length=3,
        blank=True,
    )

    credit_limit = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        null=True,
        blank=True,
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

    country_code = models.CharField(
        max_length=2,
        blank=True,
    )

    notes = models.TextField(
        blank=True,
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.ACTIVE,
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="contacts_created",
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    class Meta:
        ordering = ["name"]

        constraints = [
            models.UniqueConstraint(
                fields=["organisation", "account_number"],
                condition=~models.Q(account_number=""),
                name="unique_contact_account_number_per_organisation",
            )
        ]

        indexes = [
            models.Index(
                fields=["organisation", "name"],
            ),
            models.Index(
                fields=["organisation", "is_customer"],
            ),
            models.Index(
                fields=["organisation", "is_supplier"],
            ),
        ]

    def __str__(self):
        return self.name


class ContactImportBatch(models.Model):
    class ImportType(models.TextChoices):
        CUSTOMER="customer","Customer"
        SUPPLIER="supplier","Supplier"
    class Status(models.TextChoices):
        READY="ready","Ready"
        COMPLETED="completed","Completed"
        FAILED="failed","Failed"
        CANCELLED="cancelled","Cancelled"
        EXPIRED="expired","Expired"
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
    organisation=models.ForeignKey(Organisation,on_delete=models.CASCADE,related_name="contact_import_batches")
    import_type=models.CharField(max_length=20,choices=ImportType.choices)
    uploaded_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT,related_name="contact_imports_uploaded")
    confirmed_by=models.ForeignKey(settings.AUTH_USER_MODEL,null=True,blank=True,on_delete=models.PROTECT,related_name="contact_imports_confirmed")
    original_filename=models.CharField(max_length=255)
    checksum=models.CharField(max_length=64)
    template_version=models.CharField(max_length=20,default="1")
    import_mode=models.CharField(max_length=30,default="stop_on_existing")
    rows=models.JSONField(default=list)
    total_rows=models.PositiveIntegerField(default=0);valid_rows=models.PositiveIntegerField(default=0);warning_rows=models.PositiveIntegerField(default=0);error_rows=models.PositiveIntegerField(default=0);duplicate_rows=models.PositiveIntegerField(default=0)
    created_record_ids=models.JSONField(default=list);skipped_rows=models.PositiveIntegerField(default=0)
    status=models.CharField(max_length=20,choices=Status.choices,default=Status.READY)
    failure_reason=models.TextField(blank=True);uploaded_at=models.DateTimeField(auto_now_add=True);confirmed_at=models.DateTimeField(null=True,blank=True);expires_at=models.DateTimeField()
    class Meta: ordering=["-uploaded_at"]
