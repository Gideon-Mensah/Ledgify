"""Manage production order status changes and protect completed manufacturing history."""

from collections import defaultdict
from decimal import Decimal
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from common.exceptions import BusinessRuleError
from apps.accounting.models import Account
from apps.accounting.services.periods import validate_period_open
from apps.inventory.services.costing import get_current_average_cost
from apps.inventory.services.stock import get_stock_quantity
from apps.manufacturing.models import ProductionCostTransaction,ProductionOrder,ProductionOrderComponent
from apps.manufacturing.services.material_issue_service import issue_material_to_wip,return_material_from_wip
from apps.organisations.permissions import CREATE_PRODUCTION_ORDER,ISSUE_MATERIALS,RELEASE_PRODUCTION_ORDER
from apps.organisations.services import require_organisation_permission
from .bom_service import explode_bom,get_effective_bom_version,validate_bom_no_cycles
def _scope(org,order):
 if order.organisation_id!=org.id:raise BusinessRuleError("Production order belongs to another organisation.")
def _account(org,account):
 if not account or account.organisation_id!=org.id or account.status!=Account.Status.ACTIVE:raise BusinessRuleError("Production account must be active and organisation-scoped.")
@transaction.atomic
def create_production_order(*,organisation,product,warehouse,planned_quantity,start_date,due_date,wip_account,user,bom_version=None,variance_account=None,reference="",notes="",order_number=None):
 require_organisation_permission(organisation=organisation,user=user,permission=CREATE_PRODUCTION_ORDER);planned_quantity=Decimal(str(planned_quantity))
 if product.organisation_id!=organisation.id or product.status!="active" or not product.track_inventory:raise BusinessRuleError("Manufactured product is invalid.")
 if warehouse.organisation_id!=organisation.id or warehouse.status!="active":raise BusinessRuleError("Warehouse is invalid.")
 if planned_quantity<=0 or due_date<start_date:raise BusinessRuleError("Production quantity or dates are invalid.")
 _account(organisation,wip_account)
 if variance_account:_account(organisation,variance_account)
 bom_version=bom_version or get_effective_bom_version(organisation=organisation,product=product,date=start_date)
 if bom_version.bom.organisation_id!=organisation.id or bom_version.bom.product_id!=product.id:raise BusinessRuleError("BOM version does not match the production product.")
 return ProductionOrder.objects.create(organisation=organisation,order_number=order_number or f"PO-{timezone.now().strftime('%Y%m%d%H%M%S%f')}",product=product,bom_version=bom_version,warehouse=warehouse,planned_quantity=planned_quantity,start_date=start_date,due_date=due_date,wip_account=wip_account,variance_account=variance_account,reference=reference,notes=notes,created_by=user)
@transaction.atomic
def release_production_order(*,organisation,production_order,user):
 require_organisation_permission(organisation=organisation,user=user,permission=RELEASE_PRODUCTION_ORDER);order=ProductionOrder.objects.select_for_update().select_related("bom_version__bom","warehouse","wip_account").get(pk=production_order.pk);_scope(organisation,order)
 if order.status!=ProductionOrder.Status.DRAFT:raise BusinessRuleError("Only draft production orders can be released.")
 validate_bom_no_cycles(organisation=organisation,bom_version=order.bom_version);data=explode_bom(organisation=organisation,product=order.product,quantity=order.planned_quantity,production_date=order.start_date)
 for row in data["flattened_requirements"]:
  product=order.product.__class__.objects.get(id=row["product"]["id"]);cost=get_current_average_cost(organisation=organisation,product=product,warehouse=order.warehouse);ProductionOrderComponent.objects.create(production_order=order,product=product,required_quantity=row["required_quantity"],planned_unit_cost=cost["average_unit_cost"],planned_total_cost=row["required_quantity"]*cost["average_unit_cost"])
 order.status=ProductionOrder.Status.RELEASED;order.released_by=user;order.released_at=timezone.now();order.save(update_fields=["status","released_by","released_at","updated_at"]);return order
def get_production_material_requirements(*,organisation,production_order):
 _scope(organisation,production_order);rows=[]
 for c in production_order.components.select_related("product"):
  net=c.issued_quantity-c.returned_quantity;remaining=max(c.required_quantity-net,Decimal("0"));available=get_stock_quantity(organisation=organisation,product=c.product,warehouse=production_order.warehouse);rows.append({"id":str(c.id),"product":{"id":str(c.product_id),"code":c.product.code,"name":c.product.name},"required_quantity":c.required_quantity,"issued_quantity":c.issued_quantity,"returned_quantity":c.returned_quantity,"net_issued_quantity":net,"remaining_to_issue":remaining,"quantity_on_hand":available,"shortage_quantity":max(remaining-available,Decimal("0")),"planned_unit_cost":c.planned_unit_cost,"planned_total_cost":c.planned_total_cost})
 return rows
