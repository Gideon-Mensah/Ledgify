"""Validate configured tax rates and expose calculated tax records safely."""

from rest_framework import serializers
from apps.tax.models import TaxPeriod, TaxRate, TaxTransaction


class TaxRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaxRate
        exclude = ["organisation", "created_by"]
        read_only_fields = ["id", "created_at", "updated_at"]


class TaxPeriodSerializer(serializers.ModelSerializer):
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

    def validate(self, attrs):
        if attrs.get("start_date") and attrs.get("end_date") and attrs["end_date"] < attrs["start_date"]:
            raise serializers.ValidationError("End date cannot precede start date.")
        return attrs
