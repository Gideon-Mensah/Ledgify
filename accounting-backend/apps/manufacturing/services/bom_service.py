"""Validate bills of materials used to plan production component requirements."""

from collections import defaultdict
from datetime import timedelta
from decimal import Decimal
from django.db import transaction
from django.db.models import Q
from common.exceptions import BusinessRuleError
from apps.inventory.models import Warehouse
from apps.inventory.services.costing import get_current_average_cost
from apps.manufacturing.models import BOMVersion,BillOfMaterials
def get_effective_bom_version(*,organisation,product,date):
 qs=BOMVersion.objects.filter(bom__organisation=organisation,bom__product=product,status=BOMVersion.Status.ACTIVE,effective_from__lte=date).filter(Q(effective_to=None)|Q(effective_to__gte=date));count=qs.count()
 if count==0:raise BusinessRuleError("No active BOM version is available for this product and date.")
 if count>1:raise BusinessRuleError("Multiple active BOM versions overlap for this product and date.")
 return qs.select_related("bom","bom__product").get()
def validate_bom_no_cycles(*,organisation,bom_version,max_depth=20):
 def walk(product,path,depth):
  if depth>max_depth:raise BusinessRuleError("BOM maximum depth exceeded.")
  if product.id in path:raise BusinessRuleError("Circular BOM: "+" -> ".join(str(x) for x in path+[product.id]))
  try:version=get_effective_bom_version(organisation=organisation,product=product,date=bom_version.effective_from)
  except BusinessRuleError:return
  for component in version.components.select_related("component_product"):walk(component.component_product,path+[product.id],depth+1)
 walk(bom_version.bom.product,[],0);return True
def explode_bom(*,organisation,product,quantity,production_date,max_depth=20):
 quantity=Decimal(str(quantity));flat=defaultdict(Decimal)
 if quantity<=0:raise BusinessRuleError("Explosion quantity must be positive.")
 def walk(item,requested,path,depth):
  if depth>max_depth:raise BusinessRuleError("BOM maximum depth exceeded.")
  if item.id in path:raise BusinessRuleError("Circular BOM detected in product path.")
  version=get_effective_bom_version(organisation=organisation,product=item,date=production_date);factor=requested/version.output_quantity;rows=[]
  for c in version.components.select_related("component_product"):
   required=c.quantity*factor*(Decimal("1")+c.scrap_percentage/Decimal("100"));row={"product":{"id":str(c.component_product_id),"code":c.component_product.code,"name":c.component_product.name},"quantity":required,"scrap_percentage":c.scrap_percentage,"bom_component_id":str(c.id),"components":[]}
   try:row["components"]=walk(c.component_product,required,path+[item.id],depth+1)["components"]
   except BusinessRuleError as error:
    if "No active BOM version" not in str(error):raise
    flat[c.component_product_id]+=required
   rows.append(row)
  return {"product":{"id":str(item.id),"code":item.code,"name":item.name},"requested_quantity":requested,"bom_version":{"id":str(version.id),"version_number":version.version_number},"components":rows}
 root=walk(product,quantity,[],0);root["flattened_requirements"]=[{"product":{"id":str(p.id),"code":p.code,"name":p.name},"required_quantity":qty} for p,qty in ((product.__class__.objects.get(id=pid),qty) for pid,qty in flat.items())];return root
def calculate_bom_cost(*,organisation,bom_version,warehouse=None,as_of_date=None):
 warehouse=warehouse or Warehouse.objects.filter(organisation=organisation,is_default=True,status="active").first()
 if not warehouse:raise BusinessRuleError("A warehouse is required for BOM costing.")
 total=Decimal("0");rows=[]
 for c in bom_version.components.select_related("component_product"):
  required=c.quantity*(Decimal("1")+c.scrap_percentage/Decimal("100"));cost=get_current_average_cost(organisation=organisation,product=c.component_product,warehouse=warehouse,as_of_date=as_of_date);value=required*cost["average_unit_cost"];total+=value;rows.append({"product":{"id":str(c.component_product_id),"code":c.component_product.code,"name":c.component_product.name},"required_quantity":required,"average_unit_cost":cost["average_unit_cost"],"total_cost":value})
 return {"output_quantity":bom_version.output_quantity,"material_cost":total,"cost_per_output_unit":total/bom_version.output_quantity,"components":rows}

@transaction.atomic
def activate_bom_version(*,organisation,bom_version):
 version=BOMVersion.objects.select_for_update().select_related("bom").get(pk=bom_version.pk)
 if version.bom.organisation_id!=organisation.id or version.status!=BOMVersion.Status.DRAFT:raise BusinessRuleError("Only an organisation draft BOM version can be activated.")
 validate_bom_no_cycles(organisation=organisation,bom_version=version)
 prior=BOMVersion.objects.select_for_update().filter(bom=version.bom,status=BOMVersion.Status.ACTIVE).exclude(pk=version.pk).first()
 if prior:
  cutoff=version.effective_from-timedelta(days=1)
  if cutoff<prior.effective_from:raise BusinessRuleError("The new version must start after the current active version.")
  BOMVersion.objects.filter(pk=prior.pk).update(status=BOMVersion.Status.SUPERSEDED,effective_to=cutoff)
 version.status=BOMVersion.Status.ACTIVE;version.save(update_fields=["status","updated_at"]);return version
