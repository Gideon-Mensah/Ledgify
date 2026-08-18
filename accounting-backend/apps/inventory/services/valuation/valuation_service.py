"""Value stock from immutable cost layers at the current or requested historical date."""

from decimal import Decimal

from common.exceptions import BusinessRuleError
from apps.inventory.models import Product, Warehouse
from apps.inventory.services.costing import get_current_average_cost


ZERO_QUANTITY = Decimal("0.0000")
ZERO_VALUE = Decimal("0.0000")
ZERO_AVERAGE = Decimal("0.00000000")


def get_inventory_valuation(
    *, organisation, product=None, warehouse=None, as_of_date=None
):
    if product is not None and product.organisation_id != organisation.id:
        raise BusinessRuleError("Product does not belong to this organisation.")
    if warehouse is not None and warehouse.organisation_id != organisation.id:
        raise BusinessRuleError("Warehouse does not belong to this organisation.")
    products = Product.objects.filter(
        organisation=organisation, track_inventory=True,
    ).order_by("code", "id")
    if product is not None:
        products = products.filter(pk=product.pk)
    warehouses = Warehouse.objects.filter(organisation=organisation).order_by("code", "id")
    if warehouse is not None:
        warehouses = warehouses.filter(pk=warehouse.pk)
    items = []
    for item in products:
        quantity = ZERO_QUANTITY
        value = ZERO_VALUE
        for location in warehouses:
            cost = get_current_average_cost(
                organisation=organisation, product=item, warehouse=location,
                as_of_date=as_of_date,
            )
            quantity += cost["quantity"]
            value += cost["inventory_value"]
        average = value / quantity if quantity > ZERO_QUANTITY else ZERO_AVERAGE
        items.append({
            "product_id": str(item.id), "product_code": item.code,
            "quantity": quantity, "average_cost": average,
            "average_unit_cost": average, "inventory_value": value,
            "value": value,
        })
    return {
        "method": "perpetual_weighted_average",
        "items": items,
        "quantity": sum((item["quantity"] for item in items), ZERO_QUANTITY),
        "value": sum((item["value"] for item in items), ZERO_VALUE),
    }
