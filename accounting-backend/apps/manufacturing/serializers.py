"""Validate manufacturing inputs and keep calculated production values read-only."""

from decimal import Decimal
from rest_framework import serializers
from .models import *
class ScopedRelationships(serializers.ModelSerializer):
 def to_representation(self, instance):
  from .security import check_owned, check_version, check_order
  view=self.context.get("view")
  org=view.get_organisation() if view else self.context.get("organisation")
  if not org: raise serializers.ValidationError("Organisation context is required.")
  if isinstance(instance,ProductionOrder):check_order(org,instance)
  elif isinstance(instance,BOMVersion):check_version(org,instance)
  elif isinstance(instance,BOMComponent):check_owned(org,instance.bom_version.bom,instance.component_product)
  elif isinstance(instance,BillOfMaterials):
   check_owned(org,instance,instance.product)
   for version in instance.versions.all():check_version(org,version)
  return super().to_representation(instance)

 def validate(self, attrs):
  view=self.context.get("view")
  org=view.get_organisation() if view else self.context.get("organisation")
  if not org: raise serializers.ValidationError("Organisation context is required.")
  immutable=("organisation", "bom") if isinstance(self.instance,BOMVersion) else ("organisation", "bom_version") if isinstance(self.instance,BOMComponent) else ("organisation",)
  for field in immutable:
   if self.instance and field in self.initial_data and hasattr(self.instance, field+"_id"):
    if str(self.initial_data[field]) != str(getattr(self.instance,field+"_id")):
     raise serializers.ValidationError({field:"Ownership cannot be changed."})
  values={field:attrs.get(field,getattr(self.instance,field,None)) for field in ("product","component_product","bom","bom_version","warehouse","wip_account","variance_account")}
  for field,obj in values.items():
   if obj is None: continue
   owner=obj.bom.organisation_id if field=="bom_version" else obj.organisation_id
   if owner!=org.pk: raise serializers.ValidationError({field:"Choose a record in this organisation."})
   if field in ("product","component_product") and (obj.status!="active" or not obj.track_inventory):
    raise serializers.ValidationError({field:"Choose an active tracked product."})
   if field in ("warehouse","wip_account","variance_account") and obj.status!="active":
    raise serializers.ValidationError({field:"Choose an active record."})
  if values["wip_account"] and values["wip_account"].account_type!="asset":
   raise serializers.ValidationError({"wip_account":"Choose an asset account."})
  if values["product"] and values["bom_version"] and values["bom_version"].bom.product_id!=values["product"].pk:
   raise serializers.ValidationError({"bom_version":"BOM must match the production product."})
  if values["bom_version"] and values["component_product"] and values["bom_version"].bom.product_id==values["component_product"].pk:
   raise serializers.ValidationError({"component_product":"A BOM cannot contain its own product."})
  return attrs

class BOMComponentSerializer(ScopedRelationships):
 product=serializers.SerializerMethodField()
 class Meta:model=BOMComponent;fields=["id","bom_version","component_product","product","quantity","scrap_percentage","sequence","notes","created_at","updated_at"]
 def get_product(self,x):return {"id":str(x.component_product_id),"code":x.component_product.code,"name":x.component_product.name}
class BOMVersionSerializer(ScopedRelationships):
 components=BOMComponentSerializer(many=True,read_only=True)
 product_detail=serializers.SerializerMethodField()
 class Meta:model=BOMVersion;fields="__all__";read_only_fields=["created_by"]
 def get_product_detail(self,x):return {"id":str(x.bom.product_id),"code":x.bom.product.code,"name":x.bom.product.name}
class BillOfMaterialsSerializer(ScopedRelationships):
 versions=BOMVersionSerializer(many=True,read_only=True);product_detail=serializers.SerializerMethodField()
 class Meta:model=BillOfMaterials;fields="__all__";read_only_fields=["organisation","created_by"]
 def get_product_detail(self,x):return {"id":str(x.product_id),"code":x.product.code,"name":x.product.name}
class ProductionOrderComponentSerializer(serializers.ModelSerializer):
 product_detail=serializers.SerializerMethodField()
 class Meta:model=ProductionOrderComponent;fields="__all__";read_only_fields=fields
 def get_product_detail(self,x):return {"id":str(x.product_id),"code":x.product.code,"name":x.product.name}
class ProductionOrderSerializer(ScopedRelationships):
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
