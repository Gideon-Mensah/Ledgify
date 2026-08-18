"""Allocate Work in Progress into finished goods and post production variances."""

from decimal import Decimal, ROUND_HALF_UP
from django.db import transaction
from django.utils import timezone
from common.exceptions import BusinessRuleError
from apps.accounting.models import Account, JournalEntry
from apps.accounting.services.journals import create_journal_entry, post_journal_entry
from apps.accounting.services.periods import validate_period_open
from apps.manufacturing.models import ProductionCostTransaction, ProductionOrder
from apps.manufacturing.services.material_issue_service import receive_finished_goods_from_wip
from apps.manufacturing.services.production_order_service import get_production_order_cost_summary
from apps.organisations.permissions import CLOSE_PRODUCTION_ORDER, COMPLETE_PRODUCTION, POST_PRODUCTION_COSTS
from apps.organisations.services import require_organisation_permission

ZERO=Decimal("0.00");MONEY=Decimal("0.01")
def money(value):return Decimal(str(value)).quantize(MONEY,rounding=ROUND_HALF_UP)
def scope(org,order):
 if order.organisation_id!=org.id:raise BusinessRuleError("Production order belongs to another organisation.")
def valid_account(org,account):
 if not account or account.organisation_id!=org.id or account.status!=Account.Status.ACTIVE:raise BusinessRuleError("Production account must be active and organisation-scoped.")
@transaction.atomic
def _add(*,organisation,production_order,date,amount,source_account,user,cost_type,description=""):
 order=ProductionOrder.objects.select_for_update().select_related("wip_account").get(pk=production_order.pk);scope(organisation,order);require_organisation_permission(organisation=organisation,user=user,permission=POST_PRODUCTION_COSTS);validate_period_open(organisation,date);valid_account(organisation,source_account);amount=money(amount)
 # Late invoices and allocations may be posted after the last physical receipt,
 # but never after the order has been closed. Close resolves that residual WIP.
 if order.status not in {"released","in_progress","partly_completed","completed"} or amount<=0:raise BusinessRuleError("Production order or cost amount is invalid.")
 journal=create_journal_entry(organisation=organisation,date=date,description=description or f"Production {cost_type}",reference=order.order_number,source_type=JournalEntry.SourceType.MANUFACTURING_COST,source_id=order.id,user=user,lines=[{"account":order.wip_account,"debit":amount,"credit":ZERO},{"account":source_account,"debit":ZERO,"credit":amount}]);post_journal_entry(journal_entry=journal,user=user)
 return ProductionCostTransaction.objects.create(organisation=organisation,production_order_id=order.id,transaction_date=date,cost_type=cost_type,source_type="manual_allocation",amount=amount,journal_entry=journal,description=description,created_by=user)
def add_labour_cost(**kwargs):return _add(cost_type="labour",**kwargs)
def add_overhead_cost(**kwargs):return _add(cost_type="overhead",**kwargs)
def add_subcontract_cost(**kwargs):return _add(cost_type="subcontract",**kwargs)
def get_current_wip(*,organisation,production_order):return get_production_order_cost_summary(organisation=organisation,production_order=production_order)["current_wip"]
@transaction.atomic
def complete_production(*,organisation,production_order,quantity_completed,completion_date,destination_warehouse,user,reference=""):
 require_organisation_permission(organisation=organisation,user=user,permission=COMPLETE_PRODUCTION);order=ProductionOrder.objects.select_for_update().select_related("product","wip_account").get(pk=production_order.pk);scope(organisation,order);validate_period_open(organisation,completion_date);qty=Decimal(str(quantity_completed));cumulative=order.completed_quantity+qty
 if order.status not in {"released","in_progress","partly_completed"} or qty<=0 or cumulative>order.planned_quantity:raise BusinessRuleError("Production completion is invalid.")
 if destination_warehouse.organisation_id!=organisation.id or destination_warehouse.status!="active":raise BusinessRuleError("Destination warehouse is invalid.")
 summary=get_production_order_cost_summary(organisation=organisation,production_order=order);eligible=summary["net_material_cost"]+summary["labour_cost"]+summary["overhead_cost"]+summary["subcontract_cost"];prior=summary["completion_transfers"]
 transfer=money(eligible-prior) if cumulative==order.planned_quantity else money(eligible*cumulative/order.planned_quantity-prior)
 if transfer<=0:raise BusinessRuleError("There is no positive WIP cost available for this completion.")
 result=receive_finished_goods_from_wip(organisation=organisation,product=order.product,warehouse=destination_warehouse,quantity=qty,total_cost=transfer,completion_date=completion_date,wip_account=order.wip_account,user=user,production_order_id=order.id,reference=reference or order.order_number,description=f"Production completion {order.order_number}",check_permissions=False)
 order.completed_quantity=cumulative;order.status="completed" if cumulative==order.planned_quantity else "partly_completed";fields=["completed_quantity","status","updated_at"]
 if order.status=="completed":order.completed_at=timezone.now();fields.append("completed_at")
 order.save(update_fields=fields);return {"production_order":order,"transfer_amount":transfer,**result}
@transaction.atomic
def close_production_order(*,organisation,production_order,close_date,user):
 require_organisation_permission(organisation=organisation,user=user,permission=CLOSE_PRODUCTION_ORDER);order=ProductionOrder.objects.select_for_update().select_related("wip_account","variance_account").get(pk=production_order.pk);scope(organisation,order);validate_period_open(organisation,close_date)
 if order.status!="completed" or order.completed_quantity!=order.planned_quantity:raise BusinessRuleError("Only fully completed production orders can be closed.")
 remaining=money(get_current_wip(organisation=organisation,production_order=order));variance=None
 if remaining:
  valid_account(organisation,order.variance_account);amount=abs(remaining);debit,credit=(order.variance_account,order.wip_account) if remaining>0 else (order.wip_account,order.variance_account);journal=create_journal_entry(organisation=organisation,date=close_date,description=f"Production variance {order.order_number}",reference=order.order_number,source_type=JournalEntry.SourceType.MANUFACTURING_VARIANCE,source_id=order.id,user=user,lines=[{"account":debit,"debit":amount,"credit":ZERO},{"account":credit,"debit":ZERO,"credit":amount}]);post_journal_entry(journal_entry=journal,user=user);variance=ProductionCostTransaction.objects.create(organisation=organisation,production_order_id=order.id,transaction_date=close_date,cost_type="variance",source_type="close",amount=-remaining,journal_entry=journal,description="Production variance clearing",created_by=user)
 if money(get_current_wip(organisation=organisation,production_order=order)):raise BusinessRuleError("Production WIP was not resolved.")
 order.status="closed";order.closed_at=timezone.now();order.save(update_fields=["status","closed_at","updated_at"]);return {"production_order":order,"variance_transaction":variance}
