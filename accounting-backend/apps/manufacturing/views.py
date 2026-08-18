"""Organisation-scoped production actions delegated to inventory and journal services."""

from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet,ViewSet
from common.exceptions import BusinessRuleError
from common.permissions import OrganisationActionPermission
from common.views import OrganisationScopedViewSetMixin
from apps.accounting.models import Account
from apps.inventory.models import Product,Warehouse
from apps.manufacturing.models import *
from apps.manufacturing.serializers import *
from apps.manufacturing.services import *
from apps.organisations.permissions import *
class BOMComponentViewSet(OrganisationScopedViewSetMixin,ModelViewSet):
 serializer_class=BOMComponentSerializer;permission_classes=[IsAuthenticated,OrganisationActionPermission];action_permissions={"list":VIEW_MANUFACTURING,"retrieve":VIEW_MANUFACTURING,"create":MANAGE_BOMS,"update":MANAGE_BOMS,"partial_update":MANAGE_BOMS,"destroy":MANAGE_BOMS}
 def get_queryset(self):return BOMComponent.objects.filter(bom_version__bom__organisation=self.get_organisation()).select_related("bom_version__bom","component_product")
 def perform_create(self,s):
  version=s.validated_data["bom_version"]
  if version.bom.organisation_id!=self.get_organisation().id or version.status!="draft":raise BusinessRuleError("Components can only be added to a draft BOM version in this organisation.")
  s.save()
 def _draft(self,obj):
  if obj.bom_version.status!="draft":raise BusinessRuleError("Only draft BOM versions can be edited.")
 def perform_update(self,s):self._draft(self.get_object());s.save()
 def perform_destroy(self,obj):self._draft(obj);obj.delete()
class BOMViewSet(OrganisationScopedViewSetMixin,ModelViewSet):
 serializer_class=BillOfMaterialsSerializer;permission_classes=[IsAuthenticated,OrganisationActionPermission];action_permissions={"list":VIEW_MANUFACTURING,"retrieve":VIEW_MANUFACTURING,"create":MANAGE_BOMS,"update":MANAGE_BOMS,"partial_update":MANAGE_BOMS,"destroy":MANAGE_BOMS,"explode":VIEW_MANUFACTURING}
 def get_queryset(self):return BillOfMaterials.objects.filter(organisation=self.get_organisation()).select_related("product").prefetch_related("versions__components__component_product")
 def perform_create(self,s):s.save(organisation=self.get_organisation(),created_by=self.request.user)
 @action(detail=True,methods=["post"])
 def explode(self,r,pk=None):return Response(explode_bom(organisation=self.get_organisation(),product=self.get_object().product,quantity=r.data.get("quantity"),production_date=r.data.get("production_date")))
class BOMVersionViewSet(OrganisationScopedViewSetMixin,ModelViewSet):
 serializer_class=BOMVersionSerializer;permission_classes=[IsAuthenticated,OrganisationActionPermission]
 action_permissions={"list":VIEW_MANUFACTURING,"retrieve":VIEW_MANUFACTURING,"create":MANAGE_BOMS,"update":MANAGE_BOMS,"partial_update":MANAGE_BOMS,"destroy":MANAGE_BOMS,"cost":VIEW_MANUFACTURING,"activate":MANAGE_BOMS}
 def get_queryset(self):return BOMVersion.objects.filter(bom__organisation=self.get_organisation()).select_related("bom","bom__product").prefetch_related("components__component_product")
 def perform_create(self,s):
  if s.validated_data["bom"].organisation_id!=self.get_organisation().id:raise BusinessRuleError("BOM belongs to another organisation.")
  s.save(created_by=self.request.user)
 def _draft(self,obj):
  if obj.status!="draft":raise BusinessRuleError("Only draft BOM versions can be edited or deleted.")
 def perform_update(self,s):self._draft(self.get_object());s.save()
 def perform_destroy(self,obj):self._draft(obj);obj.delete()
 @action(detail=True,methods=["get"])
 def cost(self,r,pk=None):
  warehouse=Warehouse.objects.filter(organisation=self.get_organisation(),id=r.query_params.get("warehouse")).first() if r.query_params.get("warehouse") else None
  return Response(calculate_bom_cost(organisation=self.get_organisation(),bom_version=self.get_object(),warehouse=warehouse,as_of_date=r.query_params.get("as_of_date")))
 @action(detail=True,methods=["post"])
 def activate(self,r,pk=None):return Response(self.get_serializer(activate_bom_version(organisation=self.get_organisation(),bom_version=self.get_object())).data)
