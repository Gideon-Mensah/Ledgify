"""Sales documents and payments with status rules that protect posted history."""

import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models

from apps.contacts.models import Contact
from apps.organisations.models import Organisation
from apps.accounting.models import Account


class Quote(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SENT = "sent", "Sent"
        ACCEPTED = "accepted", "Accepted"
        DECLINED = "declined", "Declined"
        EXPIRED = "expired", "Expired"
        CONVERTED = "converted", "Converted"
        VOID = "void", "Void"
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(Organisation, on_delete=models.CASCADE, related_name="quotes")
    customer = models.ForeignKey(Contact, on_delete=models.PROTECT, related_name="quotes")
    quote_number = models.CharField(max_length=50)
    issue_date = models.DateField(); expiry_date = models.DateField()
    currency = models.CharField(max_length=3); reference = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    subtotal = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    tax_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    converted_invoice = models.OneToOneField("Invoice", on_delete=models.PROTECT, null=True, blank=True, related_name="source_quote")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="quotes_created")
    accepted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="quotes_accepted")
    accepted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True); updated_at = models.DateTimeField(auto_now=True)
    class Meta:
        ordering = ["-issue_date", "-created_at"]
        constraints = [models.UniqueConstraint(fields=["organisation", "quote_number"], name="unique_quote_number_per_org")]
    def delete(self, *args, **kwargs):
        if self.status != self.Status.DRAFT:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Only draft quotes can be deleted.")
        return super().delete(*args, **kwargs)


class QuoteLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    quote = models.ForeignKey(Quote, on_delete=models.CASCADE, related_name="lines")
    product = models.ForeignKey("inventory.Product", on_delete=models.PROTECT, null=True, blank=True, related_name="quote_lines")
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=18, decimal_places=4)
    unit_price = models.DecimalField(max_digits=18, decimal_places=4)
    discount_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    tax_rate = models.DecimalField(max_digits=7, decimal_places=4, default=Decimal("0"))
    tax_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    line_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    revenue_account = models.ForeignKey(Account, on_delete=models.PROTECT, null=True, blank=True, related_name="quote_lines")
    def save(self, *args, **kwargs):
        if self.quote.status != Quote.Status.DRAFT:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Accepted or converted quote lines cannot be edited.")
        super().save(*args, **kwargs)
    def delete(self, *args, **kwargs):
        if self.quote.status != Quote.Status.DRAFT:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Accepted or converted quote lines cannot be deleted.")
        return super().delete(*args, **kwargs)


class SalesOrder(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        APPROVED = "approved", "Approved"
        PARTLY_FULFILLED = "partly_fulfilled", "Partly fulfilled"
        FULFILLED = "fulfilled", "Fulfilled"
        INVOICED = "invoiced", "Invoiced"
        CANCELLED = "cancelled", "Cancelled"
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(Organisation, on_delete=models.CASCADE, related_name="sales_orders")
    customer = models.ForeignKey(Contact, on_delete=models.PROTECT, related_name="sales_orders")
    order_number = models.CharField(max_length=50); order_date = models.DateField()
    expected_delivery_date = models.DateField(null=True, blank=True); currency = models.CharField(max_length=3)
    reference = models.CharField(max_length=100, blank=True); notes = models.TextField(blank=True)
    status = models.CharField(max_length=30, choices=Status.choices, default=Status.DRAFT)
    subtotal = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    tax_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    quote = models.OneToOneField(Quote, on_delete=models.PROTECT, null=True, blank=True, related_name="sales_order")
    invoice = models.OneToOneField("Invoice", on_delete=models.PROTECT, null=True, blank=True, related_name="sales_order")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="sales_orders_created")
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="sales_orders_approved")
    approved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True); updated_at = models.DateTimeField(auto_now=True)
    class Meta:
        ordering = ["-order_date", "-created_at"]
        constraints = [models.UniqueConstraint(fields=["organisation", "order_number"], name="unique_sales_order_number_per_org")]
    def delete(self, *args, **kwargs):
        if self.status != self.Status.DRAFT:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Only draft sales orders can be deleted.")
        return super().delete(*args, **kwargs)


class SalesOrderLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sales_order = models.ForeignKey(SalesOrder, on_delete=models.CASCADE, related_name="lines")
    product = models.ForeignKey("inventory.Product", on_delete=models.PROTECT, null=True, blank=True, related_name="sales_order_lines")
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=18, decimal_places=4)
    quantity_fulfilled = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    unit_price = models.DecimalField(max_digits=18, decimal_places=4)
    discount_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    tax_rate = models.DecimalField(max_digits=7, decimal_places=4, default=Decimal("0"))
    tax_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    line_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    revenue_account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="sales_order_lines")
    def delete(self, *args, **kwargs):
        if self.sales_order.status != SalesOrder.Status.DRAFT:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Approved sales order lines cannot be deleted.")
        return super().delete(*args, **kwargs)


class Invoice(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        AWAITING_APPROVAL = "awaiting_approval", "Awaiting approval"
        APPROVED = "approved", "Approved"
        SENT = "sent", "Sent"
        PARTLY_PAID = "partly_paid", "Partly paid"
        PAID = "paid", "Paid"
        VOID = "void", "Void"
        WRITTEN_OFF = "written_off", "Written off"

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    organisation = models.ForeignKey(
        Organisation,
        on_delete=models.CASCADE,
        related_name="invoices",
    )

    customer = models.ForeignKey(
        Contact,
        on_delete=models.PROTECT,
        related_name="invoices",
    )

    invoice_number = models.CharField(
        max_length=50,
    )

    issue_date = models.DateField()

    due_date = models.DateField()

    currency = models.CharField(
        max_length=3,
    )
    exchange_rate = models.DecimalField(max_digits=20, decimal_places=10, default=Decimal("1"))
    base_currency_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))

    reference = models.CharField(
        max_length=100,
        blank=True,
    )

    notes = models.TextField(
        blank=True,
    )

    subtotal = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        default=Decimal("0.00"),
    )

    tax_total = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        default=Decimal("0.00"),
    )

    total = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        default=Decimal("0.00"),
    )

    amount_paid = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        default=Decimal("0.00"),
    )

    amount_credited = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        default=Decimal("0.00"),
    )

    amount_written_off = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        default=Decimal("0.00"),
    )

    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.DRAFT,
    )

    accounting_journal = models.OneToOneField(
        "accounting.JournalEntry",
        on_delete=models.PROTECT,
        related_name="invoice",
        null=True,
        blank=True,
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="invoices_created",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="invoices_approved",
        null=True,
        blank=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    class Meta:
        ordering = ["-issue_date", "-created_at"]

        constraints = [
            models.UniqueConstraint(
                fields=["organisation", "invoice_number"],
                name="unique_invoice_number_per_organisation",
            )
        ]

        indexes = [
            models.Index(
                fields=["organisation", "status"],
            ),
            models.Index(
                fields=["organisation", "issue_date"],
            ),
            models.Index(
                fields=["organisation", "customer"],
            ),
        ]

    @property
    def amount_due(self):
        return (
            self.total
            - self.amount_paid
            - self.amount_credited
            - self.amount_written_off
        )

    def __str__(self):
        return f"{self.invoice_number} - {self.customer.name}"
    
    def save(self, *args, **kwargs):
        if self.pk:
            previous = Invoice.objects.filter(
                pk=self.pk
            ).first()

            if previous:
                locked_statuses = {
                    Invoice.Status.APPROVED,
                    Invoice.Status.SENT,
                    Invoice.Status.PARTLY_PAID,
                    Invoice.Status.PAID,
                    Invoice.Status.VOID,
                    Invoice.Status.WRITTEN_OFF,
                }

                if previous.status in locked_statuses:
                    protected_fields = [
                        "organisation_id",
                        "customer_id",
                        "invoice_number",
                        "issue_date",
                        "due_date",
                        "currency",
                        "subtotal",
                        "tax_total",
                        "total",
                    ]

                    for field in protected_fields:
                        if getattr(previous, field) != getattr(self, field):
                            from common.exceptions import BusinessRuleError

                            raise BusinessRuleError(
                                "Approved or posted invoices cannot be edited. "
                                "Use a credit note, void, or reversal instead."
                            )

        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.status != Invoice.Status.DRAFT:
            from common.exceptions import BusinessRuleError

            raise BusinessRuleError(
                "Only draft invoices can be deleted."
            )

        return super().delete(*args, **kwargs)


class InvoiceLine(models.Model):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    invoice = models.ForeignKey(
        Invoice,
        on_delete=models.CASCADE,
        related_name="lines",
    )

    description = models.CharField(
        max_length=255,
    )

    quantity = models.DecimalField(
        max_digits=18,
        decimal_places=4,
        default=Decimal("1.0000"),
    )

    unit_price = models.DecimalField(
        max_digits=18,
        decimal_places=4,
        default=Decimal("0.0000"),
    )

    discount_amount = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        default=Decimal("0.00"),
    )

    tax_rate = models.DecimalField(
        max_digits=7,
        decimal_places=4,
        default=Decimal("0.0000"),
    )
    tax_rate_config = models.ForeignKey(
        "tax.TaxRate", on_delete=models.PROTECT, related_name="invoice_lines",
        null=True, blank=True,
    )

    tax_amount = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        default=Decimal("0.00"),
    )

    line_total = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        default=Decimal("0.00"),
    )

    revenue_account = models.ForeignKey(
        Account,
        on_delete=models.PROTECT,
        related_name="invoice_lines",
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )
    
    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(quantity__gt=0),
                name="invoice_line_quantity_positive",
            ),
            models.CheckConstraint(
                condition=models.Q(unit_price__gte=0),
                name="invoice_line_unit_price_non_negative",
            ),
            models.CheckConstraint(
                condition=models.Q(discount_amount__gte=0),
                name="invoice_line_discount_non_negative",
            ),
            models.CheckConstraint(
                condition=models.Q(tax_amount__gte=0),
                name="invoice_line_tax_non_negative",
            ),
        ]

    def __str__(self):
        return f"{self.invoice.invoice_number} - {self.description}"
    
    def save(self, *args, **kwargs):
        if self.invoice.status != Invoice.Status.DRAFT:
            from common.exceptions import BusinessRuleError

            raise BusinessRuleError(
                "Invoice lines cannot be edited after the invoice "
                "has left draft status."
            )

        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.invoice.status != Invoice.Status.DRAFT:
            from common.exceptions import BusinessRuleError

            raise BusinessRuleError(
                "Invoice lines cannot be deleted after the invoice "
                "has left draft status."
            )

        return super().delete(*args, **kwargs)

