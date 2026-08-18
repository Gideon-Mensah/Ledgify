"""Move material cost from Inventory into Work in Progress for production."""

from decimal import Decimal,ROUND_HALF_UP
from django.db import transaction
from django.utils import timezone
from common.exceptions import BusinessRuleError
from apps.accounting.models import Account,JournalEntry
from apps.accounting.services.journals import create_journal_entry,post_journal_entry
from apps.accounting.services.periods import validate_period_open
from apps.inventory.models import StockMovement
from apps.inventory.services.costing import cost_stock_movement
from apps.manufacturing.models import ProductionCostTransaction
from apps.organisations.permissions import ISSUE_MATERIALS
from apps.organisations.services import require_organisation_permission

ZERO=Decimal("0.00")
def _validate(organisation,product,warehouse,quantity,wip,date):
 validate_period_open(organisation,date);quantity=Decimal(str(quantity))
 if product.organisation_id!=organisation.id or warehouse.organisation_id!=organisation.id:raise BusinessRuleError("Product and warehouse must belong to this organisation.")
 if product.status!=product.Status.ACTIVE or not product.track_inventory:raise BusinessRuleError("Product must be active and inventory-tracked.")
 if warehouse.status!=warehouse.Status.ACTIVE:raise BusinessRuleError("Warehouse must be active.")
 if quantity<=0:raise BusinessRuleError("Quantity must be positive.")
 inventory=product.inventory_asset_account
 for account in (inventory,wip):
  if not account or account.organisation_id!=organisation.id or account.status!=Account.Status.ACTIVE or account.account_type!=Account.AccountType.ASSET:raise BusinessRuleError("Active organisation inventory and WIP asset accounts are required.")
 return quantity,inventory
def _movement(*,organisation,product,warehouse,date,kind,quantity,unit_cost,user,production_order_id,reference,description):
 return StockMovement.objects.create(organisation=organisation,product=product,warehouse=warehouse,movement_date=date,movement_type=kind,quantity=quantity,unit_cost=unit_cost,total_cost=quantity*unit_cost,reference=reference,description=description,source_type=StockMovement.SourceType.MANUFACTURING,source_id=production_order_id,status=StockMovement.Status.DRAFT,created_by=user)
def _journal(*,organisation,date,debit,credit,amount,user,source_type,source_id,reference,description):
 journal=create_journal_entry(organisation=organisation,date=date,description=description,reference=reference,source_type=source_type,source_id=source_id,user=user,lines=[{"account":debit,"debit":amount,"credit":ZERO,"description":description},{"account":credit,"debit":ZERO,"credit":amount,"description":description}]);post_journal_entry(journal_entry=journal,user=user);return journal
def _finish(movement,journal,user):movement.accounting_journal=journal;movement.status=StockMovement.Status.POSTED;movement.posted_by=user;movement.posted_at=timezone.now();movement.save(update_fields=["accounting_journal","status","posted_by","posted_at","updated_at"])
@transaction.atomic
def issue_material_to_wip(*,organisation,product,warehouse,quantity,issue_date,wip_account,user,production_order_id=None,reference="",description="",check_permissions=True):
 if check_permissions: require_organisation_permission(organisation=organisation,user=user,permission=ISSUE_MATERIALS)
 quantity,inventory=_validate(organisation,product,warehouse,quantity,wip_account,issue_date);movement=_movement(organisation=organisation,product=product,warehouse=warehouse,date=issue_date,kind=StockMovement.MovementType.PRODUCTION_MATERIAL_ISSUE,quantity=quantity,unit_cost=0,user=user,production_order_id=production_order_id,reference=reference,description=description or "Production material issue");cost=cost_stock_movement(organisation=organisation,movement=movement);movement.unit_cost=cost["unit_cost"];movement.total_cost=cost["cost_used"];movement.save(update_fields=["unit_cost","total_cost","updated_at"]);amount=cost["cost_used"].quantize(Decimal(".01"),rounding=ROUND_HALF_UP);journal=_journal(organisation=organisation,date=issue_date,debit=wip_account,credit=inventory,amount=amount,user=user,source_type=JournalEntry.SourceType.MANUFACTURING_MATERIAL_ISSUE,source_id=movement.id,reference=reference,description=description or "Material issued to WIP");_finish(movement,journal,user);audit=ProductionCostTransaction.objects.create(organisation=organisation,production_order_id=production_order_id,transaction_date=issue_date,cost_type="material",source_type="stock_movement",source_id=movement.id,amount=amount,journal_entry=journal,description=description,created_by=user);return {"movement":movement,"cost_transaction":audit,"journal":journal,"cost":cost}
