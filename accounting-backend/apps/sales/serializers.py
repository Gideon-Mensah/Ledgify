"""Translate sales API payloads and call services for financial workflow changes."""

from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from apps.accounting.models import Account
from apps.tax.models import TaxRate
from apps.contacts.models import Contact

from .models import (
    CustomerCreditAllocation,
    CustomerCreditNote,
    CustomerCreditNoteLine,
    CustomerRefund,
    BadDebtWriteOff,
    Invoice,
    InvoiceLine,
    Quote, QuoteLine, SalesOrder, SalesOrderLine,
)
from .services.credit_notes import create_customer_credit_note
from .services.refunds import create_customer_refund
from .services.write_offs import create_bad_debt_write_off
from .services.invoices import create_invoice
from apps.accounting.models import Account
from .models import CustomerPayment
from .services.payments import create_customer_payment
from .services.commercial import create_quote, create_sales_order
from apps.inventory.models import Product
from apps.sales.services.invoices.helpers import money
from apps.tax.services.calculation_service import calculate_tax
from apps.fx.services import convert_amount
from apps.date_fields import accounting_date


class CommercialSalesLineSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    product_id = serializers.PrimaryKeyRelatedField(source="product", queryset=Product.objects.all(), required=False, allow_null=True)
    description = serializers.CharField(max_length=255)
    quantity = serializers.DecimalField(max_digits=18, decimal_places=4, min_value=Decimal("0.0001"))
    quantity_fulfilled = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    unit_price = serializers.DecimalField(max_digits=18, decimal_places=4, min_value=0)
    discount_amount = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=0, required=False, default=0)
    tax_rate = serializers.DecimalField(max_digits=7, decimal_places=4, min_value=0, required=False, default=0)
    line_total = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)
    revenue_account_id = serializers.PrimaryKeyRelatedField(source="revenue_account", queryset=Account.objects.all())


class QuoteSerializer(serializers.ModelSerializer):
    issue_date = accounting_date("quote date")
    expiry_date = accounting_date("quote expiry date")
    customer_id = serializers.PrimaryKeyRelatedField(source="customer", queryset=Contact.objects.all())
    lines = CommercialSalesLineSerializer(many=True)
    class Meta:
        model=Quote
        fields=["id", "quote_number", "customer_id", "issue_date", "expiry_date", "currency",
                "reference", "notes", "subtotal", "tax_total", "total", "status",
                "accepted_at", "accepted_by", "converted_invoice", "lines", "created_at", "updated_at"]
        read_only_fields=["id", "subtotal", "tax_total", "total", "status", "accepted_at",
                          "accepted_by", "converted_invoice", "created_at", "updated_at"]
    def create(self, validated_data):
        return create_quote(organisation=self.context["organisation"], user=self.context["request"].user,
                            lines=validated_data.pop("lines"), **validated_data)


class SalesOrderSerializer(serializers.ModelSerializer):
    order_date = accounting_date("sales order date")
    expected_delivery_date = accounting_date("expected delivery date", required=False, allow_null=True)
    customer_id = serializers.PrimaryKeyRelatedField(source="customer", queryset=Contact.objects.all())
    quote_id = serializers.PrimaryKeyRelatedField(source="quote", queryset=Quote.objects.all(), required=False, allow_null=True)
    lines = CommercialSalesLineSerializer(many=True)
    class Meta:
        model=SalesOrder
        fields=["id", "order_number", "customer_id", "order_date", "expected_delivery_date",
                "currency", "reference", "notes", "status", "subtotal", "tax_total", "total",
                "quote_id", "invoice", "approved_by", "approved_at", "lines", "created_at", "updated_at"]
        read_only_fields=["id", "status", "subtotal", "tax_total", "total", "invoice",
                          "approved_by", "approved_at", "created_at", "updated_at"]
    def create(self, validated_data):
        return create_sales_order(organisation=self.context["organisation"], user=self.context["request"].user,
                                  lines=validated_data.pop("lines"), **validated_data)


class DocumentConversionSerializer(serializers.Serializer):
    document_number = serializers.CharField(max_length=50)
    issue_date = accounting_date("invoice date")
    due_date = accounting_date("invoice due date")


