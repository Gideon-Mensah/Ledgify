"""Validate asset values and dates while keeping depreciation results read-only."""

from rest_framework import serializers
from apps.accounting.models import Account
from apps.fixed_assets.models import DepreciationSchedule, FixedAsset, FixedAssetCategory, FixedAssetDisposal


class FixedAssetCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model=FixedAssetCategory
        exclude=["organisation","created_by"]
        read_only_fields=["id","created_at","updated_at"]


class FixedAssetSerializer(serializers.ModelSerializer):
    accumulated_depreciation=serializers.DecimalField(max_digits=18,decimal_places=2,read_only=True)
    net_book_value=serializers.DecimalField(max_digits=18,decimal_places=2,read_only=True)
    class Meta:
        model=FixedAsset
        exclude=["organisation","created_by"]
        read_only_fields=["id","status","activation_journal","created_at","updated_at"]
    def validate(self,attrs):
        cost=attrs.get("cost",getattr(self.instance,"cost",0));residual=attrs.get("residual_value",getattr(self.instance,"residual_value",0))
        if cost <= 0 or residual < 0 or residual > cost:
            raise serializers.ValidationError("Cost must be positive and residual value cannot exceed cost.")
        purchase=attrs.get("purchase_date",getattr(self.instance,"purchase_date",None));service=attrs.get("in_service_date",getattr(self.instance,"in_service_date",None))
        if purchase and service and service < purchase: raise serializers.ValidationError("In-service date cannot precede purchase date.")
        return attrs


class DepreciationScheduleSerializer(serializers.ModelSerializer):
    asset_name=serializers.CharField(source="asset.asset_name",read_only=True)
    class Meta:
        model=DepreciationSchedule
        fields=["id","asset","asset_name","period","depreciation_amount","book_value_before","book_value_after","journal","status","created_at"]
        read_only_fields=fields


class FixedAssetDisposalSerializer(serializers.ModelSerializer):
    class Meta:
        model=FixedAssetDisposal
        fields=["id","asset","disposal_date","disposal_type","proceeds","accumulated_depreciation",
                "book_value","gain_or_loss","proceeds_account","gain_account","loss_account",
                "journal","disposed_by","created_at"]
        read_only_fields=fields


class ActivateAssetSerializer(serializers.Serializer): offset_account_id=serializers.UUIDField()
class RunDepreciationSerializer(serializers.Serializer): period=serializers.DateField(); asset_id=serializers.UUIDField(required=False)
class DisposeAssetSerializer(serializers.Serializer):
    disposal_date=serializers.DateField(); disposal_type=serializers.ChoiceField(choices=FixedAssetDisposal.DisposalType.choices)
    proceeds=serializers.DecimalField(max_digits=18,decimal_places=2,min_value=0)
    proceeds_account_id=serializers.UUIDField(); gain_account_id=serializers.UUIDField(); loss_account_id=serializers.UUIDField()