class CustomerCreditNote(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        AWAITING_APPROVAL = "awaiting_approval", "Awaiting approval"
        APPROVED = "approved", "Approved"
        PARTLY_APPLIED = "partly_applied", "Partly applied"
        APPLIED = "applied", "Applied"
        VOID = "void", "Void"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="customer_credit_notes"
    )
    customer = models.ForeignKey(
        Contact, on_delete=models.PROTECT, related_name="credit_notes"
    )
    invoice = models.ForeignKey(
        Invoice, on_delete=models.PROTECT, related_name="credit_notes",
        null=True, blank=True,
    )
    credit_note_number = models.CharField(max_length=50)
    issue_date = models.DateField()
    currency = models.CharField(max_length=3)
    exchange_rate = models.DecimalField(max_digits=20, decimal_places=10, default=Decimal("1"))
    base_currency_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    reference = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    subtotal = models.DecimalField(
        max_digits=18, decimal_places=2, default=Decimal("0.00")
    )
    tax_total = models.DecimalField(
        max_digits=18, decimal_places=2, default=Decimal("0.00")
    )
    total = models.DecimalField(
        max_digits=18, decimal_places=2, default=Decimal("0.00")
    )
    amount_applied = models.DecimalField(
        max_digits=18, decimal_places=2, default=Decimal("0.00")
    )
    amount_refunded = models.DecimalField(
        max_digits=18, decimal_places=2, default=Decimal("0.00")
    )
    status = models.CharField(
        max_length=30, choices=Status.choices, default=Status.DRAFT
    )
    accounting_journal = models.OneToOneField(
        "accounting.JournalEntry", on_delete=models.PROTECT,
        related_name="customer_credit_note", null=True, blank=True,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="customer_credit_notes_created",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="customer_credit_notes_approved",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-issue_date", "-created_at"]
        constraints = [models.UniqueConstraint(
            fields=["organisation", "credit_note_number"],
            name="unique_customer_credit_number_per_organisation",
        )]
        indexes = [
            models.Index(fields=["organisation", "status"]),
            models.Index(fields=["organisation", "customer"]),
            models.Index(fields=["organisation", "issue_date"]),
        ]

    @property
    def available_credit(self):
        return self.total - self.amount_applied - self.amount_refunded

    def save(self, *args, **kwargs):
        if self.pk:
            previous = CustomerCreditNote.objects.filter(pk=self.pk).first()
            if previous and previous.status != self.Status.DRAFT:
                protected = (
                    "organisation_id", "customer_id", "invoice_id",
                    "credit_note_number", "issue_date", "currency",
                    "subtotal", "tax_total", "total",
                )
                if any(getattr(previous, field) != getattr(self, field) for field in protected):
                    from common.exceptions import BusinessRuleError
                    raise BusinessRuleError(
                        "Approved customer credit notes cannot be edited."
                    )
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.status != self.Status.DRAFT:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Only draft credit notes can be deleted.")
        return super().delete(*args, **kwargs)


class CustomerCreditNoteLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    credit_note = models.ForeignKey(
        CustomerCreditNote, on_delete=models.CASCADE, related_name="lines"
    )
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(
        max_digits=18, decimal_places=4, default=Decimal("1.0000")
    )
    unit_price = models.DecimalField(
        max_digits=18, decimal_places=4, default=Decimal("0.0000")
    )
    discount_amount = models.DecimalField(
        max_digits=18, decimal_places=2, default=Decimal("0.00")
    )
    tax_rate = models.DecimalField(
        max_digits=7, decimal_places=4, default=Decimal("0.0000")
    )
    tax_rate_config = models.ForeignKey(
        "tax.TaxRate", on_delete=models.PROTECT, related_name="customer_credit_lines",
        null=True, blank=True,
    )
    tax_amount = models.DecimalField(
        max_digits=18, decimal_places=2, default=Decimal("0.00")
    )
    line_total = models.DecimalField(
        max_digits=18, decimal_places=2, default=Decimal("0.00")
    )
    revenue_account = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name="customer_credit_lines"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if self.credit_note.status != CustomerCreditNote.Status.DRAFT:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Approved credit note lines cannot be edited.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.credit_note.status != CustomerCreditNote.Status.DRAFT:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Approved credit note lines cannot be deleted.")
        return super().delete(*args, **kwargs)


class CustomerCreditAllocation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE,
        related_name="customer_credit_allocations",
    )
    credit_note = models.ForeignKey(
        CustomerCreditNote, on_delete=models.PROTECT, related_name="allocations"
    )
    invoice = models.ForeignKey(
        Invoice, on_delete=models.PROTECT, related_name="credit_allocations"
    )
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    applied_at = models.DateTimeField()
    applied_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="customer_credit_allocations_applied",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.CheckConstraint(
            condition=models.Q(amount__gt=0),
            name="customer_credit_allocation_amount_positive",
        )]