class ProductionOrderViewSet(OrganisationScopedViewSetMixin,ModelViewSet):
 serializer_class=ProductionOrderSerializer;permission_classes=[IsAuthenticated,OrganisationActionPermission];action_permissions={"list":VIEW_MANUFACTURING,"retrieve":VIEW_MANUFACTURING,"create":CREATE_PRODUCTION_ORDER,"update":CREATE_PRODUCTION_ORDER,"partial_update":CREATE_PRODUCTION_ORDER,"destroy":CREATE_PRODUCTION_ORDER,"release":RELEASE_PRODUCTION_ORDER,"requirements":VIEW_MANUFACTURING,"shortages":VIEW_MANUFACTURING,"cost_summary":VIEW_MANUFACTURING,"issue_materials":ISSUE_MATERIALS,"return_material":ISSUE_MATERIALS}
 action_permissions.update({"add_labour":POST_PRODUCTION_COSTS,"add_overhead":POST_PRODUCTION_COSTS,"add_subcontract":POST_PRODUCTION_COSTS,"complete":COMPLETE_PRODUCTION,"close":CLOSE_PRODUCTION_ORDER})
 def get_queryset(self):return ProductionOrder.objects.filter(organisation=self.get_organisation()).select_related("product","bom_version","warehouse","wip_account","variance_account").prefetch_related("components__product")
 def create(self,r,*a,**k):
  q=ProductionOrderCreateSerializer(data=r.data);q.is_valid(raise_exception=True);d=q.validated_data;org=self.get_organisation()
  def obj(model,key):
   value=d.pop(key,None);return model.objects.filter(id=value,organisation=org).first() if value else None
  product=obj(Product,"product");warehouse=obj(Warehouse,"warehouse");wip=obj(Account,"wip_account");variance=obj(Account,"variance_account");version=BOMVersion.objects.filter(id=d.pop("bom_version",None),bom__organisation=org).first() if d.get("bom_version") else None
  if not all((product,warehouse,wip)):raise BusinessRuleError("A production relationship was not found in this organisation.")
  result=create_production_order(organisation=org,product=product,warehouse=warehouse,wip_account=wip,variance_account=variance,bom_version=version,user=r.user,**d);return Response(self.get_serializer(result).data,status=201)
 def update(self,r,*a,**k):
  if self.get_object().status!="draft":raise BusinessRuleError("Released production orders cannot be edited.")
  return super().update(r,*a,**k)
 @action(detail=True,methods=["post"])
 def release(self,r,pk=None):return Response(self.get_serializer(release_production_order(organisation=self.get_organisation(),production_order=self.get_object(),user=r.user)).data)
 @action(detail=True,methods=["get"])
 def requirements(self,r,pk=None):return Response(get_production_material_requirements(organisation=self.get_organisation(),production_order=self.get_object()))
 @action(detail=True,methods=["get"])
 def shortages(self,r,pk=None):return Response(get_material_shortages(organisation=self.get_organisation(),production_order=self.get_object()))
 @action(detail=True,methods=["get"],url_path="cost-summary")
 def cost_summary(self,r,pk=None):return Response(get_production_order_cost_summary(organisation=self.get_organisation(),production_order=self.get_object()))
 @action(detail=True,methods=["post"],url_path="issue-materials")
 def issue_materials(self,r,pk=None):q=MaterialIssueRequestSerializer(data=r.data);q.is_valid(raise_exception=True);return Response(self.get_serializer(issue_production_order_materials(organisation=self.get_organisation(),production_order=self.get_object(),user=r.user,**q.validated_data)).data)
 @action(detail=True,methods=["post"],url_path="return-material")
 def return_material(self,r,pk=None):q=MaterialReturnRequestSerializer(data=r.data);q.is_valid(raise_exception=True);d=q.validated_data;component=ProductionOrderComponent.objects.filter(production_order=self.get_object(),id=d.pop("component_id")).first();return Response(ProductionOrderComponentSerializer(return_production_order_material(organisation=self.get_organisation(),production_order=self.get_object(),component=component,user=r.user,**d)).data)
 def _cost(self,r,serializer,service):
  q=serializer(data=r.data);q.is_valid(raise_exception=True);d=q.validated_data;account=Account.objects.filter(organisation=self.get_organisation(),id=d.pop("source_account_id")).first()
  if not account:raise BusinessRuleError("Source account was not found.")
  row=service(organisation=self.get_organisation(),production_order=self.get_object(),source_account=account,user=r.user,**d);return Response({"id":str(row.id),"amount":row.amount,"cost_type":row.cost_type},status=201)
 @action(detail=True,methods=["post"],url_path="add-labour")
 def add_labour(self,r,pk=None):return self._cost(r,LabourCostSerializer,add_labour_cost)
 @action(detail=True,methods=["post"],url_path="add-overhead")
 def add_overhead(self,r,pk=None):return self._cost(r,OverheadCostSerializer,add_overhead_cost)
 @action(detail=True,methods=["post"],url_path="add-subcontract")
 def add_subcontract(self,r,pk=None):return self._cost(r,ProductionCostRequestSerializer,add_subcontract_cost)
 @action(detail=True,methods=["post"])
 def complete(self,r,pk=None):
  q=CompletionSerializer(data=r.data);q.is_valid(raise_exception=True);d=q.validated_data;warehouse=Warehouse.objects.filter(organisation=self.get_organisation(),id=d.pop("destination_warehouse_id")).first()
  if not warehouse:raise BusinessRuleError("Destination warehouse was not found.")
  result=complete_production(organisation=self.get_organisation(),production_order=self.get_object(),destination_warehouse=warehouse,user=r.user,**d);return Response({"production_order":self.get_serializer(result["production_order"]).data,"transfer_amount":result["transfer_amount"]})
 @action(detail=True,methods=["post"])
 def close(self,r,pk=None):q=CloseProductionSerializer(data=r.data);q.is_valid(raise_exception=True);result=close_production_order(organisation=self.get_organisation(),production_order=self.get_object(),user=r.user,**q.validated_data);return Response(self.get_serializer(result["production_order"]).data)