class FulfilSalesOrderSerializer(serializers.Serializer):
    line_id = serializers.UUIDField()
    warehouse_id = serializers.UUIDField()
    quantity = serializers.DecimalField(max_digits=18, decimal_places=4, min_value=Decimal("0.0001"))
    transaction_date = accounting_date("fulfilment date")


class InvoiceLineSerializer(serializers.ModelSerializer):
    tax_inclusive = serializers.BooleanField(write_only=True, required=False, default=False)
    tax_rate_id = serializers.PrimaryKeyRelatedField(
        source="tax_rate_config", queryset=TaxRate.objects.all(), required=False, allow_null=True,
    )
    revenue_account_id = serializers.PrimaryKeyRelatedField(
        source="revenue_account",
        queryset=Account.objects.all(),
        write_only=True,
    )

    revenue_account = serializers.SerializerMethodField(
        read_only=True,
    )

    class Meta:
        model = InvoiceLine
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
            "revenue_account_id",
            "revenue_account",
        ]

        read_only_fields = [
            "id",
            "tax_amount",
            "line_total",
        ]

    def get_revenue_account(self, obj):
        return {
            "id": str(obj.revenue_account_id),
            "code": obj.revenue_account.code,
            "name": obj.revenue_account.name,
        }


class InvoiceSerializer(serializers.ModelSerializer):
    issue_date = accounting_date("invoice date")
    due_date = accounting_date("invoice due date")
    customer_id = serializers.PrimaryKeyRelatedField(
        source="customer",
        queryset=Contact.objects.all(),
        write_only=True,
    )

    customer = serializers.SerializerMethodField(
        read_only=True,
    )

    lines = InvoiceLineSerializer(
        many=True,
    )

    amount_due = serializers.DecimalField(
        max_digits=18,
        decimal_places=2,
        read_only=True,
    )

    def validate(self, attrs):
        issue_date = attrs.get("issue_date", getattr(self.instance, "issue_date", None))
        due_date = attrs.get("due_date", getattr(self.instance, "due_date", None))
        if issue_date and due_date and due_date < issue_date:
            raise serializers.ValidationError({"due_date": "Invoice due date cannot be before the invoice date."})
        return attrs

    class Meta:
        model = Invoice
        fields = [
            "id",
            "invoice_number",
            "customer_id",
            "customer",
            "issue_date",
            "due_date",
            "currency",
            "reference",
            "notes",
            "subtotal",
            "tax_total",
            "total",
            "amount_paid",
            "amount_credited",
            "amount_written_off",
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
            "amount_written_off",
            "amount_due",
            "status",
            "approved_at",
            "approved_by",
            "accounting_journal",
            "created_at",
            "updated_at",
        ]

    def get_customer(self, obj):
        return {
            "id": str(obj.customer_id),
            "name": obj.customer.name,
            "account_number": obj.customer.account_number,
            "email": obj.customer.email,
        }

    def create(self, validated_data):
        lines = validated_data.pop("lines")
        customer = validated_data.pop("customer")

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

        return create_invoice(
            organisation=organisation,
            customer=customer,
            lines=lines,
            user=request.user,
            **validated_data,
        )

    @transaction.atomic
    def update(self, instance, validated_data):
        if instance.status != Invoice.Status.DRAFT:
            raise serializers.ValidationError(
                "Only draft invoices can be edited. Use a credit note or another correction workflow."
            )
        organisation = self.context.get("organisation")
        customer = validated_data.pop("customer", instance.customer)
        lines = validated_data.pop("lines", None)
        if customer.organisation_id != organisation.id:
            raise serializers.ValidationError("Customer does not belong to this organisation.")
        if lines is not None:
            for line in lines:
                account = line.get("revenue_account")
                tax_rate = line.get("tax_rate_config")
                if account.organisation_id != organisation.id or account.account_type != Account.AccountType.REVENUE:
                    raise serializers.ValidationError("Each revenue account must be an active revenue account in this organisation.")
                if account.status != Account.Status.ACTIVE:
                    raise serializers.ValidationError("Each revenue account must be active.")
                if tax_rate is not None and tax_rate.organisation_id != organisation.id:
                    raise serializers.ValidationError("Tax rate does not belong to this organisation.")
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.customer = customer
        instance.save()
        if lines is not None:
            instance.lines.all().delete()
            subtotal = Decimal("0")
            tax_total = Decimal("0")
            grand_total = Decimal("0")
            for line in lines:
                quantity = line["quantity"]
                unit_price = line["unit_price"]
                discount_amount = line.get("discount_amount", Decimal("0"))
                tax_rate = line.get("tax_rate", Decimal("0"))
                calculated = calculate_tax(quantity=quantity, unit_price=unit_price, discount=discount_amount,
                                           tax_rate=tax_rate, tax_inclusive=bool(line.get("tax_inclusive", False)))
                net_amount, tax_amount, line_total = calculated.values()
                InvoiceLine.objects.create(
                    invoice=instance, description=line["description"], quantity=quantity,
                    unit_price=unit_price, discount_amount=discount_amount, tax_rate=tax_rate,
                    tax_rate_config=line.get("tax_rate_config"), tax_amount=tax_amount,
                    line_total=line_total, revenue_account=line["revenue_account"],
                )
                subtotal += net_amount
                tax_total += tax_amount
                grand_total += line_total
            instance.subtotal = money(subtotal)
            instance.tax_total = money(tax_total)
            instance.total = money(grand_total)
            instance.base_currency_amount = convert_amount(amount=instance.total, rate=instance.exchange_rate)
            instance.save(update_fields=["subtotal", "tax_total", "total", "base_currency_amount", "updated_at"])
        instance.refresh_from_db()
        return instance
        
