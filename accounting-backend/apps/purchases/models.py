"""Purchase documents, credits, and payments with immutable posted financial fields."""

import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models

from apps.accounting.models import Account
from apps.contacts.models import Contact
from apps.organisations.models import Organisation


class PurchaseOrder(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        APPROVED = "approved", "Approved"
        PARTLY_RECEIVED = "partly_received", "Partly received"
        RECEIVED = "received", "Received"
        BILLED = "billed", "Billed"
        CANCELLED = "cancelled", "Cancelled"
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(Organisation, on_delete=models.CASCADE, related_name="purchase_orders")
    supplier = models.ForeignKey(Contact, on_delete=models.PROTECT, related_name="purchase_orders")
    purchase_order_number = models.CharField(max_length=50); order_date = models.DateField()
    expected_delivery_date = models.DateField(null=True, blank=True); currency = models.CharField(max_length=3)
    supplier_reference = models.CharField(max_length=100, blank=True); notes = models.TextField(blank=True)
    status = models.CharField(max_length=30, choices=Status.choices, default=Status.DRAFT)
    subtotal = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    tax_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    bill = models.OneToOneField("Bill", on_delete=models.PROTECT, null=True, blank=True, related_name="purchase_order")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="purchase_orders_created")
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="purchase_orders_approved")
    approved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True); updated_at = models.DateTimeField(auto_now=True)
    class Meta:
        ordering = ["-order_date", "-created_at"]
        constraints = [models.UniqueConstraint(fields=["organisation", "purchase_order_number"], name="unique_purchase_order_number_per_org")]
    def delete(self, *args, **kwargs):
        if self.status != self.Status.DRAFT:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Only draft purchase orders can be deleted.")
        return super().delete(*args, **kwargs)


class PurchaseOrderLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    purchase_order = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name="lines")
    product = models.ForeignKey("inventory.Product", on_delete=models.PROTECT, null=True, blank=True, related_name="purchase_order_lines")
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=18, decimal_places=4)
    quantity_received = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    quantity_billed = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    unit_price = models.DecimalField(max_digits=18, decimal_places=4)
    discount_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    tax_rate = models.DecimalField(max_digits=7, decimal_places=4, default=Decimal("0"))
    tax_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    line_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    expense_account = models.ForeignKey(Account, on_delete=models.PROTECT, null=True, blank=True, related_name="purchase_order_lines")
    def delete(self, *args, **kwargs):
        if self.purchase_order.status != PurchaseOrder.Status.DRAFT:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Approved purchase order lines cannot be deleted.")
        return super().delete(*args, **kwargs)