class CustomerRefund(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        POSTED = "posted", "Posted"
        VOID = "void", "Void"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="customer_refunds"
    )
    customer = models.ForeignKey(
        Contact, on_delete=models.PROTECT, related_name="refunds"
    )
    credit_note = models.ForeignKey(
        CustomerCreditNote, on_delete=models.PROTECT, related_name="refunds",
        null=True, blank=True,
    )
    bank_account = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name="customer_refunds_issued"
    )
    refund_date = models.DateField()
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    currency = models.CharField(max_length=3)
    reference = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.DRAFT
    )
    accounting_journal = models.OneToOneField(
        "accounting.JournalEntry", on_delete=models.PROTECT,
        related_name="customer_refund", null=True, blank=True,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="customer_refunds_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-refund_date", "-created_at"]
        constraints = [models.CheckConstraint(
            condition=models.Q(amount__gt=0), name="customer_refund_amount_positive"
        )]
        indexes = [
            models.Index(fields=["organisation", "status"]),
            models.Index(fields=["organisation", "customer"]),
            models.Index(fields=["organisation", "refund_date"]),
        ]

    def save(self, *args, **kwargs):
        if self.pk:
            previous = CustomerRefund.objects.filter(pk=self.pk).first()
            if previous and previous.status == self.Status.POSTED:
                protected = (
                    "organisation_id", "customer_id", "credit_note_id",
                    "bank_account_id", "refund_date", "amount", "currency",
                )
                if any(getattr(previous, field) != getattr(self, field) for field in protected):
                    from common.exceptions import BusinessRuleError
                    raise BusinessRuleError("Posted refunds cannot be edited.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.status != self.Status.DRAFT:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Only draft refunds can be deleted.")
        return super().delete(*args, **kwargs)


