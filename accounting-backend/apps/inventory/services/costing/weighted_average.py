"""Append perpetual weighted-average cost layers for inventory receipts and issues."""

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction

from common.exceptions import BusinessRuleError
from apps.inventory.models import InventoryCostLayer, Product, StockMovement, Warehouse


ZERO_QUANTITY = Decimal("0.0000")
ZERO_COST = Decimal("0.0000")
ZERO_AVERAGE = Decimal("0.00000000")
QUANTITY_QUANTUM = Decimal("0.0001")
COST_QUANTUM = Decimal("0.0001")
AVERAGE_QUANTUM = Decimal("0.00000001")


@dataclass(frozen=True)
class EmptyCostLayer:
    quantity_on_hand: Decimal = ZERO_QUANTITY
    total_cost: Decimal = ZERO_COST
    average_unit_cost: Decimal = ZERO_AVERAGE


def _decimal(value, label):
    try:
        return Decimal(str(value))
    except (ValueError, TypeError, ArithmeticError) as error:
        raise BusinessRuleError(f"{label} is invalid.") from error


def _validate_scope(organisation, product, warehouse, movement=None):
    if product.organisation_id != organisation.id:
        raise BusinessRuleError("Product does not belong to this organisation.")
    if warehouse.organisation_id != organisation.id:
        raise BusinessRuleError("Warehouse does not belong to this organisation.")
    if movement is not None and (
        movement.organisation_id != organisation.id
        or movement.product_id != product.id
        or movement.warehouse_id != warehouse.id
    ):
        raise BusinessRuleError("Stock movement does not match the costing scope.")


def get_current_cost_layer(
    *, organisation, product, warehouse, as_of_date=None, for_update=False
):
    _validate_scope(organisation, product, warehouse)
    # Cost is isolated by organisation, product, and warehouse. Ordering by all
    # three stable fields makes the selected historical layer deterministic.
    queryset = InventoryCostLayer.objects.filter(
        organisation=organisation, product=product, warehouse=warehouse,
    )
    if as_of_date is not None:
        queryset = queryset.filter(effective_date__lte=as_of_date)
    if for_update:
        queryset = queryset.select_for_update()
    return queryset.order_by("-effective_date", "-created_at", "-id").first() or EmptyCostLayer()


def _lock_scope(product, warehouse):
    # Serialise concurrent movements for the same stock location so that two
    # receipts or issues cannot calculate from the same old balance.
    Product.objects.select_for_update().get(pk=product.pk)
    Warehouse.objects.select_for_update().get(pk=warehouse.pk)


@transaction.atomic
def receive_inventory(*, organisation, product, warehouse, quantity, unit_cost, movement):
    _validate_scope(organisation, product, warehouse, movement)
    _lock_scope(product, warehouse)
    if movement.status != StockMovement.Status.DRAFT:
        raise BusinessRuleError("Costing can only be applied while a movement is draft.")
    if hasattr(movement, "cost_layer"):
        raise BusinessRuleError("This movement has already been costed.")
    quantity = _decimal(quantity, "Quantity")
    unit_cost = _decimal(unit_cost, "Unit cost")
    if quantity <= 0 or unit_cost < 0:
        raise BusinessRuleError("Quantity must be positive and unit cost cannot be negative.")
    current = get_current_cost_layer(
        organisation=organisation, product=product, warehouse=warehouse, for_update=True,
    )
    if not isinstance(current, EmptyCostLayer) and movement.movement_date < current.effective_date:
        raise BusinessRuleError("Inventory movements cannot be posted before the latest cost layer.")
    # Perpetual WAC receipt formula:
    # new value = old value + incoming value; average = new value / new quantity.
    new_quantity = (current.quantity_on_hand + quantity).quantize(QUANTITY_QUANTUM)
    incoming_cost = quantity * unit_cost
    new_total = (current.total_cost + incoming_cost).quantize(
        COST_QUANTUM, rounding=ROUND_HALF_UP
    )
    new_average = (new_total / new_quantity).quantize(
        AVERAGE_QUANTUM, rounding=ROUND_HALF_UP
    )
    return InventoryCostLayer.objects.create(
        organisation=organisation, product=product, warehouse=warehouse,
        movement=movement, quantity_on_hand=new_quantity, total_cost=new_total,
        average_unit_cost=new_average, effective_date=movement.movement_date,
    )


