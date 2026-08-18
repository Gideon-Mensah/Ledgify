"""Products, warehouses, movements, and immutable layers for perpetual inventory costing."""

import uuid
from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.db import models

from common.exceptions import BusinessRuleError
from apps.accounting.models import Account, JournalEntry
from apps.organisations.models import Organisation
from apps.contacts.models import Contact


MONEY_QUANTUM = Decimal("0.01")
COST_QUANTUM = Decimal("0.0001")


class Product(models.Model):
    class ProductType(models.TextChoices):
        GOODS = "goods", "Goods"
        SERVICE = "service", "Service"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        INACTIVE = "inactive", "Inactive"
        ARCHIVED = "archived", "Archived"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="products"
    )
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    product_type = models.CharField(max_length=20, choices=ProductType.choices)
    unit = models.CharField(max_length=50)
    sales_price = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    purchase_price = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    currency = models.CharField(max_length=3)
    inventory_asset_account = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name="inventory_products",
        null=True, blank=True,
    )
    sales_account = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name="products_for_sale",
        null=True, blank=True,
    )
    cost_of_goods_sold_account = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name="inventory_cost_products",
        null=True, blank=True,
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    track_inventory = models.BooleanField(default=False)
    minimum_quantity = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    maximum_quantity = models.DecimalField(max_digits=18, decimal_places=4, null=True, blank=True)
    reorder_quantity = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    preferred_supplier = models.ForeignKey(
        Contact, on_delete=models.PROTECT, related_name="preferred_inventory_products",
        null=True, blank=True,
    )
    default_sales_tax_rate = models.ForeignKey(
        "tax.TaxRate", on_delete=models.PROTECT, related_name="default_sales_products",
        null=True, blank=True,
    )
    default_purchase_tax_rate = models.ForeignKey(
        "tax.TaxRate", on_delete=models.PROTECT, related_name="default_purchase_products",
        null=True, blank=True,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="products_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code"]
        constraints = [models.UniqueConstraint(
            fields=["organisation", "code"], name="unique_product_code_per_organisation"
        )]
        indexes = [
            models.Index(fields=["organisation", "status"]),
            models.Index(fields=["organisation", "product_type"]),
            models.Index(fields=["organisation", "code"]),
        ]

    def clean(self):
        if self.product_type == self.ProductType.SERVICE and self.track_inventory:
            raise BusinessRuleError("Service products cannot track inventory.")
        account_rules = (
            (self.inventory_asset_account, Account.AccountType.ASSET, "Inventory asset"),
            (self.sales_account, Account.AccountType.REVENUE, "Sales"),
            (self.cost_of_goods_sold_account, Account.AccountType.EXPENSE, "Cost of goods sold"),
        )
        for account, account_type, label in account_rules:
            if account is None:
                continue
            if account.organisation_id != self.organisation_id:
                raise BusinessRuleError(f"{label} account belongs to another organisation.")
            if account.status != Account.Status.ACTIVE or account.account_type != account_type:
                raise BusinessRuleError(f"{label} account has an invalid type or status.")
        if self.minimum_quantity < 0 or self.reorder_quantity < 0:
            raise BusinessRuleError("Reorder quantities cannot be negative.")
        if self.maximum_quantity is not None and self.maximum_quantity < self.minimum_quantity:
            raise BusinessRuleError("Maximum quantity cannot be below minimum quantity.")
        if self.preferred_supplier is not None:
            if self.preferred_supplier.organisation_id != self.organisation_id:
                raise BusinessRuleError("Preferred supplier belongs to another organisation.")
            if not self.preferred_supplier.is_supplier:
                raise BusinessRuleError("Preferred contact must be a supplier.")
        for rate in (self.default_sales_tax_rate, self.default_purchase_tax_rate):
            if rate and rate.organisation_id != self.organisation_id:
                raise BusinessRuleError("Default tax rate belongs to another organisation.")

    def save(self, *args, **kwargs):
        self.currency = self.currency.upper().strip()
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.code} - {self.name}"


class Warehouse(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        INACTIVE = "inactive", "Inactive"
        ARCHIVED = "archived", "Archived"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="warehouses"
    )
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    address_line_1 = models.CharField(max_length=255, blank=True)
    address_line_2 = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=100, blank=True)
    county_state = models.CharField(max_length=100, blank=True)
    postcode = models.CharField(max_length=30, blank=True)
    country = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    is_default = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="warehouses_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code"]
        constraints = [models.UniqueConstraint(
            fields=["organisation", "code"], name="unique_warehouse_code_per_organisation"
        )]
        indexes = [models.Index(fields=["organisation", "status"])]

    def clean(self):
        if self.is_default and Warehouse.objects.filter(
            organisation_id=self.organisation_id, is_default=True,
        ).exclude(pk=self.pk).exists():
            raise BusinessRuleError("Only one default warehouse is allowed per organisation.")

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.code} - {self.name}"


