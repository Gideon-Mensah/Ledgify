"""Post controlled stock adjustments with inventory and offset-account journals."""

from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.utils import timezone

from common.exceptions import BusinessRuleError
from apps.accounting.models import Account, JournalEntry
from apps.accounting.services.journals import (
    create_journal_entry, post_journal_entry, reverse_journal_entry,
)
from apps.inventory.models import Product, StockMovement, Warehouse
from apps.inventory.services.stock import get_stock_quantity
from apps.inventory.services.costing import cost_stock_movement
from apps.organisations.permissions import ADJUST_STOCK
from apps.organisations.services import require_organisation_permission


ZERO = Decimal("0.00")


def _decimal(value, label):
    try:
        return Decimal(str(value))
    except (ValueError, TypeError, ArithmeticError) as error:
        raise BusinessRuleError(f"{label} is invalid.") from error


@transaction.atomic
def create_stock_adjustment(
    *, organisation, product, warehouse, adjustment_date, adjustment_type,
    quantity, unit_cost, offset_account, user, reference="", description="",
    journal_source_type=JournalEntry.SourceType.INVENTORY_ADJUSTMENT,
):
    require_organisation_permission(
        organisation=organisation, user=user, permission=ADJUST_STOCK,
    )
    product = Product.objects.select_for_update().select_related(
        "inventory_asset_account"
    ).get(pk=product.pk)
    warehouse = Warehouse.objects.select_for_update().get(pk=warehouse.pk)
    if product.organisation_id != organisation.id:
        raise BusinessRuleError("Product does not belong to this organisation.")
    if product.status != Product.Status.ACTIVE or not product.track_inventory:
        raise BusinessRuleError("Product must be active and inventory-tracked.")
    if warehouse.organisation_id != organisation.id or warehouse.status != Warehouse.Status.ACTIVE:
        raise BusinessRuleError("Warehouse must be active and belong to this organisation.")
    if adjustment_type not in {
        StockMovement.MovementType.ADJUSTMENT_IN,
        StockMovement.MovementType.ADJUSTMENT_OUT,
    }:
        raise BusinessRuleError("Only stock adjustment-in or adjustment-out is supported.")
    quantity = _decimal(quantity, "Quantity")
    unit_cost = _decimal(unit_cost, "Unit cost")
    if quantity <= ZERO or unit_cost < ZERO:
        raise BusinessRuleError("Quantity must be positive and unit cost cannot be negative.")
    inventory_account = product.inventory_asset_account
    if (
        inventory_account is None
        or inventory_account.organisation_id != organisation.id
        or inventory_account.status != Account.Status.ACTIVE
        or inventory_account.account_type != Account.AccountType.ASSET
    ):
        raise BusinessRuleError("A valid active inventory asset account is required.")
    if (
        offset_account.organisation_id != organisation.id
        or offset_account.status != Account.Status.ACTIVE
    ):
        raise BusinessRuleError("Offset account must be active and belong to this organisation.")
    provisional_cost = (quantity * unit_cost).quantize(
        Decimal("0.0001"), rounding=ROUND_HALF_UP
    )
    movement = StockMovement.objects.create(
        organisation=organisation, product=product, warehouse=warehouse,
        movement_date=adjustment_date, movement_type=adjustment_type,
        quantity=quantity, unit_cost=unit_cost, total_cost=provisional_cost,
        reference=reference, description=description,
        source_type=StockMovement.SourceType.MANUAL,
        status=StockMovement.Status.DRAFT, created_by=user,
    )
    costing = cost_stock_movement(organisation=organisation, movement=movement)
    cost_used = costing["cost_used"]
    if adjustment_type == StockMovement.MovementType.ADJUSTMENT_OUT:
        movement.unit_cost = costing["unit_cost"]
        movement.total_cost = costing["cost_used"]
        movement.save(update_fields=["unit_cost", "total_cost", "updated_at"])
    amount = cost_used.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if adjustment_type == StockMovement.MovementType.ADJUSTMENT_IN:
        lines = [
            {"account": inventory_account, "description": description or "Stock adjustment in",
             "debit": amount, "credit": ZERO},
            {"account": offset_account, "description": description or "Stock adjustment in",
             "debit": ZERO, "credit": amount},
        ]
    else:
        lines = [
            {"account": offset_account, "description": description or "Stock adjustment out",
             "debit": amount, "credit": ZERO},
            {"account": inventory_account, "description": description or "Stock adjustment out",
             "debit": ZERO, "credit": amount},
        ]
    journal = None
    if amount > ZERO:
        journal = create_journal_entry(
            organisation=organisation, date=adjustment_date,
            description=description or f"Stock adjustment - {product.code}",
            reference=reference, source_type=journal_source_type,
            source_id=movement.id, user=user, lines=lines,
        )
        post_journal_entry(journal_entry=journal, user=user)
    movement.accounting_journal = journal
    movement.status = StockMovement.Status.POSTED
    movement.posted_by = user
    movement.posted_at = timezone.now()
    movement.save(update_fields=[
        "accounting_journal", "status", "posted_by", "posted_at", "updated_at",
    ])
    return movement


