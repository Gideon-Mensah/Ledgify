"""Validate purchase payloads and return safe nested supplier and account summaries."""

from decimal import Decimal

from rest_framework import serializers

from apps.accounting.models import Account
from apps.tax.models import TaxRate
from apps.contacts.models import Contact
from apps.inventory.models import InventoryTransaction

from .models import (
    Bill,
    BillLine,
    SupplierCredit,
    SupplierCreditAllocation,
    SupplierCreditLine,
    SupplierRefund,
    SupplierPayment,
    PurchaseOrder, PurchaseOrderLine,
)
from .services.credits import create_supplier_credit
from .services.refunds import create_supplier_refund
from .services.bills import create_bill, update_bill
from .services.payments import (
    create_supplier_payment,
)
from .services.commercial import create_purchase_order
from apps.inventory.models import Product


class PurchaseOrderLineSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    product_id = serializers.PrimaryKeyRelatedField(source="product", queryset=Product.objects.all(), required=False, allow_null=True)
    description = serializers.CharField(max_length=255)
    quantity = serializers.DecimalField(max_digits=18, decimal_places=4, min_value=Decimal("0.0001"))
    quantity_received = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    quantity_billed = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    unit_price = serializers.DecimalField(max_digits=18, decimal_places=4, min_value=0)
    discount_amount = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=0, required=False, default=0)
    tax_rate = serializers.DecimalField(max_digits=7, decimal_places=4, min_value=0, required=False, default=0)
    line_total = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)
    expense_account_id = serializers.PrimaryKeyRelatedField(source="expense_account", queryset=Account.objects.all(), required=False, allow_null=True)


class PurchaseOrderSerializer(serializers.ModelSerializer):
    supplier_id = serializers.PrimaryKeyRelatedField(source="supplier", queryset=Contact.objects.all())
    lines = PurchaseOrderLineSerializer(many=True)
    class Meta:
        model=PurchaseOrder
        fields=["id", "purchase_order_number", "supplier_id", "order_date",
                "expected_delivery_date", "currency", "supplier_reference", "notes",
                "status", "subtotal", "tax_total", "total", "bill", "approved_by",
                "approved_at", "lines", "created_at", "updated_at"]
        read_only_fields=["id", "status", "subtotal", "tax_total", "total", "bill",
                          "approved_by", "approved_at", "created_at", "updated_at"]
    def create(self, validated_data):
        return create_purchase_order(organisation=self.context["organisation"],
            user=self.context["request"].user, lines=validated_data.pop("lines"), **validated_data)


class ReceivePurchaseOrderSerializer(serializers.Serializer):
    line_id = serializers.UUIDField(); warehouse_id = serializers.UUIDField()
    quantity = serializers.DecimalField(max_digits=18, decimal_places=4, min_value=Decimal("0.0001"))
    transaction_date = serializers.DateField(); grni_account_id = serializers.UUIDField()


class ConvertPurchaseOrderSerializer(serializers.Serializer):
    bill_number = serializers.CharField(max_length=50)
    issue_date = serializers.DateField(); due_date = serializers.DateField()


class BillLineSerializer(serializers.ModelSerializer):
    tax_inclusive = serializers.BooleanField(write_only=True, required=False, default=False)
    tax_rate_id = serializers.PrimaryKeyRelatedField(
        source="tax_rate_config", queryset=TaxRate.objects.all(), required=False, allow_null=True,
    )
    expense_account_id = serializers.PrimaryKeyRelatedField(
        source="expense_account",
        queryset=Account.objects.all(),
        write_only=True,
    )

    expense_account = serializers.SerializerMethodField(
        read_only=True,
    )
    inventory_receipt_id = serializers.PrimaryKeyRelatedField(
        source="inventory_receipt",
        queryset=InventoryTransaction.objects.filter(
            transaction_type=InventoryTransaction.TransactionType.PURCHASE_RECEIPT,
        ),
        write_only=True,
        required=False,
        allow_null=True,
    )

    class Meta:
        model = BillLine
        fields = [
            "id",
            "description",
            "quantity",
            "unit_price",
            "discount_amount",
            "tax_rate",
            "tax_rate_id",
            "tax_inclusive",
            "tax_amount",
            "line_total",
            "expense_account_id",
            "expense_account",
            "inventory_receipt_id",
        ]

        read_only_fields = [
            "id",
            "tax_amount",
            "line_total",
        ]

    def get_expense_account(self, obj):
        return {
            "id": str(obj.expense_account_id),
            "code": obj.expense_account.code,
            "name": obj.expense_account.name,
        }