@transaction.atomic
def return_material_from_wip(*,organisation,product,warehouse,quantity,return_date,wip_account,user,original_issue_movement=None,production_order_id=None,reference="",description="",check_permissions=True):
 if check_permissions: require_organisation_permission(organisation=organisation,user=user,permission=ISSUE_MATERIALS)
 quantity,inventory=_validate(organisation,product,warehouse,quantity,wip_account,return_date)
 if original_issue_movement:
  if original_issue_movement.organisation_id!=organisation.id or original_issue_movement.movement_type!=StockMovement.MovementType.PRODUCTION_MATERIAL_ISSUE:raise BusinessRuleError("Original issue is invalid.")
  unit=original_issue_movement.unit_cost
 else:
  from apps.inventory.services.costing import get_current_average_cost
  unit=get_current_average_cost(organisation=organisation,product=product,warehouse=warehouse)["average_unit_cost"]
 movement=_movement(organisation=organisation,product=product,warehouse=warehouse,date=return_date,kind=StockMovement.MovementType.PRODUCTION_MATERIAL_RETURN,quantity=quantity,unit_cost=unit,user=user,production_order_id=production_order_id,reference=reference,description=description or "Material return from WIP");cost_stock_movement(organisation=organisation,movement=movement);amount=(quantity*unit).quantize(Decimal(".01"),rounding=ROUND_HALF_UP);journal=_journal(organisation=organisation,date=return_date,debit=inventory,credit=wip_account,amount=amount,user=user,source_type=JournalEntry.SourceType.MANUFACTURING_COST,source_id=movement.id,reference=reference,description=description or "Material returned from WIP");_finish(movement,journal,user);audit=ProductionCostTransaction.objects.create(organisation=organisation,production_order_id=production_order_id,transaction_date=return_date,cost_type="return",source_type="stock_movement",source_id=movement.id,amount=-amount,journal_entry=journal,description=description,created_by=user);return {"movement":movement,"cost_transaction":audit,"journal":journal}
@transaction.atomic
def receive_finished_goods_from_wip(*,organisation,product,warehouse,quantity,total_cost,completion_date,wip_account,user,production_order_id=None,reference="",description="",check_permissions=True):
 if check_permissions: require_organisation_permission(organisation=organisation,user=user,permission=ISSUE_MATERIALS)
 quantity,inventory=_validate(organisation,product,warehouse,quantity,wip_account,completion_date);total_cost=Decimal(str(total_cost))
 if total_cost<0:raise BusinessRuleError("Total cost cannot be negative.")
 unit=total_cost/quantity;movement=_movement(organisation=organisation,product=product,warehouse=warehouse,date=completion_date,kind=StockMovement.MovementType.PRODUCTION_COMPLETION,quantity=quantity,unit_cost=unit,user=user,production_order_id=production_order_id,reference=reference,description=description or "Production completion");cost_stock_movement(organisation=organisation,movement=movement);amount=total_cost.quantize(Decimal(".01"),rounding=ROUND_HALF_UP);journal=_journal(organisation=organisation,date=completion_date,debit=inventory,credit=wip_account,amount=amount,user=user,source_type=JournalEntry.SourceType.MANUFACTURING_COMPLETION,source_id=movement.id,reference=reference,description=description or "Finished goods from WIP");_finish(movement,journal,user);audit=ProductionCostTransaction.objects.create(organisation=organisation,production_order_id=production_order_id,transaction_date=completion_date,cost_type="completion",source_type="stock_movement",source_id=movement.id,amount=-amount,journal_entry=journal,description=description,created_by=user);return {"movement":movement,"cost_transaction":audit,"journal":journal}