class BadDebtWriteOff(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        POSTED = "posted", "Posted"
        VOID = "void", "Void"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="bad_debt_write_offs"
    )
    invoice = models.ForeignKey(
        Invoice, on_delete=models.PROTECT, related_name="write_offs"
    )
    write_off_date = models.DateField()
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    reason = models.TextField(blank=True)
    reference = models.CharField(max_length=100, blank=True)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.DRAFT
    )
    bad_debt_account = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name="bad_debt_write_offs"
    )
    accounting_journal = models.OneToOneField(
        "accounting.JournalEntry", on_delete=models.PROTECT,
        related_name="bad_debt_write_off", null=True, blank=True,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="bad_debt_write_offs_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-write_off_date", "-created_at"]
        constraints = [models.CheckConstraint(
            condition=models.Q(amount__gt=0), name="bad_debt_write_off_amount_positive"
        )]
        indexes = [
            models.Index(fields=["organisation", "status"]),
            models.Index(fields=["organisation", "invoice"]),
            models.Index(fields=["organisation", "write_off_date"]),
        ]

    def save(self, *args, **kwargs):
        if self.pk:
            previous = BadDebtWriteOff.objects.filter(pk=self.pk).first()
            if previous and previous.status == self.Status.POSTED:
                protected = (
                    "organisation_id", "invoice_id", "write_off_date",
                    "amount", "bad_debt_account_id",
                )
                if any(getattr(previous, field) != getattr(self, field) for field in protected):
                    from common.exceptions import BusinessRuleError
                    raise BusinessRuleError("Posted write-offs cannot be edited.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.status != self.Status.DRAFT:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Only draft write-offs can be deleted.")
        return super().delete(*args, **kwargs)