class Bill(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        AWAITING_APPROVAL = "awaiting_approval", "Awaiting approval"
        APPROVED = "approved", "Approved"
        PARTLY_PAID = "partly_paid", "Partly paid"
        PAID = "paid", "Paid"
        VOID = "void", "Void"

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    organisation = models.ForeignKey(
        Organisation,
        on_delete=models.CASCADE,
        related_name="bills",
    )

    supplier = models.ForeignKey(
        Contact,
        on_delete=models.PROTECT,
        related_name="bills",
    )

    bill_number = models.CharField(
        max_length=50,
    )

    supplier_reference = models.CharField(
        max_length=100,
        blank=True,
    )

    issue_date = models.DateField()

    due_date = models.DateField()

    currency = models.CharField(
        max_length=3,
    )
    exchange_rate = models.DecimalField(max_digits=20, decimal_places=10, default=Decimal("1"))
    base_currency_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))

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

    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.DRAFT,
    )

    accounting_journal = models.OneToOneField(
        "accounting.JournalEntry",
        on_delete=models.PROTECT,
        related_name="bill",
        null=True,
        blank=True,
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="bills_created",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="bills_approved",
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
        ordering = [
            "-issue_date",
            "-created_at",
        ]

        constraints = [
            models.UniqueConstraint(
                fields=["organisation", "bill_number"],
                name="unique_bill_number_per_organisation",
            )
        ]

        indexes = [
            models.Index(
                fields=["organisation", "status"],
            ),
            models.Index(
                fields=["organisation", "supplier"],
            ),
            models.Index(
                fields=["organisation", "issue_date"],
            ),
        ]

    @property
    def amount_due(self):
        return self.total - self.amount_paid - self.amount_credited

    def __str__(self):
        return f"{self.bill_number} - {self.supplier.name}"

    def save(self, *args, **kwargs):
        if self.pk:
            previous = Bill.objects.filter(
                pk=self.pk
            ).first()

            if previous:
                locked_statuses = {
                    Bill.Status.APPROVED,
                    Bill.Status.PARTLY_PAID,
                    Bill.Status.PAID,
                    Bill.Status.VOID,
                }

                if previous.status in locked_statuses:
                    protected_fields = [
                        "organisation_id",
                        "supplier_id",
                        "bill_number",
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
                                "Approved or posted bills cannot be edited."
                            )

        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.status != Bill.Status.DRAFT:
            from common.exceptions import BusinessRuleError

            raise BusinessRuleError(
                "Only draft bills can be deleted."
            )

        return super().delete(*args, **kwargs)


class BillLine(models.Model):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    bill = models.ForeignKey(
        Bill,
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
        "tax.TaxRate", on_delete=models.PROTECT, related_name="bill_lines",
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

    expense_account = models.ForeignKey(
        Account,
        on_delete=models.PROTECT,
        related_name="bill_lines",
    )

    inventory_receipt = models.OneToOneField(
        "inventory.InventoryTransaction",
        on_delete=models.PROTECT,
        related_name="supplier_bill_line",
        null=True,
        blank=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(quantity__gt=0),
                name="bill_line_quantity_positive",
            ),
            models.CheckConstraint(
                condition=models.Q(unit_price__gte=0),
                name="bill_line_unit_price_non_negative",
            ),
            models.CheckConstraint(
                condition=models.Q(discount_amount__gte=0),
                name="bill_line_discount_non_negative",
            ),
            models.CheckConstraint(
                condition=models.Q(tax_amount__gte=0),
                name="bill_line_tax_non_negative",
            ),
        ]

    def __str__(self):
        return f"{self.bill.bill_number} - {self.description}"

    def save(self, *args, **kwargs):
        if self.bill.status != Bill.Status.DRAFT:
            from common.exceptions import BusinessRuleError

            raise BusinessRuleError(
                "Bill lines cannot be edited after the bill "
                "has left draft status."
            )

        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.bill.status != Bill.Status.DRAFT:
            from common.exceptions import BusinessRuleError

            raise BusinessRuleError(
                "Bill lines cannot be deleted after the bill "
                "has left draft status."
            )

        return super().delete(*args, **kwargs)
    
class SupplierCredit(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        AWAITING_APPROVAL = "awaiting_approval", "Awaiting approval"
        APPROVED = "approved", "Approved"
        PARTLY_APPLIED = "partly_applied", "Partly applied"
        APPLIED = "applied", "Applied"
        VOID = "void", "Void"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="supplier_credits"
    )
    supplier = models.ForeignKey(
        Contact, on_delete=models.PROTECT, related_name="supplier_credits"
    )
    bill = models.ForeignKey(
        Bill, on_delete=models.PROTECT, related_name="supplier_credits",
        null=True, blank=True,
    )
    credit_number = models.CharField(max_length=50)
    issue_date = models.DateField()
    currency = models.CharField(max_length=3)
    exchange_rate = models.DecimalField(max_digits=20, decimal_places=10, default=Decimal("1"))
    base_currency_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    reference = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    subtotal = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    tax_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    amount_applied = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    amount_refunded = models.DecimalField(
        max_digits=18, decimal_places=2, default=Decimal("0.00")
    )
    status = models.CharField(max_length=30, choices=Status.choices, default=Status.DRAFT)
    accounting_journal = models.OneToOneField(
        "accounting.JournalEntry", on_delete=models.PROTECT,
        related_name="supplier_credit", null=True, blank=True,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="supplier_credits_created",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="supplier_credits_approved",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-issue_date", "-created_at"]
        constraints = [models.UniqueConstraint(
            fields=["organisation", "credit_number"],
            name="unique_supplier_credit_number_per_organisation",
        )]
        indexes = [
            models.Index(fields=["organisation", "status"]),
            models.Index(fields=["organisation", "supplier"]),
            models.Index(fields=["organisation", "issue_date"]),
        ]

    @property
    def available_credit(self):
        return self.total - self.amount_applied - self.amount_refunded

    def save(self, *args, **kwargs):
        if self.pk:
            previous = SupplierCredit.objects.filter(pk=self.pk).first()
            if previous and previous.status != self.Status.DRAFT:
                protected = (
                    "organisation_id", "supplier_id", "bill_id", "credit_number",
                    "issue_date", "currency", "subtotal", "tax_total", "total",
                )
                if any(getattr(previous, field) != getattr(self, field) for field in protected):
                    from common.exceptions import BusinessRuleError
                    raise BusinessRuleError(
                        "Approved supplier credits cannot be edited."
                    )
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.status != self.Status.DRAFT:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Only draft supplier credits can be deleted.")
        return super().delete(*args, **kwargs)


class SupplierCreditLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    credit = models.ForeignKey(SupplierCredit, on_delete=models.CASCADE, related_name="lines")
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("1.0000"))
    unit_price = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0.0000"))
    discount_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    tax_rate = models.DecimalField(max_digits=7, decimal_places=4, default=Decimal("0.0000"))
    tax_rate_config = models.ForeignKey(
        "tax.TaxRate", on_delete=models.PROTECT, related_name="supplier_credit_lines",
        null=True, blank=True,
    )
    tax_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    line_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    expense_account = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name="supplier_credit_lines"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if self.credit.status != SupplierCredit.Status.DRAFT:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Approved supplier credit lines cannot be edited.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.credit.status != SupplierCredit.Status.DRAFT:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Approved supplier credit lines cannot be deleted.")
        return super().delete(*args, **kwargs)


class SupplierCreditAllocation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE,
        related_name="supplier_credit_allocations",
    )
    credit = models.ForeignKey(
        SupplierCredit, on_delete=models.PROTECT, related_name="allocations"
    )
    bill = models.ForeignKey(Bill, on_delete=models.PROTECT, related_name="credit_allocations")
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    applied_at = models.DateTimeField()
    applied_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="supplier_credit_allocations_applied",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.CheckConstraint(
            condition=models.Q(amount__gt=0),
            name="supplier_credit_allocation_amount_positive",
        )]