@transaction.atomic
def issue_inventory(*, organisation, product, warehouse, quantity, movement):
    _validate_scope(organisation, product, warehouse, movement)
    _lock_scope(product, warehouse)
    if movement.status != StockMovement.Status.DRAFT:
        raise BusinessRuleError("Costing can only be applied while a movement is draft.")
    if hasattr(movement, "cost_layer"):
        raise BusinessRuleError("This movement has already been costed.")
    quantity = _decimal(quantity, "Quantity")
    if quantity <= 0:
        raise BusinessRuleError("Quantity must be positive.")
    current = get_current_cost_layer(
        organisation=organisation, product=product, warehouse=warehouse, for_update=True,
    )
    if not isinstance(current, EmptyCostLayer) and movement.movement_date < current.effective_date:
        raise BusinessRuleError("Inventory movements cannot be posted before the latest cost layer.")
    # Negative stock is rejected before any cost layer is appended.
    if quantity > current.quantity_on_hand:
        raise BusinessRuleError("Inventory issue would create negative stock.")
    # Issues always use the current weighted average, never a purchase price.
    issued_cost = (quantity * current.average_unit_cost).quantize(
        COST_QUANTUM, rounding=ROUND_HALF_UP
    )
    new_quantity = (current.quantity_on_hand - quantity).quantize(QUANTITY_QUANTUM)
    if new_quantity == ZERO_QUANTITY:
        new_total = ZERO_COST
        new_average = ZERO_AVERAGE
    else:
        new_total = (current.total_cost - issued_cost).quantize(
            COST_QUANTUM, rounding=ROUND_HALF_UP
        )
        new_average = current.average_unit_cost
    # Cost history is append-only: the previous layer is never edited.
    layer = InventoryCostLayer.objects.create(
        organisation=organisation, product=product, warehouse=warehouse,
        movement=movement, quantity_on_hand=new_quantity, total_cost=new_total,
        average_unit_cost=new_average, effective_date=movement.movement_date,
    )
    return {
        "quantity_issued": quantity,
        "unit_cost": current.average_unit_cost,
        "cost_used": issued_cost,
        "remaining_quantity": new_quantity,
        "remaining_value": new_total,
        "layer": layer,
    }


def get_current_average_cost(*, organisation, product, warehouse, as_of_date=None):
    layer = get_current_cost_layer(
        organisation=organisation, product=product, warehouse=warehouse,
        as_of_date=as_of_date,
    )
    return {
        "quantity": layer.quantity_on_hand,
        "average_unit_cost": layer.average_unit_cost,
        "inventory_value": layer.total_cost,
    }


def cost_stock_movement(*, organisation, movement):
    # Route each posted movement by its economic direction. The receipt and
    # issue functions remain the single source of truth for the calculation.
    incoming_types = {
        StockMovement.MovementType.OPENING,
        StockMovement.MovementType.PURCHASE_RECEIPT,
        StockMovement.MovementType.ADJUSTMENT_IN,
        StockMovement.MovementType.TRANSFER_IN,
        StockMovement.MovementType.RETURN_IN,
        StockMovement.MovementType.PRODUCTION_MATERIAL_RETURN,
        StockMovement.MovementType.PRODUCTION_COMPLETION,
    }
    outgoing_types = {
        StockMovement.MovementType.SALE_ISSUE,
        StockMovement.MovementType.ADJUSTMENT_OUT,
        StockMovement.MovementType.TRANSFER_OUT,
        StockMovement.MovementType.RETURN_OUT,
        StockMovement.MovementType.PRODUCTION_MATERIAL_ISSUE,
        StockMovement.MovementType.PRODUCTION_SCRAP,
    }
    if movement.movement_type in incoming_types:
        layer = receive_inventory(
            organisation=organisation, product=movement.product,
            warehouse=movement.warehouse, quantity=movement.quantity,
            unit_cost=movement.unit_cost, movement=movement,
        )
        return {
            "unit_cost": movement.unit_cost,
            "cost_used": (movement.quantity * movement.unit_cost).quantize(
                COST_QUANTUM, rounding=ROUND_HALF_UP
            ),
            "layer": layer,
        }
    if movement.movement_type in outgoing_types:
        return issue_inventory(
            organisation=organisation, product=movement.product,
            warehouse=movement.warehouse, quantity=movement.quantity,
            movement=movement,
        )
    raise BusinessRuleError(
        "Weighted-average costing is not implemented for this movement type."
    )
