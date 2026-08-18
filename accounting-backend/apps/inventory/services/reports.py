from datetime import timedelta
from decimal import Decimal

from django.db.models import Max, Sum
from django.utils import timezone

from apps.inventory.models import Product, StockMovement, Warehouse
from apps.inventory.services.stock import get_stock_quantity
from apps.inventory.services.valuation import get_inventory_valuation

ZERO = Decimal("0.0000")


def stock_on_hand(*, organisation, product=None, warehouse=None, as_of_date=None):
    products = Product.objects.filter(organisation=organisation, track_inventory=True)
    warehouses = Warehouse.objects.filter(organisation=organisation)
    if product: products = products.filter(pk=product.pk)
    if warehouse: warehouses = warehouses.filter(pk=warehouse.pk)
    return [{"product_id": str(item.id), "product_code": item.code, "product_name": item.name,
             "warehouse_id": str(location.id), "warehouse_code": location.code,
             "warehouse_name": location.name, "quantity": get_stock_quantity(
                 organisation=organisation, product=item, warehouse=location,
                 as_of_date=as_of_date)}
            for item in products for location in warehouses]


def movement_history(*, organisation, product=None, warehouse=None, start_date=None, end_date=None):
    rows = StockMovement.objects.filter(organisation=organisation).select_related("product", "warehouse")
    if product: rows = rows.filter(product=product)
    if warehouse: rows = rows.filter(warehouse=warehouse)
    if start_date: rows = rows.filter(movement_date__gte=start_date)
    if end_date: rows = rows.filter(movement_date__lte=end_date)
    return [{"id": str(row.id), "date": row.movement_date, "product_code": row.product.code,
             "product_name": row.product.name, "warehouse": row.warehouse.name,
             "movement_type": row.movement_type, "quantity": row.quantity,
             "unit_cost": row.unit_cost, "total_cost": row.total_cost,
             "reference": row.reference, "status": row.status} for row in rows]


def negative_stock(*, organisation, as_of_date=None):
    return [row for row in stock_on_hand(organisation=organisation, as_of_date=as_of_date)
            if row["quantity"] < ZERO]


def reorder_report(*, organisation):
    output = []
    for product in Product.objects.filter(organisation=organisation, track_inventory=True).select_related("preferred_supplier"):
        quantity = sum((get_stock_quantity(organisation=organisation, product=product,
            warehouse=warehouse) for warehouse in Warehouse.objects.filter(organisation=organisation)), ZERO)
        if quantity <= product.minimum_quantity:
            recommended = product.reorder_quantity
            if recommended <= ZERO and product.maximum_quantity is not None:
                recommended = max(product.maximum_quantity - quantity, ZERO)
            supplier = product.preferred_supplier
            output.append({"product": {"id": str(product.id), "code": product.code,
                "name": product.name}, "quantity_on_hand": quantity,
                "minimum_quantity": product.minimum_quantity,
                "maximum_quantity": product.maximum_quantity,
                "recommended_order_quantity": recommended,
                "preferred_supplier": None if supplier is None else {
                    "id": str(supplier.id), "name": supplier.name,
                    "account_number": supplier.account_number,
                }})
    return output


def movement_velocity(*, organisation, slow=True, days=90):
    since = timezone.localdate() - timedelta(days=days)
    outgoing = StockMovement.objects.filter(organisation=organisation,
        status=StockMovement.Status.POSTED, movement_date__gte=since,
        movement_type__in=[StockMovement.MovementType.SALE_ISSUE,
                           StockMovement.MovementType.RETURN_OUT,
                           StockMovement.MovementType.TRANSFER_OUT]).values("product_id").annotate(
                               quantity_moved=Sum("quantity"), last_movement=Max("movement_date"))
    values = {row["product_id"]: row for row in outgoing}
    rows = []
    for product in Product.objects.filter(organisation=organisation, track_inventory=True):
        metric = values.get(product.id, {"quantity_moved": ZERO, "last_movement": None})
        rows.append({"product_id": str(product.id), "product_code": product.code,
                     "product_name": product.name, **metric})
    return sorted(rows, key=lambda row: row["quantity_moved"], reverse=not slow)


__all__ = ["get_inventory_valuation", "stock_on_hand", "movement_history",
           "negative_stock", "reorder_report", "movement_velocity"]
