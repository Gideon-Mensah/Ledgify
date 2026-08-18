from decimal import Decimal, ROUND_HALF_UP

from django.db import models, transaction
from django.utils import timezone

from common.exceptions import BusinessRuleError
from apps.accounting.models import Account
from apps.inventory.services.workflows import receive_purchase
from apps.inventory.models import InventoryTransaction
from apps.purchases.models import PurchaseOrder, PurchaseOrderLine
from apps.purchases.services.bills import create_bill


def money(value): return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


@transaction.atomic
def create_purchase_order(*, organisation, supplier, purchase_order_number,
                          order_date, currency, lines, user,
                          expected_delivery_date=None, supplier_reference="", notes=""):
    if supplier.organisation_id != organisation.id or not supplier.is_supplier or supplier.status != "active":
        raise BusinessRuleError("Supplier must be active and belong to this organisation.")
    order=PurchaseOrder.objects.create(organisation=organisation, supplier=supplier,
        purchase_order_number=purchase_order_number, order_date=order_date,
        expected_delivery_date=expected_delivery_date, currency=currency.upper(),
        supplier_reference=supplier_reference, notes=notes, created_by=user)
    subtotal=Decimal("0"); objects=[]
    for line in lines:
        product=line.get("product"); account=line.get("expense_account")
        if product and product.organisation_id != organisation.id: raise BusinessRuleError("Product belongs to another organisation.")
        if account and (account.organisation_id != organisation.id or account.status != Account.Status.ACTIVE): raise BusinessRuleError("Purchase account is invalid.")
        quantity=Decimal(str(line.get("quantity", 0))); price=Decimal(str(line.get("unit_price", 0))); discount=money(line.get("discount_amount", 0))
        if quantity <= 0 or price < 0 or discount < 0 or Decimal(str(line.get("tax_rate", 0))) != 0: raise BusinessRuleError("Line values are invalid; tax must remain zero.")
        total=money(quantity*price-discount); subtotal += total
        objects.append(PurchaseOrderLine(purchase_order=order, product=product,
            expense_account=account, description=line["description"], quantity=quantity,
            unit_price=price, discount_amount=discount, line_total=total))
    PurchaseOrderLine.objects.bulk_create(objects); order.subtotal=money(subtotal); order.total=money(subtotal)
    order.save(update_fields=["subtotal", "total", "updated_at"]); return order


@transaction.atomic
def approve_purchase_order(*, organisation, purchase_order, user):
    order=PurchaseOrder.objects.select_for_update().get(pk=purchase_order.pk, organisation=organisation)
    if order.status != PurchaseOrder.Status.DRAFT: raise BusinessRuleError("Only draft purchase orders can be approved.")
    order.status=PurchaseOrder.Status.APPROVED; order.approved_by=user; order.approved_at=timezone.now()
    order.save(update_fields=["status", "approved_by", "approved_at", "updated_at"]); return order


@transaction.atomic
def receive_purchase_order_line(*, organisation, line, warehouse, quantity,
                                transaction_date, grni_account, user):
    line=PurchaseOrderLine.objects.select_for_update().select_related("purchase_order", "product").get(pk=line.pk)
    order=line.purchase_order
    if order.organisation_id != organisation.id or order.status not in {PurchaseOrder.Status.APPROVED, PurchaseOrder.Status.PARTLY_RECEIVED}:
        raise BusinessRuleError("Purchase order is not available for receipt.")
    quantity=Decimal(str(quantity)); remaining=line.quantity-line.quantity_received
    if not line.product or not line.product.track_inventory or quantity <= 0 or quantity > remaining:
        raise BusinessRuleError("Receipt quantity or product is invalid.")
    receipt=receive_purchase(organisation=organisation, product=line.product, warehouse=warehouse,
        receipt_date=transaction_date, quantity=quantity, unit_cost=line.unit_price,
        grni_account=grni_account, source_document_id=order.id,
        reference=order.purchase_order_number, description=line.description, user=user)
    line.quantity_received += quantity; line.save(update_fields=["quantity_received"])
    complete=not order.lines.exclude(quantity_received=models.F("quantity")).exists()
    order.status=PurchaseOrder.Status.RECEIVED if complete else PurchaseOrder.Status.PARTLY_RECEIVED
    order.save(update_fields=["status", "updated_at"]); return receipt


@transaction.atomic
def convert_purchase_order_to_bill(*, organisation, purchase_order, user,
                                   bill_number, issue_date, due_date):
    order=PurchaseOrder.objects.select_for_update().prefetch_related(
        "lines__expense_account", "lines__product").get(pk=purchase_order.pk, organisation=organisation)
    if order.bill_id or order.status not in {PurchaseOrder.Status.APPROVED,
            PurchaseOrder.Status.PARTLY_RECEIVED, PurchaseOrder.Status.RECEIVED}:
        raise BusinessRuleError("Purchase order cannot be billed.")
    lines=[]
    for line in order.lines.all():
        if line.product and line.product.track_inventory:
            receipts=list(InventoryTransaction.objects.filter(
                organisation=organisation,
                transaction_type=InventoryTransaction.TransactionType.PURCHASE_RECEIPT,
                source_document_id=order.id, product=line.product,
            ).exclude(supplier_bill_line__isnull=False))
            if not receipts: raise BusinessRuleError("Inventory purchase lines must be received before billing.")
            for receipt in receipts:
                lines.append({"description": line.description, "quantity": receipt.quantity,
                    "unit_price": receipt.unit_cost, "discount_amount": Decimal("0"),
                    "tax_rate": Decimal("0"), "expense_account": receipt.debit_credit_account,
                    "inventory_receipt": receipt})
        else:
            if line.expense_account is None: raise BusinessRuleError("Non-inventory PO line requires an expense account.")
            lines.append({"description": line.description, "quantity": line.quantity,
                "unit_price": line.unit_price, "discount_amount": line.discount_amount,
                "tax_rate": Decimal("0"), "expense_account": line.expense_account})
    bill=create_bill(organisation=organisation, supplier=order.supplier,
        bill_number=bill_number, issue_date=issue_date, due_date=due_date,
        currency=order.currency, supplier_reference=order.supplier_reference,
        notes=order.notes, lines=lines, user=user)
    order.bill=bill; order.status=PurchaseOrder.Status.BILLED
    order.lines.update(quantity_billed=models.F("quantity"))
    order.save(update_fields=["bill", "status", "updated_at"]); return bill
