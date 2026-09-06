"""Validate configured tax rates and expose calculated tax records safely."""

from rest_framework import serializers
from apps.tax.models import TaxPeriod, TaxRate, TaxTransaction


class TaxRateSerializer(serializers.ModelSerializer):
    in_use = serializers.SerializerMethodField()
    default_usage = serializers.SerializerMethodField()

    def get_default_usage(self, obj):
        from apps.inventory.models import Product
        products = Product.objects.filter(organisation=obj.organisation)
        return {"sales_products": products.filter(default_sales_tax_rate=obj).count(),
                "purchase_products": products.filter(default_purchase_tax_rate=obj).count()}


    def get_in_use(self, obj):
        return any(relation.related_model.objects.filter(**{relation.field.name: obj}).exists()
                   for relation in obj._meta.related_objects)

    def validate(self, attrs):
        from decimal import Decimal
        rate = attrs.get("rate", getattr(self.instance, "rate", None))
        if rate is not None and not Decimal("0") <= rate <= Decimal("100"):
            raise serializers.ValidationError({"rate": "Enter a percentage between 0 and 100."})
        start = attrs.get("effective_from", getattr(self.instance, "effective_from", None))
        end = attrs.get("effective_to", getattr(self.instance, "effective_to", None))
        if start and end and end < start:
            raise serializers.ValidationError({"effective_to": "End date cannot precede the start date."})
        organisation = self.context["organisation"]
        for key in ("input_tax_account", "output_tax_account"):
            account = attrs.get(key)
            if account and account.organisation_id != organisation.id:
                raise serializers.ValidationError({key: "Select an account in this organisation."})
        code = attrs.get("code", getattr(self.instance, "code", "")).strip().upper()
        matches = TaxRate.objects.filter(organisation=organisation, code=code)
        if self.instance: matches = matches.exclude(pk=self.instance.pk)
        if matches.exists(): raise serializers.ValidationError({"code": "This tax code is already in use."})
        if "code" in attrs: attrs["code"] = code
        return attrs

    class Meta:
        model = TaxRate
        exclude = ["organisation", "created_by"]
        read_only_fields = ["id", "created_at", "updated_at"]


class TaxPeriodSerializer(serializers.ModelSerializer):
    def validate(self, attrs):
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and end < start:
            raise serializers.ValidationError({"end_date": "End date cannot precede the start date."})
        return attrs

    class Meta:
        model = TaxPeriod
        exclude = ["organisation", "filed_by", "filed_at"]
        read_only_fields = ["id", "status", "created_at"]


class TaxTransactionSerializer(serializers.ModelSerializer):
    tax_rate_code = serializers.CharField(source="tax_rate.code", read_only=True)
    class Meta:
        model = TaxTransaction
        fields = "__all__"
        read_only_fields = fields


class TaxReportQuerySerializer(serializers.Serializer):
    start_date = serializers.DateField(required=False)
    end_date = serializers.DateField(required=False)
    tax_rate = serializers.UUIDField(required=False)
    direction = serializers.ChoiceField(choices=TaxTransaction.Direction.choices, required=False)
    status = serializers.ChoiceField(choices=TaxTransaction.Status.choices, required=False)

    source_type = serializers.ChoiceField(choices=["invoice", "bill", "customer_credit", "supplier_credit", "manual_adjustment"], required=False)
    search = serializers.CharField(required=False, max_length=150, allow_blank=True)
    inclusion = serializers.ChoiceField(choices=["included", "excluded", "awaiting"], required=False)
    adjustments_only = serializers.BooleanField(required=False)
    reversed_only = serializers.BooleanField(required=False)
    ordering = serializers.ChoiceField(choices=[prefix + key for prefix in ("", "-") for key in ("transaction_date", "document_number", "contact_name", "tax_amount", "net_amount", "gross_amount")], required=False)

    def validate(self, attrs):
        if attrs.get("start_date") and attrs.get("end_date") and attrs["end_date"] < attrs["start_date"]:
            raise serializers.ValidationError("End date cannot precede start date.")
        return attrs
