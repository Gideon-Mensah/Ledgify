"""Validate manufacturing inputs and keep calculated production values read-only."""

from decimal import Decimal
from rest_framework import serializers
from .models import *
class BOMComponentSerializer(serializers.ModelSerializer):
 product=serializers.SerializerMethodField()
 class Meta:model=BOMComponent;fields=["id","bom_version","component_product","product","quantity","scrap_percentage","sequence","notes","created_at","updated_at"]
 def get_product(self,x):return {"id":str(x.component_product_id),"code":x.component_product.code,"name":x.component_product.name}
class BOMVersionSerializer(serializers.ModelSerializer):
 components=BOMComponentSerializer(many=True,read_only=True)
 product_detail=serializers.SerializerMethodField()
 class Meta:model=BOMVersion;fields="__all__";read_only_fields=["created_by"]
 def get_product_detail(self,x):return {"id":str(x.bom.product_id),"code":x.bom.product.code,"name":x.bom.product.name}
class BillOfMaterialsSerializer(serializers.ModelSerializer):
 versions=BOMVersionSerializer(many=True,read_only=True);product_detail=serializers.SerializerMethodField()
 class Meta:model=BillOfMaterials;fields="__all__";read_only_fields=["organisation","created_by"]
 def get_product_detail(self,x):return {"id":str(x.product_id),"code":x.product.code,"name":x.product.name}
class ProductionOrderComponentSerializer(serializers.ModelSerializer):
 product_detail=serializers.SerializerMethodField()
 class Meta:model=ProductionOrderComponent;fields="__all__";read_only_fields=fields
 def get_product_detail(self,x):return {"id":str(x.product_id),"code":x.product.code,"name":x.product.name}
class ProductionOrderSerializer(serializers.ModelSerializer):
 components=ProductionOrderComponentSerializer(many=True,read_only=True)
 product_detail=serializers.SerializerMethodField();warehouse_detail=serializers.SerializerMethodField();bom_version_detail=serializers.SerializerMethodField()
 class Meta:model=ProductionOrder;fields="__all__";read_only_fields=["organisation","created_by","released_by","released_at","completed_at","closed_at","completed_quantity","status"]
 def get_product_detail(self,x):return {"id":str(x.product_id),"code":x.product.code,"name":x.product.name}
 def get_warehouse_detail(self,x):return {"id":str(x.warehouse_id),"code":x.warehouse.code,"name":x.warehouse.name}
 def get_bom_version_detail(self,x):return {"id":str(x.bom_version_id),"version_number":x.bom_version.version_number}
class ProductionOrderCreateSerializer(serializers.Serializer):
 order_number=serializers.CharField(max_length=50,required=False);product=serializers.UUIDField();warehouse=serializers.UUIDField();bom_version=serializers.UUIDField(required=False);planned_quantity=serializers.DecimalField(max_digits=18,decimal_places=4,min_value=Decimal("0.0001"));start_date=serializers.DateField();due_date=serializers.DateField();wip_account=serializers.UUIDField();variance_account=serializers.UUIDField(required=False,allow_null=True);reference=serializers.CharField(required=False,allow_blank=True);notes=serializers.CharField(required=False,allow_blank=True)
class MaterialIssueLineSerializer(serializers.Serializer):production_order_component_id=serializers.UUIDField();quantity=serializers.DecimalField(max_digits=18,decimal_places=4,min_value=Decimal("0.0001"))
class MaterialIssueRequestSerializer(serializers.Serializer):lines=MaterialIssueLineSerializer(many=True,allow_empty=False);issue_date=serializers.DateField();reference=serializers.CharField(required=False,allow_blank=True)
class MaterialReturnRequestSerializer(serializers.Serializer):component_id=serializers.UUIDField();quantity=serializers.DecimalField(max_digits=18,decimal_places=4,min_value=Decimal("0.0001"));return_date=serializers.DateField();reference=serializers.CharField(required=False,allow_blank=True)
class ProductionCostRequestSerializer(serializers.Serializer):
 date=serializers.DateField();amount=serializers.DecimalField(max_digits=18,decimal_places=2,min_value=Decimal("0.01"));source_account_id=serializers.UUIDField();description=serializers.CharField(required=False,allow_blank=True)
class LabourCostSerializer(ProductionCostRequestSerializer):pass
class OverheadCostSerializer(ProductionCostRequestSerializer):pass
class CompletionSerializer(serializers.Serializer):
 quantity_completed=serializers.DecimalField(max_digits=18,decimal_places=4,min_value=Decimal("0.0001"));completion_date=serializers.DateField();destination_warehouse_id=serializers.UUIDField();reference=serializers.CharField(required=False,allow_blank=True)
class CloseProductionSerializer(serializers.Serializer):close_date=serializers.DateField()
