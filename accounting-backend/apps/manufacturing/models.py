"""BOMs and production orders that track material, WIP, completion, and variance history."""

import uuid
from django.conf import settings
from django.db import models
class ProductionCostTransaction(models.Model):
 class CostType(models.TextChoices):MATERIAL="material","Material";LABOUR="labour","Labour";OVERHEAD="overhead","Overhead";SUBCONTRACT="subcontract","Subcontract";COMPLETION="completion","Completion";RETURN="return","Return";SCRAP="scrap","Scrap";VARIANCE="variance","Variance"
 id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False);organisation=models.ForeignKey("organisations.Organisation",on_delete=models.PROTECT,related_name="production_cost_transactions");production_order_id=models.UUIDField(null=True,blank=True);transaction_date=models.DateField();cost_type=models.CharField(max_length=20,choices=CostType.choices);source_type=models.CharField(max_length=40);source_id=models.UUIDField(null=True,blank=True);amount=models.DecimalField(max_digits=18,decimal_places=2);journal_entry=models.ForeignKey("accounting.JournalEntry",on_delete=models.PROTECT,null=True,blank=True,related_name="production_cost_transactions");description=models.TextField(blank=True);created_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT);created_at=models.DateTimeField(auto_now_add=True)
 class Meta:ordering=["transaction_date","created_at","id"]
 def save(self,*args,**kwargs):
  from common.exceptions import BusinessRuleError
  if self.pk and ProductionCostTransaction.objects.filter(pk=self.pk).exists():raise BusinessRuleError("Production cost transactions are immutable.")
  return super().save(*args,**kwargs)

class BillOfMaterials(models.Model):
 class Status(models.TextChoices):ACTIVE="active","Active";INACTIVE="inactive","Inactive";ARCHIVED="archived","Archived"
 id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False);organisation=models.ForeignKey("organisations.Organisation",on_delete=models.CASCADE,related_name="boms");product=models.ForeignKey("inventory.Product",on_delete=models.PROTECT,related_name="boms");code=models.CharField(max_length=50);name=models.CharField(max_length=150);description=models.TextField(blank=True);status=models.CharField(max_length=10,choices=Status.choices,default=Status.ACTIVE);created_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT,related_name="boms_created");created_at=models.DateTimeField(auto_now_add=True);updated_at=models.DateTimeField(auto_now=True)
 class Meta:constraints=[models.UniqueConstraint(fields=["organisation","code"],name="unique_bom_code_per_org")]
 def clean(self):
  from common.exceptions import BusinessRuleError
  if self.product.organisation_id!=self.organisation_id or self.product.status!="active" or not self.product.track_inventory:raise BusinessRuleError("BOM product must be an active tracked product in this organisation.")
 def save(self,*a,**k):self.full_clean();return super().save(*a,**k)
class BOMVersion(models.Model):
 class Status(models.TextChoices):DRAFT="draft","Draft";ACTIVE="active","Active";INACTIVE="inactive","Inactive";SUPERSEDED="superseded","Superseded"
 id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False);bom=models.ForeignKey(BillOfMaterials,on_delete=models.PROTECT,related_name="versions");version_number=models.CharField(max_length=30);effective_from=models.DateField();effective_to=models.DateField(null=True,blank=True);output_quantity=models.DecimalField(max_digits=18,decimal_places=4);status=models.CharField(max_length=12,choices=Status.choices,default=Status.DRAFT);notes=models.TextField(blank=True);created_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT);created_at=models.DateTimeField(auto_now_add=True);updated_at=models.DateTimeField(auto_now=True)
 class Meta:constraints=[models.UniqueConstraint(fields=["bom","version_number"],name="unique_bom_version"),models.CheckConstraint(condition=models.Q(output_quantity__gt=0),name="bom_output_positive")]
 def clean(self):
  from common.exceptions import BusinessRuleError
  if self.effective_to and self.effective_to<self.effective_from:raise BusinessRuleError("Effective end cannot precede start.")
  if self.status==self.Status.ACTIVE:
   q=BOMVersion.objects.filter(bom=self.bom,status=self.Status.ACTIVE).exclude(pk=self.pk).filter(models.Q(effective_to=None)|models.Q(effective_to__gte=self.effective_from));q=q.filter(effective_from__lte=self.effective_to) if self.effective_to else q
   if q.exists():raise BusinessRuleError("Active BOM version dates overlap.")
 def save(self,*a,**k):self.full_clean();return super().save(*a,**k)