class SupplierRefund(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        POSTED = "posted", "Posted"
        VOID = "void", "Void"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="supplier_refunds"
    )
    supplier = models.ForeignKey(
        Contact, on_delete=models.PROTECT, related_name="supplier_refunds"
    )
    supplier_credit = models.ForeignKey(
        SupplierCredit, on_delete=models.PROTECT, related_name="refunds"
    )
    bank_account = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name="supplier_refunds_received"
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
        related_name="supplier_refund", null=True, blank=True,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="supplier_refunds_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-refund_date", "-created_at"]
        constraints = [models.CheckConstraint(
            condition=models.Q(amount__gt=0), name="supplier_refund_amount_positive"
        )]
        indexes = [
            models.Index(fields=["organisation", "status"]),
            models.Index(fields=["organisation", "supplier"]),
            models.Index(fields=["organisation", "refund_date"]),
            models.Index(fields=["organisation", "supplier_credit"]),
        ]

    def save(self, *args, **kwargs):
        if self.pk:
            previous = SupplierRefund.objects.filter(pk=self.pk).first()
            if previous and previous.status in {self.Status.POSTED, self.Status.VOID}:
                protected = (
                    "organisation_id", "supplier_id", "supplier_credit_id",
                    "bank_account_id", "refund_date", "amount", "currency",
                )
                if any(getattr(previous, field) != getattr(self, field) for field in protected):
                    from common.exceptions import BusinessRuleError
                    raise BusinessRuleError("Posted supplier refunds cannot be edited.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.status != self.Status.DRAFT:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Only draft supplier refunds can be deleted.")
        return super().delete(*args, **kwargs)


class SupplierPayment(models.Model):
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
        related_name="supplier_payments",
    )

    supplier = models.ForeignKey(
        Contact,
        on_delete=models.PROTECT,
        related_name="supplier_payments_made",
        null=True,
        blank=True,
    )

    bill = models.ForeignKey(
        Bill,
        on_delete=models.PROTECT,
        related_name="payments",
        null=True,
        blank=True,
    )

    bank_account = models.ForeignKey(
        Account,
        on_delete=models.PROTECT,
        related_name="supplier_payments",
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
        related_name="supplier_payment",
        null=True,
        blank=True,
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="supplier_payments_created",
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
                fields=["organisation", "bill"],
            ),
        ]

        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__gt=0),
                name="supplier_payment_amount_positive",
            )
        ]

    def __str__(self):
        document = self.bill.bill_number if self.bill_id else "Unallocated"
        return (
            f"{document} "
            f"- {self.amount} {self.currency}"
        )

    @property
    def amount_allocated(self):
        return self.allocations.filter(
            status=SupplierPaymentAllocation.Status.ACTIVE,
        ).aggregate(
            total=models.Sum("amount")
        )["total"] or Decimal("0.00")

    @property
    def amount_unallocated(self):
        return self.amount - self.amount_allocated

    def save(self, *args, **kwargs):
        if self.pk:
            previous = SupplierPayment.objects.filter(pk=self.pk).first()
            if previous and previous.status == self.Status.REVERSED:
                protected = (
                    "organisation_id", "supplier_id", "bill_id",
                    "bank_account_id", "payment_date", "amount", "currency",
                    "reference", "notes", "status", "accounting_journal_id",
                )
                if any(
                    getattr(previous, field) != getattr(self, field)
                    for field in protected
                ):
                    from common.exceptions import BusinessRuleError
                    raise BusinessRuleError("Reversed supplier payments cannot be edited.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.status == self.Status.REVERSED:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Reversed supplier payments cannot be deleted.")
        return super().delete(*args, **kwargs)


class SupplierPaymentAllocation(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        REVERSED = "reversed", "Reversed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE,
        related_name="supplier_payment_allocations",
    )
    payment = models.ForeignKey(
        SupplierPayment, on_delete=models.PROTECT, related_name="allocations"
    )
    bill = models.ForeignKey(
        Bill, on_delete=models.PROTECT, related_name="payment_allocations"
    )
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    allocated_at = models.DateTimeField()
    allocated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="supplier_payment_allocations_created",
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
        related_name="supplier_payment_allocations_reversed",
        null=True,
        blank=True,
    )
    reversal_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.CheckConstraint(
            condition=models.Q(amount__gt=0),
            name="supplier_payment_allocation_amount_positive",
        )]
        indexes = [
            models.Index(fields=["organisation", "payment"]),
            models.Index(fields=["organisation", "bill"]),
        ]

    def save(self, *args, **kwargs):
        if self.pk:
            previous = SupplierPaymentAllocation.objects.filter(pk=self.pk).first()
            if previous and previous.status == self.Status.REVERSED:
                protected = (
                    "organisation_id", "payment_id", "bill_id", "amount",
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
