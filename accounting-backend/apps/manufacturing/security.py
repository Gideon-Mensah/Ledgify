"""Validate persisted relationships before manufacturing services read or post them."""
from common.exceptions import BusinessRuleError


def check_owned(organisation, *objects):
    for obj in objects:
        if obj is not None and obj.organisation_id != organisation.pk:
            raise BusinessRuleError("Invalid manufacturing relationship for this organisation.")


def check_version(organisation, version):
    check_owned(organisation, version.bom, version.bom.product)
    for component in version.components.select_related("component_product"):
        check_owned(organisation, component.component_product)


def check_order(organisation, order):
    check_owned(organisation, order, order.product, order.warehouse, order.wip_account, order.variance_account)
    check_version(organisation, order.bom_version)
    if order.bom_version.bom.product_id != order.product_id:
        raise BusinessRuleError("BOM version does not match the production product.")
    for component in order.components.select_related("product", "bom_component__bom_version__bom"):
        check_owned(organisation, component.product)
        if component.bom_component_id:
            check_owned(organisation, component.bom_component.bom_version.bom)