class BillSerializer(serializers.ModelSerializer):
    supplier_id = serializers.PrimaryKeyRelatedField(
        source="supplier",
        queryset=Contact.objects.all(),
        write_only=True,
    )

    supplier = serializers.SerializerMethodField(
        read_only=True,
    )

    lines = BillLineSerializer(
        many=True,
    )

    amount_due = serializers.DecimalField(
        max_digits=18,
        decimal_places=2,
        read_only=True,
    )

    class Meta:
        model = Bill
        fields = [
            "id",
            "bill_number",
            "supplier_id",
            "supplier",
            "supplier_reference",
            "issue_date",
            "due_date",
            "currency",
            "notes",
            "subtotal",
            "tax_total",
            "total",
            "amount_paid",
            "amount_credited",
            "amount_due",
            "status",
            "approved_at",
            "approved_by",
            "accounting_journal",
            "lines",
            "created_at",
            "updated_at",
        ]

        read_only_fields = [
            "id",
            "subtotal",
            "tax_total",
            "total",
            "amount_paid",
            "amount_credited",
            "amount_due",
            "status",
            "approved_at",
            "approved_by",
            "accounting_journal",
            "created_at",
            "updated_at",
        ]

    def get_supplier(self, obj):
        return {
            "id": str(obj.supplier_id),
            "name": obj.supplier.name,
            "account_number": obj.supplier.account_number,
            "email": obj.supplier.email,
        }

    def create(self, validated_data):
        organisation = self.context.get(
            "organisation"
        )

        request = self.context.get(
            "request"
        )

        if organisation is None:
            raise serializers.ValidationError(
                "Organisation context is missing."
            )

        if request is None:
            raise serializers.ValidationError(
                "Request context is missing."
            )

        lines = validated_data.pop(
            "lines"
        )

        supplier = validated_data.pop(
            "supplier"
        )

        return create_bill(
            organisation=organisation,
            supplier=supplier,
            lines=lines,
            user=request.user,
            **validated_data,
        )

    def update(self, instance, validated_data):
        organisation = self.context.get("organisation")
        if organisation is None:
            raise serializers.ValidationError("Organisation context is missing.")
        lines = validated_data.pop("lines", None)
        supplier = validated_data.pop("supplier", instance.supplier)
        if lines is None:
            lines = [
                {
                    "description": line.description,
                    "quantity": line.quantity,
                    "unit_price": line.unit_price,
                    "discount_amount": line.discount_amount,
                    "tax_rate": line.tax_rate,
                    "tax_rate_config": line.tax_rate_config,
                    "expense_account": line.expense_account,
                    "inventory_receipt": line.inventory_receipt,
                }
                for line in instance.lines.select_related("expense_account", "tax_rate_config", "inventory_receipt")
            ]
        values = {
            "bill_number": instance.bill_number,
            "supplier_reference": instance.supplier_reference,
            "issue_date": instance.issue_date,
            "due_date": instance.due_date,
            "currency": instance.currency,
            "notes": instance.notes,
            **validated_data,
        }
        return update_bill(bill=instance, organisation=organisation, supplier=supplier, lines=lines, **values)
        
        
class SupplierPaymentSerializer(serializers.ModelSerializer):
    supplier_id = serializers.PrimaryKeyRelatedField(
        source="supplier", queryset=Contact.objects.all(), write_only=True
    )
    bill_id = serializers.PrimaryKeyRelatedField(
        source="bill",
        queryset=Bill.objects.all(),
        write_only=True, required=False, allow_null=True,
    )

    bank_account_id = serializers.PrimaryKeyRelatedField(
        source="bank_account",
        queryset=Account.objects.all(),
        write_only=True,
    )

    bill = serializers.SerializerMethodField(
        read_only=True,
    )

    bank_account = serializers.SerializerMethodField(
        read_only=True,
    )

    accounting_journal = serializers.PrimaryKeyRelatedField(
        read_only=True,
    )
    amount_allocated = serializers.DecimalField(
        max_digits=18, decimal_places=2, read_only=True
    )
    amount_unallocated = serializers.DecimalField(
        max_digits=18, decimal_places=2, read_only=True
    )
    allocations = serializers.SerializerMethodField()

    class Meta:
        model = SupplierPayment
        fields = [
            "id",
            "supplier_id",
            "bill_id",
            "bill",
            "bank_account_id",
            "bank_account",
            "payment_date",
            "amount",
            "amount_allocated",
            "amount_unallocated",
            "allocations",
            "currency",
            "reference",
            "notes",
            "status",
            "accounting_journal",
            "created_at",
            "updated_at",
        ]

        read_only_fields = [
            "id",
            "status",
            "accounting_journal",
            "created_at",
            "updated_at",
        ]

    def get_bill(self, obj):
        if obj.bill_id is None:
            return None
        return {
            "id": str(obj.bill_id),
            "bill_number": obj.bill.bill_number,
            "supplier": obj.bill.supplier.name,
            "total": str(obj.bill.total),
            "amount_paid": str(obj.bill.amount_paid),
            "amount_due": str(obj.bill.amount_due),
            "status": obj.bill.status,
        }

    def get_bank_account(self, obj):
        return {
            "id": str(obj.bank_account_id),
            "code": obj.bank_account.code,
            "name": obj.bank_account.name,
        }

    def create(self, validated_data):
        organisation = self.context.get("organisation")
        request = self.context.get("request")

        if organisation is None:
            raise serializers.ValidationError(
                "Organisation context is missing."
            )

        if request is None:
            raise serializers.ValidationError(
                "Request context is missing."
            )

        bill = validated_data.pop("bill", None)
        supplier = validated_data.pop("supplier")
        bank_account = validated_data.pop("bank_account")

        return create_supplier_payment(
            organisation=organisation,
            bill=bill,
            supplier=supplier,
            bank_account=bank_account,
            user=request.user,
            **validated_data,
        )

    def get_allocations(self, obj):
        return [
            {
                "id": str(item.id),
                "bill_id": str(item.bill_id),
                "amount": item.amount,
                "allocated_at": item.allocated_at,
            }
            for item in obj.allocations.filter(
                status="active",
            )
        ]