class BOMComponent(models.Model):
 id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False);bom_version=models.ForeignKey(BOMVersion,on_delete=models.PROTECT,related_name="components");component_product=models.ForeignKey("inventory.Product",on_delete=models.PROTECT,related_name="bom_components");quantity=models.DecimalField(max_digits=18,decimal_places=4);scrap_percentage=models.DecimalField(max_digits=7,decimal_places=4,default=0);sequence=models.PositiveIntegerField(default=0);notes=models.TextField(blank=True);created_at=models.DateTimeField(auto_now_add=True);updated_at=models.DateTimeField(auto_now=True)
 class Meta:ordering=["sequence","id"];constraints=[models.CheckConstraint(condition=models.Q(quantity__gt=0),name="bom_component_qty_positive"),models.CheckConstraint(condition=models.Q(scrap_percentage__gte=0),name="bom_scrap_nonnegative")]
 def clean(self):
  from common.exceptions import BusinessRuleError
  if self.component_product.organisation_id!=self.bom_version.bom.organisation_id or self.component_product_id==self.bom_version.bom.product_id:raise BusinessRuleError("BOM component is cross-organisation or directly self-referencing.")
 def save(self,*a,**k):self.full_clean();return super().save(*a,**k)
class ProductionOrder(models.Model):
 class Status(models.TextChoices):DRAFT="draft","Draft";RELEASED="released","Released";IN_PROGRESS="in_progress","In progress";PARTLY_COMPLETED="partly_completed","Partly completed";COMPLETED="completed","Completed";CLOSED="closed","Closed";CANCELLED="cancelled","Cancelled"
 id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False);organisation=models.ForeignKey("organisations.Organisation",on_delete=models.PROTECT,related_name="production_orders");order_number=models.CharField(max_length=50);product=models.ForeignKey("inventory.Product",on_delete=models.PROTECT);bom_version=models.ForeignKey(BOMVersion,on_delete=models.PROTECT);warehouse=models.ForeignKey("inventory.Warehouse",on_delete=models.PROTECT);planned_quantity=models.DecimalField(max_digits=18,decimal_places=4);completed_quantity=models.DecimalField(max_digits=18,decimal_places=4,default=0);start_date=models.DateField();due_date=models.DateField();status=models.CharField(max_length=20,choices=Status.choices,default=Status.DRAFT);reference=models.CharField(max_length=100,blank=True);notes=models.TextField(blank=True);wip_account=models.ForeignKey("accounting.Account",on_delete=models.PROTECT,related_name="production_wip_orders");variance_account=models.ForeignKey("accounting.Account",on_delete=models.PROTECT,null=True,blank=True,related_name="production_variance_orders");created_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT,related_name="production_orders_created");released_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT,null=True,blank=True,related_name="production_orders_released");released_at=models.DateTimeField(null=True,blank=True);completed_at=models.DateTimeField(null=True,blank=True);closed_at=models.DateTimeField(null=True,blank=True);created_at=models.DateTimeField(auto_now_add=True);updated_at=models.DateTimeField(auto_now=True)
 class Meta:constraints=[models.UniqueConstraint(fields=["organisation","order_number"],name="unique_production_order"),models.CheckConstraint(condition=models.Q(planned_quantity__gt=0),name="production_planned_positive")]
 def save(self,*args,**kwargs):
  from common.exceptions import BusinessRuleError
  if self.pk:
   old=ProductionOrder.objects.filter(pk=self.pk).first()
   if old and old.status!=self.Status.DRAFT:
    for field in ("product_id","bom_version_id","warehouse_id","planned_quantity","wip_account_id"):
     if getattr(old,field)!=getattr(self,field):raise BusinessRuleError("Released production structure is immutable.")
  return super().save(*args,**kwargs)
 def delete(self,*args,**kwargs):
  from common.exceptions import BusinessRuleError
  if self.status!=self.Status.DRAFT:raise BusinessRuleError("Only draft production orders can be deleted.")
  return super().delete(*args,**kwargs)
class ProductionOrderComponent(models.Model):
 id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False);production_order=models.ForeignKey(ProductionOrder,on_delete=models.PROTECT,related_name="components");product=models.ForeignKey("inventory.Product",on_delete=models.PROTECT);bom_component=models.ForeignKey(BOMComponent,on_delete=models.PROTECT,null=True,blank=True);required_quantity=models.DecimalField(max_digits=18,decimal_places=4);issued_quantity=models.DecimalField(max_digits=18,decimal_places=4,default=0);returned_quantity=models.DecimalField(max_digits=18,decimal_places=4,default=0);planned_unit_cost=models.DecimalField(max_digits=24,decimal_places=8,null=True,blank=True);planned_total_cost=models.DecimalField(max_digits=18,decimal_places=4,null=True,blank=True);created_at=models.DateTimeField(auto_now_add=True);updated_at=models.DateTimeField(auto_now=True)
 class Meta:constraints=[models.UniqueConstraint(fields=["production_order","product"],name="unique_order_component")]