class ManufacturingReportViewSet(OrganisationScopedViewSetMixin,ViewSet):
 permission_classes=[IsAuthenticated,OrganisationActionPermission];http_method_names=["get","head","options"];action_permissions={"dashboard":VIEW_MANUFACTURING,"bom_cost":VIEW_MANUFACTURING,"bom_explosion":VIEW_MANUFACTURING,"material_requirements":VIEW_MANUFACTURING,"material_shortages":VIEW_MANUFACTURING,"wip":VIEW_MANUFACTURING,"production_variance":VIEW_MANUFACTURING,"material_usage":VIEW_MANUFACTURING,"finished_goods_output":VIEW_MANUFACTURING}
 @action(detail=False,methods=["get"])
 def dashboard(self,r):return Response(manufacturing_dashboard(organisation=self.get_organisation()))
 @action(detail=False,methods=["get"],url_path="bom-cost")
 def bom_cost(self,r):return Response(bom_cost_report(organisation=self.get_organisation()))
 @action(detail=False,methods=["get"],url_path="bom-explosion")
 def bom_explosion(self,r):
  for field in ("product_id","quantity","production_date"):
   if not r.query_params.get(field):raise BusinessRuleError(f"{field.replace('_',' ').title()} is required.")
  return Response(bom_explosion_report(organisation=self.get_organisation(),product_id=r.query_params["product_id"],quantity=r.query_params["quantity"],production_date=r.query_params["production_date"]))
 @action(detail=False,methods=["get"],url_path="material-requirements")
 def material_requirements(self,r):return Response(material_requirements_report(organisation=self.get_organisation()))
 @action(detail=False,methods=["get"],url_path="material-shortages")
 def material_shortages(self,r):return Response(material_requirements_report(organisation=self.get_organisation(),shortages_only=True))
 @action(detail=False,methods=["get"])
 def wip(self,r):return Response(wip_report(organisation=self.get_organisation()))
 @action(detail=False,methods=["get"],url_path="production-variance")
 def production_variance(self,r):return Response(variance_report(organisation=self.get_organisation()))
 @action(detail=False,methods=["get"],url_path="material-usage")
 def material_usage(self,r):return Response(material_usage_report(organisation=self.get_organisation()))
 @action(detail=False,methods=["get"],url_path="finished-goods-output")
 def finished_goods_output(self,r):return Response(finished_goods_output_report(organisation=self.get_organisation()))
