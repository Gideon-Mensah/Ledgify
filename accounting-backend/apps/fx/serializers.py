"""Validate currency pairs and keep posted revaluation results read-only."""

from rest_framework import serializers
from apps.fx.models import Currency,ExchangeRate,FXRevaluation
class CurrencySerializer(serializers.ModelSerializer):
    class Meta:model=Currency;fields="__all__"
class ExchangeRateSerializer(serializers.ModelSerializer):
    class Meta:model=ExchangeRate;exclude=["organisation"];read_only_fields=["id","created_at"]
class FXRevaluationSerializer(serializers.ModelSerializer):
    class Meta:model=FXRevaluation;fields="__all__";read_only_fields=fields
class RevaluationSerializer(serializers.Serializer):
    revaluation_type=serializers.ChoiceField(choices=FXRevaluation.Type.choices);as_of_date=serializers.DateField();foreign_currency=serializers.CharField(max_length=3);source_reference=serializers.CharField(max_length=100,default="aggregate");foreign_amount=serializers.DecimalField(max_digits=18,decimal_places=2);old_base_amount=serializers.DecimalField(max_digits=18,decimal_places=2);control_account_id=serializers.UUIDField();gain_account_id=serializers.UUIDField();loss_account_id=serializers.UUIDField()
class ReversalSerializer(serializers.Serializer):
    reversal_date=serializers.DateField(required=False)