class CustomerPaymentSerializer(serializers.ModelSerializer):
    payment_date = accounting_date("payment date")
    customer_id = serializers.PrimaryKeyRelatedField(
        source="customer", queryset=Contact.objects.all(), write_only=True
    )
    invoice_id = serializers.PrimaryKeyRelatedField(
        source="invoice",
        queryset=Invoice.objects.all(),
        write_only=True, required=False, allow_null=True,
    )

    bank_account_id = serializers.PrimaryKeyRelatedField(
        source="bank_account",
        queryset=Account.objects.all(),
        write_only=True,
    )

    invoice = serializers.SerializerMethodField(
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
        model = CustomerPayment
        fields = [
            "id",
            "customer_id",
            "invoice_id",
            "invoice",
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

    def get_invoice(self, obj):
        if obj.invoice_id is None:
            return None
        return {
            "id": str(obj.invoice_id),
            "invoice_number": obj.invoice.invoice_number,
            "customer": obj.invoice.customer.name,
            "total": str(obj.invoice.total),
            "amount_paid": str(obj.invoice.amount_paid),
            "amount_due": str(obj.invoice.amount_due),
            "status": obj.invoice.status,
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

        invoice = validated_data.pop("invoice", None)
        customer = validated_data.pop("customer")
        bank_account = validated_data.pop("bank_account")

        return create_customer_payment(
            organisation=organisation,
            invoice=invoice,
            customer=customer,
            bank_account=bank_account,
            user=request.user,
            **validated_data,
        )

    def get_allocations(self, obj):
        return [
            {
                "id": str(item.id),
                "invoice_id": str(item.invoice_id),
                "amount": item.amount,
                "allocated_at": item.allocated_at,
            }
            for item in obj.allocations.filter(
                status="active",
            )
        ]


class CustomerCreditNoteLineSerializer(serializers.ModelSerializer):
    source_line_id = serializers.UUIDField(write_only=True, required=False)
    tax_inclusive = serializers.BooleanField(write_only=True, required=False, default=False)
    tax_rate_id = serializers.PrimaryKeyRelatedField(
        source="tax_rate_config", queryset=TaxRate.objects.all(), required=False, allow_null=True,
    )
    revenue_account_id = serializers.PrimaryKeyRelatedField(
        source="revenue_account", queryset=Account.objects.all(), write_only=True
    )

    class Meta:
        model = CustomerCreditNoteLine
        fields = ["id", "description", "quantity", "unit_price", "discount_amount",
                  "tax_rate", "tax_rate_id", "source_line_id", "tax_inclusive", "tax_amount", "line_total", "revenue_account_id"]
        read_only_fields = ["id", "tax_amount", "line_total"]


class CustomerCreditNoteSerializer(serializers.ModelSerializer):
    customer_id = serializers.PrimaryKeyRelatedField(
        source="customer", queryset=Contact.objects.all(), write_only=True
    )
    invoice_id = serializers.PrimaryKeyRelatedField(
        source="invoice", queryset=Invoice.objects.all(), write_only=True,
        required=False, allow_null=True,
    )
    lines = CustomerCreditNoteLineSerializer(many=True)
    available_credit = serializers.DecimalField(
        max_digits=18, decimal_places=2, read_only=True
    )
    customer = serializers.SerializerMethodField(read_only=True)
    invoice = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = CustomerCreditNote
        fields = ["id", "credit_note_number", "customer_id", "customer", "invoice_id", "invoice",
                  "issue_date", "currency", "reference", "notes", "subtotal",
                  "tax_total", "total", "amount_applied", "amount_refunded", "available_credit",
                  "status", "approved_at", "approved_by", "accounting_journal",
                  "lines", "created_at", "updated_at"]
        read_only_fields = ["id", "subtotal", "tax_total", "total", "amount_applied", "amount_refunded",
                            "status", "approved_at", "approved_by", "accounting_journal",
                            "created_at", "updated_at"]

    def get_customer(self, obj):
        return {"id": str(obj.customer_id), "name": obj.customer.name}

    def get_invoice(self, obj):
        if not obj.invoice_id:
            return None
        return {"id": str(obj.invoice_id), "invoice_number": obj.invoice.invoice_number}

    def create(self, validated_data):
        lines = validated_data.pop("lines")
        return create_customer_credit_note(
            organisation=self.context["organisation"], user=self.context["request"].user,
            lines=lines, **validated_data,
        )


class CustomerCreditAllocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerCreditAllocation
        fields = ["id", "invoice", "amount", "applied_at", "applied_by"]
        read_only_fields = ["id", "applied_at", "applied_by"]


class ApplyCustomerCreditSerializer(serializers.Serializer):
    invoice_id = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=18, decimal_places=2)


class CustomerPaymentAllocationRequestSerializer(serializers.Serializer):
    invoice_id = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=18, decimal_places=2)


class CustomerRefundSerializer(serializers.ModelSerializer):
    customer_id = serializers.PrimaryKeyRelatedField(
        source="customer", queryset=Contact.objects.all(), write_only=True
    )
    credit_note_id = serializers.PrimaryKeyRelatedField(
        source="credit_note", queryset=CustomerCreditNote.objects.all(),
        write_only=True, required=False, allow_null=True,
    )
    bank_account_id = serializers.PrimaryKeyRelatedField(
        source="bank_account", queryset=Account.objects.all(), write_only=True
    )

    class Meta:
        model = CustomerRefund
        fields = ["id", "customer_id", "credit_note_id", "bank_account_id",
                  "refund_date", "amount", "currency", "reference", "notes",
                  "status", "accounting_journal", "created_at", "updated_at"]
        read_only_fields = ["id", "status", "accounting_journal", "created_at", "updated_at"]

    def create(self, validated_data):
        return create_customer_refund(
            organisation=self.context["organisation"],
            user=self.context["request"].user, **validated_data,
        )


class BadDebtWriteOffSerializer(serializers.ModelSerializer):
    invoice_id = serializers.PrimaryKeyRelatedField(
        source="invoice", queryset=Invoice.objects.all(), write_only=True
    )
    bad_debt_account_id = serializers.PrimaryKeyRelatedField(
        source="bad_debt_account", queryset=Account.objects.all(), write_only=True
    )

    class Meta:
        model = BadDebtWriteOff
        fields = ["id", "invoice_id", "write_off_date", "amount", "reason",
                  "reference", "bad_debt_account_id", "status",
                  "accounting_journal", "created_at", "updated_at"]
        read_only_fields = ["id", "status", "accounting_journal", "created_at", "updated_at"]

    def create(self, validated_data):
        return create_bad_debt_write_off(
            organisation=self.context["organisation"],
            user=self.context["request"].user, **validated_data,
        )
