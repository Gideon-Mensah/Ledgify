"""Report production requirements, costs, WIP, completions, and variances."""

from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.db.models import Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone

from common.exceptions import BusinessRuleError
from apps.inventory.models import StockMovement
from apps.manufacturing.models import BOMVersion, BillOfMaterials, ProductionCostTransaction, ProductionOrder
from .bom_service import calculate_bom_cost, explode_bom
from .production_order_service import get_material_shortages, get_production_material_requirements, get_production_order_cost_summary


OPEN_STATUSES = ["draft", "released", "in_progress", "partly_completed"]


def _orders(organisation):
    return ProductionOrder.objects.filter(organisation=organisation).select_related(
        "product", "warehouse", "bom_version", "variance_account"
    )


def _month(value):
    return value.strftime("%Y-%m") if value else ""


def manufacturing_dashboard(*, organisation):
    today = timezone.localdate()
    month_start = today.replace(day=1)
    open_orders = _orders(organisation).filter(status__in=OPEN_STATUSES)
    costs = ProductionCostTransaction.objects.filter(organisation=organisation)
    current_wip = sum(
        (get_production_order_cost_summary(organisation=organisation, production_order=order)["current_wip"] for order in _orders(organisation).exclude(status__in=["closed", "cancelled"])),
        Decimal("0"),
    )
    shortages = get_material_shortages(organisation=organisation)
    production = StockMovement.objects.filter(
        organisation=organisation, movement_type=StockMovement.MovementType.PRODUCTION_COMPLETION,
        status=StockMovement.Status.POSTED,
    ).annotate(month=TruncMonth("movement_date")).values("month").annotate(quantity=Sum("quantity"), value=Sum("total_cost")).order_by("month")
    monthly_costs = costs.annotate(month=TruncMonth("transaction_date")).values("month", "cost_type").annotate(total=Sum("amount")).order_by("month")
    consumption = defaultdict(lambda: Decimal("0")); wip_delta = defaultdict(lambda: Decimal("0"))
    for row in monthly_costs:
        key = _month(row["month"]); amount = row["total"] or Decimal("0")
        wip_delta[key] += amount
        if row["cost_type"] in {"material", "return"}: consumption[key] += amount
    running = Decimal("0"); wip_trend = []
    for key in sorted(wip_delta):
        running += wip_delta[key]; wip_trend.append({"month": key, "value": running})
    variance = costs.filter(cost_type="variance").aggregate(total=Sum("amount"))["total"] or Decimal("0")
    return {
        "kpis": {
            "open_production_orders": open_orders.count(),
            "released_orders": open_orders.filter(status="released").count(),
            "orders_in_progress": open_orders.filter(status__in=["in_progress", "partly_completed"]).count(),
            "completed_this_month": _orders(organisation).filter(completed_at__date__gte=month_start).count(),
            "current_wip_value": current_wip,
            "production_variance": variance,
            "material_shortages": len(shortages),
            "orders_due_this_week": open_orders.filter(due_date__range=(today, today + timedelta(days=7))).count(),
        },
        "production_by_month": [{"month": _month(row["month"]), "quantity": row["quantity"], "value": row["value"]} for row in production],
        "wip_trend": wip_trend,
        "material_consumption": [{"month": key, "value": value} for key, value in sorted(consumption.items())],
        "finished_goods_output": [{"month": _month(row["month"]), "quantity": row["quantity"]} for row in production],
    }


def bom_cost_report(*, organisation):
    rows = []
    for version in BOMVersion.objects.filter(bom__organisation=organisation, status="active").select_related("bom", "bom__product"):
        cost = calculate_bom_cost(organisation=organisation, bom_version=version)
        rows.append({"bom_code": version.bom.code, "bom_name": version.bom.name, "product": version.bom.product.name, "version": version.version_number, "output_quantity": version.output_quantity, "material_cost": cost["material_cost"], "cost_per_output_unit": cost["cost_per_output_unit"]})
    return rows


def bom_explosion_report(*, organisation, product_id, quantity, production_date):
    bom = BillOfMaterials.objects.filter(organisation=organisation, product_id=product_id).first()
    if not bom: raise BusinessRuleError("BOM product was not found.")
    return explode_bom(organisation=organisation, product=bom.product, quantity=quantity, production_date=production_date)


def material_requirements_report(*, organisation, shortages_only=False):
    rows = []
    for order in _orders(organisation).filter(status__in=["released", "in_progress", "partly_completed"]):
        requirements = get_material_shortages(organisation=organisation, production_order=order) if shortages_only else get_production_material_requirements(organisation=organisation, production_order=order)
        for item in requirements:
            rows.append({"order_number": order.order_number, "due_date": order.due_date, "product_code": item["product"]["code"], "product_name": item["product"]["name"], **{key: value for key, value in item.items() if key not in {"id", "product"}}})
    return rows


def wip_report(*, organisation):
    rows = []
    for order in _orders(organisation).exclude(status__in=["closed", "cancelled"]):
        summary = get_production_order_cost_summary(organisation=organisation, production_order=order)
        rows.append({"order_number": order.order_number, "product": order.product.name, "status": order.status, "planned_quantity": order.planned_quantity, "completed_quantity": order.completed_quantity, **summary})
    return rows


def variance_report(*, organisation):
    rows = []
    transactions = ProductionCostTransaction.objects.filter(organisation=organisation, cost_type="variance").order_by("-transaction_date")
    orders = {str(order.id): order for order in _orders(organisation)}
    for item in transactions:
        order = orders.get(str(item.production_order_id))
        rows.append({"date": item.transaction_date, "order_number": order.order_number if order else "—", "product": order.product.name if order else "—", "variance": -item.amount, "journal_id": str(item.journal_entry_id) if item.journal_entry_id else None})
    return rows


def material_usage_report(*, organisation):
    rows = []
    transactions = ProductionCostTransaction.objects.filter(organisation=organisation, cost_type__in=["material", "return"]).order_by("-transaction_date")
    orders = {str(order.id): order for order in _orders(organisation)}
    movements = {str(item.id): item for item in StockMovement.objects.filter(organisation=organisation, id__in=[row.source_id for row in transactions if row.source_id]).select_related("product", "warehouse")}
    for item in transactions:
        order, movement = orders.get(str(item.production_order_id)), movements.get(str(item.source_id))
        rows.append({"date": item.transaction_date, "order_number": order.order_number if order else "—", "product": movement.product.name if movement else "—", "warehouse": movement.warehouse.name if movement else "—", "type": item.cost_type, "quantity": movement.quantity if movement else None, "cost": item.amount})
    return rows


def finished_goods_output_report(*, organisation):
    return [{"date": row.movement_date, "order_id": str(row.source_id) if row.source_id else None, "product_code": row.product.code, "product": row.product.name, "warehouse": row.warehouse.name, "quantity": row.quantity, "unit_cost": row.unit_cost, "total_cost": row.total_cost} for row in StockMovement.objects.filter(organisation=organisation, movement_type="production_completion", status="posted").select_related("product", "warehouse").order_by("-movement_date")]