@transaction.atomic
def reverse_stock_movement(*, movement, user, reversal_date=None):
    movement = StockMovement.objects.select_for_update().select_related(
        "organisation", "accounting_journal"
    ).get(pk=movement.pk)
    require_organisation_permission(
        organisation=movement.organisation, user=user, permission=ADJUST_STOCK,
    )
    if movement.source_type != StockMovement.SourceType.MANUAL:
        raise BusinessRuleError("Only manual stock adjustments can be reversed.")
    if movement.status != StockMovement.Status.POSTED:
        raise BusinessRuleError("Only posted movements can be reversed.")
    if hasattr(movement, "reversal_movement"):
        raise BusinessRuleError("This stock movement has already been reversed.")
    opposite = {
        StockMovement.MovementType.ADJUSTMENT_IN: StockMovement.MovementType.ADJUSTMENT_OUT,
        StockMovement.MovementType.ADJUSTMENT_OUT: StockMovement.MovementType.ADJUSTMENT_IN,
    }.get(movement.movement_type)
    if opposite is None:
        raise BusinessRuleError("This movement type cannot be reversed.")
    reversal_date = reversal_date or timezone.localdate()
    if opposite == StockMovement.MovementType.ADJUSTMENT_OUT:
        available = get_stock_quantity(
            organisation=movement.organisation, product=movement.product,
            warehouse=movement.warehouse, as_of_date=reversal_date,
        )
        if movement.quantity > available:
            raise BusinessRuleError("Movement reversal would create negative stock.")
    reversal_journal = None
    if movement.accounting_journal_id:
        reversal_journal = reverse_journal_entry(
            journal_entry=movement.accounting_journal, user=user,
            reversal_date=reversal_date, check_permissions=False,
        )
    reversal = StockMovement.objects.create(
        organisation=movement.organisation, product=movement.product,
        warehouse=movement.warehouse, movement_date=reversal_date,
        movement_type=opposite, quantity=movement.quantity, unit_cost=movement.unit_cost,
        total_cost=movement.total_cost, reference=movement.reference,
        description=f"Reversal: {movement.description}",
        source_type=StockMovement.SourceType.MANUAL, source_id=movement.id,
        status=StockMovement.Status.DRAFT, accounting_journal=reversal_journal,
        reversal_of=movement, created_by=user,
    )
    costing = cost_stock_movement(
        organisation=movement.organisation, movement=reversal,
    )
    if opposite == StockMovement.MovementType.ADJUSTMENT_OUT:
        reversal.unit_cost = costing["unit_cost"]
        reversal.total_cost = costing["cost_used"]
    reversal.status = StockMovement.Status.POSTED
    reversal.posted_by = user
    reversal.posted_at = timezone.now()
    reversal.save(update_fields=[
        "unit_cost", "total_cost", "status", "posted_by", "posted_at", "updated_at",
    ])
    return reversal