def get_material_shortages(*,organisation,production_order=None,warehouse=None):
 if production_order:return [x for x in get_production_material_requirements(organisation=organisation,production_order=production_order) if x["shortage_quantity"]>0]
 result=[]
 for order in ProductionOrder.objects.filter(organisation=organisation,status__in=["released","in_progress","partly_completed"]).select_related("warehouse").prefetch_related("components__product"):
  if warehouse and order.warehouse_id!=warehouse.id:continue
  result.extend(get_material_shortages(organisation=organisation,production_order=order))
 return result
@transaction.atomic
def issue_production_order_materials(*,organisation,production_order,lines,issue_date,user,reference=""):
 require_organisation_permission(organisation=organisation,user=user,permission=ISSUE_MATERIALS);validate_period_open(organisation,issue_date);order=ProductionOrder.objects.select_for_update().get(pk=production_order.pk);_scope(organisation,order)
 if order.status not in {"released","in_progress","partly_completed"}:raise BusinessRuleError("Production order is not eligible for material issue.")
 ids=[x["production_order_component_id"] for x in lines];components={str(x.id):x for x in ProductionOrderComponent.objects.select_for_update().select_related("product").filter(production_order=order,id__in=ids)}
 prepared=[]
 for line in lines:
  c=components.get(str(line["production_order_component_id"]));qty=Decimal(str(line["quantity"]));remaining=c.required_quantity-(c.issued_quantity-c.returned_quantity) if c else Decimal("0")
  if not c or qty<=0 or qty>remaining:raise BusinessRuleError("Material issue line is invalid or exceeds requirement.")
  if qty>get_stock_quantity(organisation=organisation,product=c.product,warehouse=order.warehouse):raise BusinessRuleError("Insufficient stock for production material issue.")
  prepared.append((c,qty))
 for c,qty in prepared:
  issue_material_to_wip(organisation=organisation,product=c.product,warehouse=order.warehouse,quantity=qty,issue_date=issue_date,wip_account=order.wip_account,user=user,production_order_id=order.id,reference=reference,check_permissions=False);c.issued_quantity+=qty;c.save(update_fields=["issued_quantity","updated_at"])
 order.status="in_progress";order.save(update_fields=["status","updated_at"]);return order
@transaction.atomic
def return_production_order_material(*,organisation,production_order,component,quantity,return_date,user,reference=""):
 require_organisation_permission(organisation=organisation,user=user,permission=ISSUE_MATERIALS);order=ProductionOrder.objects.select_for_update().get(pk=production_order.pk);_scope(organisation,order);c=ProductionOrderComponent.objects.select_for_update().select_related("product").get(pk=component.pk,production_order=order);qty=Decimal(str(quantity))
 if order.status not in {"in_progress","partly_completed"} or qty<=0 or qty>c.issued_quantity-c.returned_quantity:raise BusinessRuleError("Material return is invalid.")
 original=c.product.stock_movements.filter(source_id=order.id,movement_type="production_material_issue",status="posted").order_by("created_at").first();return_material_from_wip(organisation=organisation,product=c.product,warehouse=order.warehouse,quantity=qty,return_date=return_date,wip_account=order.wip_account,original_issue_movement=original,user=user,production_order_id=order.id,reference=reference,check_permissions=False);c.returned_quantity+=qty;c.save(update_fields=["returned_quantity","updated_at"]);return c
def get_production_order_cost_summary(*,organisation,production_order):
 _scope(organisation,production_order);values=defaultdict(Decimal)
 for row in ProductionCostTransaction.objects.filter(organisation=organisation,production_order_id=production_order.id).values("cost_type").annotate(total=Sum("amount")):values[row["cost_type"]]=row["total"]
 material=values["material"];returns=abs(values["return"]);return {"material_cost":material,"material_returns":returns,"net_material_cost":material-returns,"labour_cost":values["labour"],"overhead_cost":values["overhead"],"subcontract_cost":values["subcontract"],"completion_transfers":abs(values["completion"]),"variance":values["variance"],"current_wip":material-returns+values["labour"]+values["overhead"]+values["subcontract"]-abs(values["completion"])+values["variance"]}