class StockMovement(models.Model):
    class MovementType(models.TextChoices):
        OPENING = "opening", "Opening"
        PURCHASE_RECEIPT = "purchase_receipt", "Purchase receipt"
        SALE_ISSUE = "sale_issue", "Sale issue"
        ADJUSTMENT_IN = "adjustment_in", "Adjustment in"
        ADJUSTMENT_OUT = "adjustment_out", "Adjustment out"
        TRANSFER_IN = "transfer_in", "Transfer in"
        TRANSFER_OUT = "transfer_out", "Transfer out"
        RETURN_IN = "return_in", "Return in"
        RETURN_OUT = "return_out", "Return out"
        PRODUCTION_MATERIAL_ISSUE = "production_material_issue", "Production material issue"
        PRODUCTION_MATERIAL_RETURN = "production_material_return", "Production material return"
        PRODUCTION_COMPLETION = "production_completion", "Production completion"
        PRODUCTION_SCRAP = "production_scrap", "Production scrap"

    class SourceType(models.TextChoices):
        MANUAL = "manual", "Manual"
        PURCHASE = "purchase", "Purchase"
        SALE = "sale", "Sale"
        TRANSFER = "transfer", "Transfer"
        OPENING = "opening", "Opening"
        RETURN = "return", "Return"
        MANUFACTURING = "manufacturing", "Manufacturing"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        POSTED = "posted", "Posted"
        REVERSED = "reversed", "Reversed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="stock_movements"
    )
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="stock_movements")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="stock_movements")
    movement_date = models.DateField()
    movement_type = models.CharField(max_length=30, choices=MovementType.choices)
    quantity = models.DecimalField(max_digits=18, decimal_places=4)
    unit_cost = models.DecimalField(max_digits=24, decimal_places=8)
    total_cost = models.DecimalField(max_digits=18, decimal_places=4)
    reference = models.CharField(max_length=100, blank=True)
    description = models.TextField(blank=True)
    source_type = models.CharField(max_length=20, choices=SourceType.choices)
    source_id = models.UUIDField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    accounting_journal = models.OneToOneField(
        JournalEntry, on_delete=models.PROTECT, related_name="stock_movement",
        null=True, blank=True,
    )
    reversal_of = models.OneToOneField(
        "self", on_delete=models.PROTECT, related_name="reversal_movement",
        null=True, blank=True,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="stock_movements_created",
    )
    posted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="stock_movements_posted", null=True, blank=True,
    )
    posted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-movement_date", "-created_at"]
        constraints = [models.CheckConstraint(
            condition=models.Q(quantity__gt=0), name="stock_movement_quantity_positive"
        )]
        indexes = [
            models.Index(fields=["organisation", "product", "warehouse"]),
            models.Index(fields=["organisation", "status", "movement_date"]),
        ]

    def save(self, *args, **kwargs):
        if self.pk:
            previous = StockMovement.objects.filter(pk=self.pk).first()
            if previous and previous.status in {self.Status.POSTED, self.Status.REVERSED}:
                protected = (
                    "organisation_id", "product_id", "warehouse_id", "movement_date",
                    "movement_type", "quantity", "unit_cost", "total_cost", "reference",
                    "description", "source_type", "source_id", "accounting_journal_id",
                    "reversal_of_id",
                )
                if any(getattr(previous, field) != getattr(self, field) for field in protected):
                    raise BusinessRuleError("Posted stock movements cannot be edited.")
        self.total_cost = (self.quantity * self.unit_cost).quantize(
            COST_QUANTUM, rounding=ROUND_HALF_UP
        )
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.status != self.Status.DRAFT:
            raise BusinessRuleError("Posted stock movements cannot be deleted.")
        return super().delete(*args, **kwargs)