class SupplierCreditLineSerializer(serializers.ModelSerializer):
    source_line_id = serializers.UUIDField(write_only=True, required=False)
    tax_inclusive = serializers.BooleanField(write_only=True, required=False, default=False)
    tax_rate_id = serializers.PrimaryKeyRelatedField(
        source="tax_rate_config", queryset=TaxRate.objects.all(), required=False, allow_null=True,
    )
    expense_account_id = serializers.PrimaryKeyRelatedField(
        source="expense_account", queryset=Account.objects.all(), write_only=True
    )

    class Meta:
        model = SupplierCreditLine
        fields = ["id", "description", "quantity", "unit_price", "discount_amount",
                  "tax_rate", "tax_rate_id", "source_line_id", "tax_inclusive", "tax_amount", "line_total", "expense_account_id"]
        read_only_fields = ["id", "tax_amount", "line_total"]


class SupplierCreditSerializer(serializers.ModelSerializer):
    supplier_id = serializers.PrimaryKeyRelatedField(
        source="supplier", queryset=Contact.objects.all(), write_only=True
    )
    bill_id = serializers.PrimaryKeyRelatedField(
        source="bill", queryset=Bill.objects.all(), write_only=True,
        required=False, allow_null=True,
    )
    lines = SupplierCreditLineSerializer(many=True)
    available_credit = serializers.DecimalField(
        max_digits=18, decimal_places=2, read_only=True
    )
    supplier = serializers.SerializerMethodField(read_only=True)
    bill = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = SupplierCredit
        fields = ["id", "credit_number", "supplier_id", "supplier", "bill_id", "bill", "issue_date",
                  "currency", "reference", "notes", "subtotal", "tax_total", "total",
                  "amount_applied", "amount_refunded", "available_credit", "status", "accounting_journal",
                  "approved_at", "approved_by", "lines", "created_at", "updated_at"]
        read_only_fields = ["id", "subtotal", "tax_total", "total", "amount_applied", "amount_refunded",
                            "status", "approved_at", "approved_by", "accounting_journal",
                            "created_at", "updated_at"]

    def get_supplier(self, obj):
        return {"id": str(obj.supplier_id), "name": obj.supplier.name}

    def get_bill(self, obj):
        if not obj.bill_id:
            return None
        return {"id": str(obj.bill_id), "bill_number": obj.bill.bill_number}

    def create(self, validated_data):
        lines = validated_data.pop("lines")
        return create_supplier_credit(
            organisation=self.context["organisation"], user=self.context["request"].user,
            lines=lines, **validated_data,
        )


class SupplierCreditAllocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierCreditAllocation
        fields = ["id", "bill", "amount", "applied_at", "applied_by"]
        read_only_fields = ["id", "applied_at", "applied_by"]


class ApplySupplierCreditSerializer(serializers.Serializer):
    bill_id = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=18, decimal_places=2)


class SupplierPaymentAllocationRequestSerializer(serializers.Serializer):
    bill_id = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=18, decimal_places=2)


class SupplierRefundSerializer(serializers.ModelSerializer):
    supplier_id = serializers.PrimaryKeyRelatedField(
        source="supplier", queryset=Contact.objects.all(), write_only=True
    )
    supplier_credit_id = serializers.PrimaryKeyRelatedField(
        source="supplier_credit", queryset=SupplierCredit.objects.all(),
        write_only=True,
    )
    bank_account_id = serializers.PrimaryKeyRelatedField(
        source="bank_account", queryset=Account.objects.all(), write_only=True
    )

    class Meta:
        model = SupplierRefund
        fields = [
            "id", "supplier_id", "supplier_credit_id", "bank_account_id",
            "refund_date", "amount", "currency", "reference", "notes",
            "status", "accounting_journal", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "status", "accounting_journal", "created_at", "updated_at",
        ]

    def create(self, validated_data):
        return create_supplier_refund(
            organisation=self.context["organisation"],
            user=self.context["request"].user,
            **validated_data,
        )