class CustomerPayment(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        POSTED = "posted", "Posted"
        VOID = "void", "Void"
        REVERSED = "reversed", "Reversed"

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    organisation = models.ForeignKey(
        Organisation,
        on_delete=models.CASCADE,
        related_name="customer_payments",
    )

    customer = models.ForeignKey(
        Contact,
        on_delete=models.PROTECT,
        related_name="customer_payments_received",
        null=True,
        blank=True,
    )

    invoice = models.ForeignKey(
        Invoice,
        on_delete=models.PROTECT,
        related_name="payments",
        null=True,
        blank=True,
    )

    bank_account = models.ForeignKey(
        Account,
        on_delete=models.PROTECT,
        related_name="customer_payments",
    )

    payment_date = models.DateField()

    amount = models.DecimalField(
        max_digits=18,
        decimal_places=2,
    )

    currency = models.CharField(
        max_length=3,
    )
    exchange_rate = models.DecimalField(max_digits=20, decimal_places=10, default=Decimal("1"))
    base_currency_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    realised_fx_gain_loss = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))

    reference = models.CharField(
        max_length=100,
        blank=True,
    )

    notes = models.TextField(
        blank=True,
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
    )

    accounting_journal = models.OneToOneField(
        "accounting.JournalEntry",
        on_delete=models.PROTECT,
        related_name="customer_payment",
        null=True,
        blank=True,
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="customer_payments_created",
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    class Meta:
        ordering = [
            "-payment_date",
            "-created_at",
        ]

        indexes = [
            models.Index(
                fields=["organisation", "payment_date"],
            ),
            models.Index(
                fields=["organisation", "status"],
            ),
            models.Index(
                fields=["organisation", "invoice"],
            ),
        ]

        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__gt=0),
                name="customer_payment_amount_positive",
            )
        ]

    def __str__(self):
        document = self.invoice.invoice_number if self.invoice_id else "Unallocated"
        return (
            f"{document} "
            f"- {self.amount} {self.currency}"
        )

    @property
    def amount_allocated(self):
        return self.allocations.filter(
            status=CustomerPaymentAllocation.Status.ACTIVE,
        ).aggregate(
            total=models.Sum("amount")
        )["total"] or Decimal("0.00")

    @property
    def amount_unallocated(self):
        return self.amount - self.amount_allocated

    def save(self, *args, **kwargs):
        if self.pk:
            previous = CustomerPayment.objects.filter(pk=self.pk).first()
            if previous and previous.status == self.Status.REVERSED:
                protected = (
                    "organisation_id", "customer_id", "invoice_id",
                    "bank_account_id", "payment_date", "amount", "currency",
                    "reference", "notes", "status", "accounting_journal_id",
                )
                if any(
                    getattr(previous, field) != getattr(self, field)
                    for field in protected
                ):
                    from common.exceptions import BusinessRuleError
                    raise BusinessRuleError("Reversed customer payments cannot be edited.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.status == self.Status.REVERSED:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Reversed customer payments cannot be deleted.")
        return super().delete(*args, **kwargs)


class CustomerPaymentAllocation(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        REVERSED = "reversed", "Reversed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE,
        related_name="customer_payment_allocations",
    )
    payment = models.ForeignKey(
        CustomerPayment, on_delete=models.PROTECT, related_name="allocations"
    )
    invoice = models.ForeignKey(
        Invoice, on_delete=models.PROTECT, related_name="payment_allocations"
    )
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    allocated_at = models.DateTimeField()
    allocated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="customer_payment_allocations_created",
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    reversed_at = models.DateTimeField(null=True, blank=True)
    reversed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="customer_payment_allocations_reversed",
        null=True,
        blank=True,
    )
    reversal_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.CheckConstraint(
            condition=models.Q(amount__gt=0),
            name="customer_payment_allocation_amount_positive",
        )]
        indexes = [
            models.Index(fields=["organisation", "payment"]),
            models.Index(fields=["organisation", "invoice"]),
        ]

    def save(self, *args, **kwargs):
        if self.pk:
            previous = CustomerPaymentAllocation.objects.filter(pk=self.pk).first()
            if previous and previous.status == self.Status.REVERSED:
                protected = (
                    "organisation_id", "payment_id", "invoice_id", "amount",
                    "allocated_at", "allocated_by_id", "status", "reversed_at",
                    "reversed_by_id", "reversal_reason",
                )
                if any(
                    getattr(previous, field) != getattr(self, field)
                    for field in protected
                ):
                    from common.exceptions import BusinessRuleError
                    raise BusinessRuleError("Reversed payment allocations cannot be edited.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.status == self.Status.REVERSED:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Reversed payment allocations cannot be deleted.")
        return super().delete(*args, **kwargs)