class InventoryCostLayer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.PROTECT, related_name="inventory_cost_layers"
    )
    product = models.ForeignKey(
        Product, on_delete=models.PROTECT, related_name="cost_layers"
    )
    warehouse = models.ForeignKey(
        Warehouse, on_delete=models.PROTECT, related_name="cost_layers"
    )
    movement = models.OneToOneField(
        StockMovement, on_delete=models.PROTECT, related_name="cost_layer",
        null=True, blank=True,
    )
    quantity_on_hand = models.DecimalField(max_digits=18, decimal_places=4)
    total_cost = models.DecimalField(max_digits=18, decimal_places=4)
    average_unit_cost = models.DecimalField(max_digits=24, decimal_places=8)
    effective_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["effective_date", "created_at", "id"]
        indexes = [
            models.Index(fields=["organisation", "product", "warehouse", "effective_date"]),
        ]

    def save(self, *args, **kwargs):
        if self.pk and InventoryCostLayer.objects.filter(pk=self.pk).exists():
            raise BusinessRuleError("Historical inventory cost layers cannot be edited.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise BusinessRuleError("Historical inventory cost layers cannot be deleted.")

    def __str__(self):
        return f"{self.product} - {self.warehouse} - {self.effective_date}"


class InventoryTransaction(models.Model):
    class TransactionType(models.TextChoices):
        PURCHASE_RECEIPT = "purchase_receipt", "Purchase receipt"
        SALES_ISSUE = "sales_issue", "Sales issue"
        TRANSFER = "transfer", "Warehouse transfer"
        CUSTOMER_RETURN = "customer_return", "Customer return"
        SUPPLIER_RETURN = "supplier_return", "Supplier return"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.PROTECT, related_name="inventory_transactions"
    )
    transaction_type = models.CharField(max_length=30, choices=TransactionType.choices)
    transaction_date = models.DateField()
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="inventory_transactions")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="inventory_transactions")
    destination_warehouse = models.ForeignKey(
        Warehouse, on_delete=models.PROTECT, related_name="incoming_inventory_transfers",
        null=True, blank=True,
    )
    quantity = models.DecimalField(max_digits=18, decimal_places=4)
    unit_cost = models.DecimalField(max_digits=24, decimal_places=8)
    reference = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    source_document_id = models.UUIDField(null=True, blank=True)
    debit_credit_account = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name="inventory_transactions",
        null=True, blank=True,
    )
    primary_movement = models.OneToOneField(
        StockMovement, on_delete=models.PROTECT, related_name="primary_inventory_transaction"
    )
    secondary_movement = models.OneToOneField(
        StockMovement, on_delete=models.PROTECT, related_name="secondary_inventory_transaction",
        null=True, blank=True,
    )
    accounting_journal = models.OneToOneField(
        JournalEntry, on_delete=models.PROTECT, related_name="inventory_transaction",
        null=True, blank=True,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="inventory_transactions_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-transaction_date", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["organisation", "transaction_type", "reference"],
                name="unique_inventory_transaction_reference",
            ),
            models.CheckConstraint(condition=models.Q(quantity__gt=0), name="inventory_transaction_quantity_positive"),
        ]

    def save(self, *args, **kwargs):
        if self.pk and InventoryTransaction.objects.filter(pk=self.pk).exists():
            raise BusinessRuleError("Posted inventory transactions cannot be edited.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise BusinessRuleError("Posted inventory transactions cannot be deleted.")


class StockCount(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        COUNTING = "counting", "Counting"
        POSTED = "posted", "Posted"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(Organisation, on_delete=models.PROTECT, related_name="stock_counts")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="stock_counts")
    count_date = models.DateField()
    reference = models.CharField(max_length=100)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    offset_account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="stock_counts")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="stock_counts_created")
    posted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-count_date", "-created_at"]
        constraints = [models.UniqueConstraint(
            fields=["organisation", "reference"], name="unique_stock_count_reference"
        )]

    def save(self, *args, **kwargs):
        if self.pk:
            previous = StockCount.objects.filter(pk=self.pk).first()
            if previous and previous.status == self.Status.POSTED:
                protected = ("organisation_id", "warehouse_id", "count_date", "reference",
                             "status", "offset_account_id", "posted_at")
                if any(getattr(previous, field) != getattr(self, field) for field in protected):
                    raise BusinessRuleError("Posted stock counts cannot be edited.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.status == self.Status.POSTED:
            raise BusinessRuleError("Posted stock counts cannot be deleted.")
        return super().delete(*args, **kwargs)


class StockCountLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    stock_count = models.ForeignKey(StockCount, on_delete=models.PROTECT, related_name="lines")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="stock_count_lines")
    expected_quantity = models.DecimalField(max_digits=18, decimal_places=4)
    counted_quantity = models.DecimalField(max_digits=18, decimal_places=4, null=True, blank=True)
    adjustment_movement = models.OneToOneField(
        StockMovement, on_delete=models.PROTECT, related_name="stock_count_line",
        null=True, blank=True,
    )

    class Meta:
        constraints = [models.UniqueConstraint(
            fields=["stock_count", "product"], name="unique_stock_count_product"
        )]

    def save(self, *args, **kwargs):
        if self.pk and self.stock_count.status == StockCount.Status.POSTED:
            raise BusinessRuleError("Posted stock count lines cannot be edited.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.stock_count.status == StockCount.Status.POSTED:
            raise BusinessRuleError("Posted stock count lines cannot be deleted.")
        return super().delete(*args, **kwargs)
