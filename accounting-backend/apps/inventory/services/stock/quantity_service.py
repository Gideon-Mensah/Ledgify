from decimal import Decimal

from django.db.models import Sum

from common.exceptions import BusinessRuleError
from apps.inventory.models import StockMovement, Warehouse


ZERO = Decimal("0.0000")
INFLOWS = {
    StockMovement.MovementType.OPENING,
    StockMovement.MovementType.PURCHASE_RECEIPT,
    StockMovement.MovementType.ADJUSTMENT_IN,
    StockMovement.MovementType.TRANSFER_IN,
    StockMovement.MovementType.RETURN_IN,
}
OUTFLOWS = {
    StockMovement.MovementType.SALE_ISSUE,
    StockMovement.MovementType.ADJUSTMENT_OUT,
    StockMovement.MovementType.TRANSFER_OUT,
    StockMovement.MovementType.RETURN_OUT,
}


def get_stock_quantity(*, organisation, product, warehouse=None, as_of_date=None):
    if product.organisation_id != organisation.id:
        raise BusinessRuleError("Product does not belong to this organisation.")
    if warehouse is not None and warehouse.organisation_id != organisation.id:
        raise BusinessRuleError("Warehouse does not belong to this organisation.")
    queryset = StockMovement.objects.filter(
        organisation=organisation, product=product,
        status=StockMovement.Status.POSTED,
    )
    if warehouse is not None:
        queryset = queryset.filter(warehouse=warehouse)
    if as_of_date is not None:
        queryset = queryset.filter(movement_date__lte=as_of_date)
    incoming = queryset.filter(movement_type__in=INFLOWS).aggregate(
        total=Sum("quantity")
    )["total"] or ZERO
    outgoing = queryset.filter(movement_type__in=OUTFLOWS).aggregate(
        total=Sum("quantity")
    )["total"] or ZERO
    return incoming - outgoing


def get_product_stock_summary(*, organisation, product):
    warehouses = Warehouse.objects.filter(
        organisation=organisation,
    ).order_by("code", "id")
    rows = [{
        "warehouse_id": str(warehouse.id),
        "warehouse_code": warehouse.code,
        "warehouse_name": warehouse.name,
        "quantity": get_stock_quantity(
            organisation=organisation, product=product, warehouse=warehouse,
        ),
    } for warehouse in warehouses]
    return {
        "product_id": str(product.id),
        "total_quantity": sum((item["quantity"] for item in rows), ZERO),
        "warehouses": rows,
    }
