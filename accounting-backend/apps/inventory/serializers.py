"""Validate inventory relationships while exposing posted movement details read-only."""

from rest_framework import serializers

from apps.accounting.models import Account
from apps.contacts.models import Contact
from apps.tax.models import TaxRate
from apps.inventory.models import (
    InventoryTransaction,
    Product,
    StockCount,
    StockCountLine,
    StockMovement,
    Warehouse,
)


class AccountSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Account
        fields = ["id", "code", "name", "account_type", "account_class"]
        read_only_fields = fields


class ProductSerializer(serializers.ModelSerializer):
    default_sales_tax_rate_id = serializers.PrimaryKeyRelatedField(
        source="default_sales_tax_rate", queryset=TaxRate.objects.all(), required=False, allow_null=True,
    )
    default_purchase_tax_rate_id = serializers.PrimaryKeyRelatedField(
        source="default_purchase_tax_rate", queryset=TaxRate.objects.all(), required=False, allow_null=True,
    )
    inventory_asset_account_id = serializers.PrimaryKeyRelatedField(
        source="inventory_asset_account",
        queryset=Account.objects.all(),
        required=False,
        allow_null=True,
        write_only=True,
    )
    sales_account_id = serializers.PrimaryKeyRelatedField(
        source="sales_account",
        queryset=Account.objects.all(),
        required=False,
        allow_null=True,
        write_only=True,
    )
    cost_of_goods_sold_account_id = serializers.PrimaryKeyRelatedField(
        source="cost_of_goods_sold_account",
        queryset=Account.objects.all(),
        required=False,
        allow_null=True,
        write_only=True,
    )
    preferred_supplier_id = serializers.PrimaryKeyRelatedField(
        source="preferred_supplier",
        queryset=Contact.objects.all(),
        required=False,
        allow_null=True,
        write_only=True,
    )
    preferred_supplier = serializers.SerializerMethodField(read_only=True)
    accounts = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Product
        fields = [
            "id",
            "code",
            "name",
            "description",
            "product_type",
            "unit",
            "sales_price",
            "purchase_price",
            "currency",
            "track_inventory",
            "status",
            "inventory_asset_account_id",
            "sales_account_id",
            "cost_of_goods_sold_account_id",
            "minimum_quantity",
            "maximum_quantity",
            "reorder_quantity",
            "preferred_supplier_id",
            "preferred_supplier",
            "default_sales_tax_rate_id",
            "default_purchase_tax_rate_id",
            "accounts",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_preferred_supplier(self, obj):
        supplier = obj.preferred_supplier
        if supplier is None:
            return None
        return {
            "id": str(supplier.id),
            "name": supplier.name,
            "account_number": supplier.account_number,
            "status": supplier.status,
        }

    def get_accounts(self, obj):
        def summary(account):
            if account is None:
                return None
            return AccountSummarySerializer(account).data

        return {
            "inventory_asset": summary(obj.inventory_asset_account),
            "sales": summary(obj.sales_account),
            "cost_of_goods_sold": summary(obj.cost_of_goods_sold_account),
        }


class WarehouseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Warehouse
        fields = [
            "id",
            "code",
            "name",
            "description",
            "address_line_1",
            "address_line_2",
            "city",
            "county_state",
            "postcode",
            "country",
            "status",
            "is_default",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class StockMovementSerializer(serializers.ModelSerializer):
    product = serializers.SerializerMethodField(read_only=True)
    warehouse = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = StockMovement
        fields = [
            "id",
            "product",
            "warehouse",
            "movement_date",
            "movement_type",
            "quantity",
            "unit_cost",
            "total_cost",
            "reference",
            "description",
            "source_type",
            "source_id",
            "status",
            "accounting_journal",
            "reversal_of",
            "posted_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_product(self, obj):
        return {
            "id": str(obj.product_id),
            "code": obj.product.code,
            "name": obj.product.name,
        }

    def get_warehouse(self, obj):
        return {
            "id": str(obj.warehouse_id),
            "code": obj.warehouse.code,
            "name": obj.warehouse.name,
        }


class StockAdjustmentRequestSerializer(serializers.Serializer):
    product_id = serializers.UUIDField()
    warehouse_id = serializers.UUIDField()
    adjustment_date = serializers.DateField()
    adjustment_type = serializers.ChoiceField(
        choices=[
            StockMovement.MovementType.ADJUSTMENT_IN,
            StockMovement.MovementType.ADJUSTMENT_OUT,
        ]
    )
    quantity = serializers.DecimalField(
        max_digits=18, decimal_places=4, min_value=0, coerce_to_string=False
    )
    unit_cost = serializers.DecimalField(
        max_digits=24, decimal_places=8, min_value=0, coerce_to_string=False
    )
    offset_account_id = serializers.UUIDField()
    reference = serializers.CharField(required=False, allow_blank=True, max_length=100)
    description = serializers.CharField(required=False, allow_blank=True)

    def validate_quantity(self, value):
        if value <= 0:
            raise serializers.ValidationError("Quantity must be greater than zero.")
        return value


class InventoryValuationQuerySerializer(serializers.Serializer):
    product_id = serializers.UUIDField(required=False)
    warehouse_id = serializers.UUIDField(required=False)
    as_of_date = serializers.DateField(required=False)


class InventoryTransactionSerializer(serializers.ModelSerializer):
    product = serializers.SerializerMethodField(read_only=True)
    warehouse = serializers.SerializerMethodField(read_only=True)
    destination_warehouse = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = InventoryTransaction
        fields = [
            "id",
            "transaction_type",
            "transaction_date",
            "product",
            "warehouse",
            "destination_warehouse",
            "quantity",
            "unit_cost",
            "reference",
            "description",
            "source_document_id",
            "debit_credit_account",
            "primary_movement",
            "secondary_movement",
            "accounting_journal",
            "created_at",
        ]
        read_only_fields = fields

    def get_product(self, obj):
        return {
            "id": str(obj.product_id),
            "code": obj.product.code,
            "name": obj.product.name,
        }

    def get_warehouse(self, obj):
        return {
            "id": str(obj.warehouse_id),
            "code": obj.warehouse.code,
            "name": obj.warehouse.name,
        }

    def get_destination_warehouse(self, obj):
        warehouse = obj.destination_warehouse
        if warehouse is None:
            return None
        return {
            "id": str(warehouse.id),
            "code": warehouse.code,
            "name": warehouse.name,
        }


class InventoryWorkflowRequestSerializer(serializers.Serializer):
    product_id = serializers.UUIDField()
    warehouse_id = serializers.UUIDField()
    transaction_date = serializers.DateField()
    quantity = serializers.DecimalField(
        max_digits=18, decimal_places=4, min_value=0
    )
    unit_cost = serializers.DecimalField(
        max_digits=24, decimal_places=8, required=False, min_value=0
    )
    account_id = serializers.UUIDField(required=False)
    destination_warehouse_id = serializers.UUIDField(required=False)
    source_document_id = serializers.UUIDField(required=False)
    original_movement_id = serializers.UUIDField(required=False)
    reference = serializers.CharField(max_length=100)
    description = serializers.CharField(required=False, allow_blank=True)

    def validate_quantity(self, value):
        if value <= 0:
            raise serializers.ValidationError("Quantity must be greater than zero.")
        return value


class StockCountLineSerializer(serializers.ModelSerializer):
    product = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = StockCountLine
        fields = [
            "id",
            "product",
            "expected_quantity",
            "counted_quantity",
            "adjustment_movement",
        ]
        read_only_fields = fields

    def get_product(self, obj):
        return {
            "id": str(obj.product_id),
            "code": obj.product.code,
            "name": obj.product.name,
        }


class StockCountSerializer(serializers.ModelSerializer):
    lines = StockCountLineSerializer(many=True, read_only=True)

    class Meta:
        model = StockCount
        fields = [
            "id",
            "warehouse",
            "count_date",
            "reference",
            "status",
            "offset_account",
            "posted_at",
            "lines",
            "created_at",
        ]
        read_only_fields = fields


class StockCountCreateSerializer(serializers.Serializer):
    warehouse_id = serializers.UUIDField()
    count_date = serializers.DateField()
    reference = serializers.CharField(max_length=100)
    offset_account_id = serializers.UUIDField()
    product_ids = serializers.ListField(
        child=serializers.UUIDField(), allow_empty=False
    )

    def validate_product_ids(self, value):
        if len(value) != len(set(value)):
            raise serializers.ValidationError("Product IDs must be unique.")
        return value


class StockCountPostSerializer(serializers.Serializer):
    counts = serializers.DictField(
        child=serializers.DecimalField(
            max_digits=18, decimal_places=4, min_value=0
        ),
        allow_empty=False,
    )
