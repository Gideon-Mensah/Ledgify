"""Coordinate inventory receipts, issues, returns, transfers, and their journals."""

from decimal import Decimal, ROUND_HALF_UP

from django.db import models, transaction
from django.utils import timezone

from common.exceptions import BusinessRuleError
from apps.accounting.models import Account, JournalEntry
from apps.accounting.services.journals import create_journal_entry, post_journal_entry
from apps.accounting.services.periods import validate_period_open
from apps.inventory.models import InventoryTransaction, StockCount, StockCountLine, StockMovement
from apps.inventory.services.adjustments import create_stock_adjustment
from apps.inventory.services.costing import cost_stock_movement, get_current_average_cost
from apps.inventory.services.stock import get_stock_quantity
from apps.organisations.permissions import ADJUST_STOCK
from apps.organisations.services import require_organisation_permission

ZERO = Decimal("0.00")


@transaction.atomic
def create_stock_count(*, organisation, warehouse, count_date, reference,
                       offset_account, products, user):
    require_organisation_permission(organisation=organisation, user=user, permission=ADJUST_STOCK)
    if warehouse.organisation_id != organisation.id or offset_account.organisation_id != organisation.id:
        raise BusinessRuleError("Warehouse and offset account must belong to this organisation.")
    if not products:
        raise BusinessRuleError("A stock count requires at least one product.")
    stock_count = StockCount.objects.create(
        organisation=organisation, warehouse=warehouse, count_date=count_date,
        reference=reference, offset_account=offset_account, status=StockCount.Status.DRAFT,
        created_by=user,
    )
    lines = []
    for product in products:
        if product.organisation_id != organisation.id or not product.track_inventory:
            raise BusinessRuleError("Every counted product must be inventory-tracked and organisation-scoped.")
        expected = get_stock_quantity(
            organisation=organisation, product=product, warehouse=warehouse,
            as_of_date=count_date,
        )
        lines.append(StockCountLine(
            stock_count=stock_count, product=product, expected_quantity=expected,
        ))
    StockCountLine.objects.bulk_create(lines)
    return stock_count


@transaction.atomic
def start_stock_count(*, stock_count, user):
    require_organisation_permission(
        organisation=stock_count.organisation, user=user, permission=ADJUST_STOCK,
    )
    if stock_count.status != StockCount.Status.DRAFT:
        raise BusinessRuleError("Only draft stock counts can begin counting.")
    stock_count.status = StockCount.Status.COUNTING
    stock_count.save(update_fields=["status"])
    return stock_count


def _validate(organisation, product, warehouse, quantity, account=None):
    require_ids = (product.organisation_id, warehouse.organisation_id)
    if any(value != organisation.id for value in require_ids):
        raise BusinessRuleError("Product and warehouse must belong to this organisation.")
    if not product.track_inventory or product.status != product.Status.ACTIVE:
        raise BusinessRuleError("Product must be active and inventory-tracked.")
    if warehouse.status != warehouse.Status.ACTIVE:
        raise BusinessRuleError("Warehouse must be active.")
    quantity = Decimal(str(quantity))
    if quantity <= 0:
        raise BusinessRuleError("Quantity must be positive.")
    if account and (account.organisation_id != organisation.id or account.status != Account.Status.ACTIVE):
        raise BusinessRuleError("Accounting account must be active and organisation-scoped.")
    return quantity


def _validate_product_account(account, organisation, account_type, label):
    if (account is None or account.organisation_id != organisation.id
            or account.status != Account.Status.ACTIVE
            or account.account_type != account_type):
        raise BusinessRuleError(f"A valid active {label} account is required.")


def _movement(*, organisation, product, warehouse, date, kind, quantity, unit_cost,
              reference, description, source_type, user, source_id=None):
    return StockMovement.objects.create(
        organisation=organisation, product=product, warehouse=warehouse,
        movement_date=date, movement_type=kind, quantity=quantity,
        unit_cost=unit_cost, total_cost=quantity * unit_cost,
        reference=reference, description=description, source_type=source_type,
        source_id=source_id, status=StockMovement.Status.DRAFT, created_by=user,
    )


def _post_movement(movement, user, journal=None):
    movement.accounting_journal = journal
    movement.status = StockMovement.Status.POSTED
    movement.posted_by = user
    movement.posted_at = timezone.now()
    movement.save(update_fields=["accounting_journal", "status", "posted_by", "posted_at", "updated_at"])


def _journal(*, organisation, date, description, reference, source_id, source_type,
             user, debit, credit, amount):
    if amount == ZERO:
        return None
    journal = create_journal_entry(
        organisation=organisation, date=date, description=description,
        reference=reference, source_type=source_type,
        source_id=source_id, user=user,
        lines=[
            {"account": debit, "description": description, "debit": amount, "credit": ZERO},
            {"account": credit, "description": description, "debit": ZERO, "credit": amount},
        ],
    )
    post_journal_entry(journal_entry=journal, user=user)
    return journal


@transaction.atomic
def receive_purchase(*, organisation, product, warehouse, receipt_date, quantity,
                     unit_cost, grni_account, reference, user, description="",
                     source_document_id=None):
    require_organisation_permission(organisation=organisation, user=user, permission=ADJUST_STOCK)
    quantity = _validate(organisation, product, warehouse, quantity, grni_account)
    unit_cost = Decimal(str(unit_cost))
    if unit_cost < 0:
        raise BusinessRuleError("Unit cost cannot be negative.")
    _validate_product_account(
        product.inventory_asset_account, organisation, Account.AccountType.ASSET,
        "inventory asset",
    )
    movement = _movement(organisation=organisation, product=product, warehouse=warehouse,
        date=receipt_date, kind=StockMovement.MovementType.PURCHASE_RECEIPT,
        quantity=quantity, unit_cost=unit_cost, reference=reference,
        description=description or "Purchase receipt", source_type=StockMovement.SourceType.PURCHASE,
        source_id=source_document_id, user=user)
    costing = cost_stock_movement(organisation=organisation, movement=movement)
    amount = costing["cost_used"].quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    journal = _journal(organisation=organisation, date=receipt_date,
        description=description or f"Purchase receipt - {product.code}", reference=reference,
        source_id=movement.id, source_type=JournalEntry.SourceType.INVENTORY_RECEIPT,
        user=user, debit=product.inventory_asset_account,
        credit=grni_account, amount=amount)
    _post_movement(movement, user, journal)
    return InventoryTransaction.objects.create(organisation=organisation,
        transaction_type=InventoryTransaction.TransactionType.PURCHASE_RECEIPT,
        transaction_date=receipt_date, product=product, warehouse=warehouse,
        quantity=quantity, unit_cost=unit_cost, reference=reference, description=description,
        source_document_id=source_document_id,
        debit_credit_account=grni_account, primary_movement=movement,
        accounting_journal=journal, created_by=user)


@transaction.atomic
def issue_sale(*, organisation, product, warehouse, issue_date, quantity,
               invoice, reference, user, description=""):
    require_organisation_permission(organisation=organisation, user=user, permission=ADJUST_STOCK)
    quantity = _validate(organisation, product, warehouse, quantity)
    if invoice.organisation_id != organisation.id or not invoice.accounting_journal_id:
        raise BusinessRuleError("Sales issues require an approved organisation invoice.")
    _validate_product_account(
        product.inventory_asset_account, organisation, Account.AccountType.ASSET,
        "inventory asset",
    )
    _validate_product_account(
        product.cost_of_goods_sold_account, organisation, Account.AccountType.EXPENSE,
        "cost-of-goods-sold",
    )
    movement = _movement(organisation=organisation, product=product, warehouse=warehouse,
        date=issue_date, kind=StockMovement.MovementType.SALE_ISSUE, quantity=quantity,
        unit_cost=ZERO, reference=reference, description=description or "Sales issue",
        source_type=StockMovement.SourceType.SALE, user=user)
    costing = cost_stock_movement(organisation=organisation, movement=movement)
    movement.unit_cost = costing["unit_cost"]; movement.total_cost = costing["cost_used"]
    movement.save(update_fields=["unit_cost", "total_cost", "updated_at"])
    amount = costing["cost_used"].quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    journal = _journal(organisation=organisation, date=issue_date,
        description=description or f"COGS - {invoice.invoice_number}", reference=reference,
        source_id=movement.id, source_type=JournalEntry.SourceType.INVENTORY_ISSUE,
        user=user, debit=product.cost_of_goods_sold_account,
        credit=product.inventory_asset_account, amount=amount)
    _post_movement(movement, user, journal)
    return InventoryTransaction.objects.create(organisation=organisation,
        transaction_type=InventoryTransaction.TransactionType.SALES_ISSUE,
        transaction_date=issue_date, product=product, warehouse=warehouse,
        quantity=quantity, unit_cost=costing["unit_cost"], reference=reference,
        description=description, source_document_id=invoice.id,
        primary_movement=movement, accounting_journal=journal, created_by=user)


@transaction.atomic
def issue_inventory_transaction(*, organisation, product, warehouse, transaction_date,
                                quantity, source_document_id, reference, user,
                                description=""):
    require_organisation_permission(organisation=organisation, user=user, permission=ADJUST_STOCK)
    quantity = _validate(organisation, product, warehouse, quantity)
    _validate_product_account(product.inventory_asset_account, organisation,
                              Account.AccountType.ASSET, "inventory asset")
    _validate_product_account(product.cost_of_goods_sold_account, organisation,
                              Account.AccountType.EXPENSE, "cost-of-goods-sold")
    movement = _movement(
        organisation=organisation, product=product, warehouse=warehouse,
        date=transaction_date, kind=StockMovement.MovementType.SALE_ISSUE,
        quantity=quantity, unit_cost=ZERO, reference=reference,
        description=description or "Inventory fulfilment",
        source_type=StockMovement.SourceType.SALE, source_id=source_document_id, user=user,
    )
    costing = cost_stock_movement(organisation=organisation, movement=movement)
    movement.unit_cost = costing["unit_cost"]
    movement.total_cost = costing["cost_used"]
    movement.save(update_fields=["unit_cost", "total_cost", "updated_at"])
    amount = costing["cost_used"].quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    journal = _journal(
        organisation=organisation, date=transaction_date,
        description=description or f"Inventory fulfilment - {reference}",
        reference=reference, source_id=movement.id,
        source_type=JournalEntry.SourceType.INVENTORY_ISSUE, user=user,
        debit=product.cost_of_goods_sold_account,
        credit=product.inventory_asset_account, amount=amount,
    )
    _post_movement(movement, user, journal)
    return InventoryTransaction.objects.create(
        organisation=organisation,
        transaction_type=InventoryTransaction.TransactionType.SALES_ISSUE,
        transaction_date=transaction_date, product=product, warehouse=warehouse,
        quantity=quantity, unit_cost=costing["unit_cost"], reference=reference,
        description=description, source_document_id=source_document_id,
        primary_movement=movement, accounting_journal=journal, created_by=user,
    )


@transaction.atomic
def transfer_stock(*, organisation, product, source_warehouse, destination_warehouse,
                   transfer_date, quantity, reference, user, description=""):
    require_organisation_permission(organisation=organisation, user=user, permission=ADJUST_STOCK)
    validate_period_open(organisation, transfer_date)
    quantity = _validate(organisation, product, source_warehouse, quantity)
    _validate(organisation, product, destination_warehouse, quantity)
    if source_warehouse.id == destination_warehouse.id:
        raise BusinessRuleError("Transfer warehouses must be different.")
    current = get_current_average_cost(organisation=organisation, product=product, warehouse=source_warehouse)
    outgoing = _movement(organisation=organisation, product=product, warehouse=source_warehouse,
        date=transfer_date, kind=StockMovement.MovementType.TRANSFER_OUT, quantity=quantity,
        unit_cost=current["average_unit_cost"], reference=reference, description=description,
        source_type=StockMovement.SourceType.TRANSFER, user=user)
    cost = cost_stock_movement(organisation=organisation, movement=outgoing)
    outgoing.unit_cost = cost["unit_cost"]; outgoing.total_cost = cost["cost_used"]
    outgoing.save(update_fields=["unit_cost", "total_cost", "updated_at"]); _post_movement(outgoing, user)
    incoming = _movement(organisation=organisation, product=product, warehouse=destination_warehouse,
        date=transfer_date, kind=StockMovement.MovementType.TRANSFER_IN, quantity=quantity,
        unit_cost=cost["unit_cost"], reference=reference, description=description,
        source_type=StockMovement.SourceType.TRANSFER, user=user)
    cost_stock_movement(organisation=organisation, movement=incoming); _post_movement(incoming, user)
    return InventoryTransaction.objects.create(organisation=organisation,
        transaction_type=InventoryTransaction.TransactionType.TRANSFER,
        transaction_date=transfer_date, product=product, warehouse=source_warehouse,
        destination_warehouse=destination_warehouse, quantity=quantity,
        unit_cost=cost["unit_cost"], reference=reference, description=description,
        primary_movement=outgoing, secondary_movement=incoming, created_by=user)


@transaction.atomic
def return_customer_stock(*, organisation, product, warehouse, return_date, quantity,
                          invoice, original_issue, reference, user, description=""):
    require_organisation_permission(organisation=organisation, user=user, permission=ADJUST_STOCK)
    quantity = _validate(organisation, product, warehouse, quantity)
    _validate_product_account(
        product.inventory_asset_account, organisation, Account.AccountType.ASSET,
        "inventory asset",
    )
    _validate_product_account(
        product.cost_of_goods_sold_account, organisation, Account.AccountType.EXPENSE,
        "cost-of-goods-sold",
    )
    if (original_issue.organisation_id != organisation.id
            or original_issue.product_id != product.id
            or original_issue.movement_type != StockMovement.MovementType.SALE_ISSUE
            or original_issue.status != StockMovement.Status.POSTED):
        raise BusinessRuleError("A valid original sales issue is required.")
    linked_issue = InventoryTransaction.objects.filter(
        primary_movement=original_issue,
        transaction_type=InventoryTransaction.TransactionType.SALES_ISSUE,
        source_document_id=invoice.id,
    ).exists()
    if not linked_issue:
        raise BusinessRuleError("Return invoice does not match the original issue.")
    returned_quantity = StockMovement.objects.filter(
        organisation=organisation,
        movement_type=StockMovement.MovementType.RETURN_IN,
        source_id=original_issue.id,
        status=StockMovement.Status.POSTED,
    ).aggregate(total=models.Sum("quantity"))["total"] or ZERO
    if returned_quantity + quantity > original_issue.quantity:
        raise BusinessRuleError("Return quantity exceeds the unreturned sales issue quantity.")
    movement = _movement(organisation=organisation, product=product, warehouse=warehouse,
        date=return_date, kind=StockMovement.MovementType.RETURN_IN, quantity=quantity,
        unit_cost=original_issue.unit_cost, reference=reference, description=description,
        source_type=StockMovement.SourceType.RETURN, source_id=original_issue.id, user=user)
    cost = cost_stock_movement(organisation=organisation, movement=movement)
    amount = cost["cost_used"].quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    journal = _journal(organisation=organisation, date=return_date,
        description=description or f"Customer return - {invoice.invoice_number}", reference=reference,
        source_id=movement.id, source_type=JournalEntry.SourceType.CUSTOMER_RETURN,
        user=user, debit=product.inventory_asset_account,
        credit=product.cost_of_goods_sold_account, amount=amount)
    _post_movement(movement, user, journal)
    return InventoryTransaction.objects.create(organisation=organisation,
        transaction_type=InventoryTransaction.TransactionType.CUSTOMER_RETURN,
        transaction_date=return_date, product=product, warehouse=warehouse,
        quantity=quantity, unit_cost=original_issue.unit_cost, reference=reference,
        description=description, source_document_id=invoice.id, primary_movement=movement,
        accounting_journal=journal, created_by=user)


@transaction.atomic
def return_supplier_stock(*, organisation, product, warehouse, return_date, quantity,
                          settlement_account, reference, user, description="",
                          original_receipt=None):
    require_organisation_permission(organisation=organisation, user=user, permission=ADJUST_STOCK)
    quantity = _validate(organisation, product, warehouse, quantity, settlement_account)
    _validate_product_account(
        product.inventory_asset_account, organisation, Account.AccountType.ASSET,
        "inventory asset",
    )
    if original_receipt is not None:
        if (original_receipt.organisation_id != organisation.id
                or original_receipt.product_id != product.id
                or original_receipt.movement_type != StockMovement.MovementType.PURCHASE_RECEIPT
                or original_receipt.status != StockMovement.Status.POSTED):
            raise BusinessRuleError("A valid original purchase receipt is required.")
        returned_quantity = StockMovement.objects.filter(
            organisation=organisation,
            movement_type=StockMovement.MovementType.RETURN_OUT,
            source_id=original_receipt.id,
            status=StockMovement.Status.POSTED,
        ).aggregate(total=models.Sum("quantity"))["total"] or ZERO
        if returned_quantity + quantity > original_receipt.quantity:
            raise BusinessRuleError("Return quantity exceeds the unreturned receipt quantity.")
    movement = _movement(organisation=organisation, product=product, warehouse=warehouse,
        date=return_date, kind=StockMovement.MovementType.RETURN_OUT, quantity=quantity,
        unit_cost=ZERO, reference=reference, description=description,
        source_type=StockMovement.SourceType.RETURN,
        source_id=original_receipt.id if original_receipt else None, user=user)
    cost = cost_stock_movement(organisation=organisation, movement=movement)
    movement.unit_cost = cost["unit_cost"]; movement.total_cost = cost["cost_used"]
    movement.save(update_fields=["unit_cost", "total_cost", "updated_at"])
    amount = cost["cost_used"].quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    journal = _journal(organisation=organisation, date=return_date,
        description=description or f"Supplier return - {product.code}", reference=reference,
        source_id=movement.id, source_type=JournalEntry.SourceType.SUPPLIER_RETURN,
        user=user, debit=settlement_account,
        credit=product.inventory_asset_account, amount=amount)
    _post_movement(movement, user, journal)
    return InventoryTransaction.objects.create(organisation=organisation,
        transaction_type=InventoryTransaction.TransactionType.SUPPLIER_RETURN,
        transaction_date=return_date, product=product, warehouse=warehouse,
        quantity=quantity, unit_cost=cost["unit_cost"], reference=reference,
        description=description, debit_credit_account=settlement_account,
        primary_movement=movement, accounting_journal=journal, created_by=user)


@transaction.atomic
def post_stock_count(*, stock_count, counts, user):
    require_organisation_permission(organisation=stock_count.organisation, user=user, permission=ADJUST_STOCK)
    if stock_count.status != StockCount.Status.COUNTING:
        raise BusinessRuleError("Only a stock count in counting status can be posted.")
    movement_ids = []
    for line in stock_count.lines.select_for_update().select_related("product"):
        if str(line.product_id) not in counts:
            raise BusinessRuleError(f"Count is missing for product {line.product.code}.")
        counted = Decimal(str(counts[str(line.product_id)]))
        if counted < 0:
            raise BusinessRuleError("Counted quantity cannot be negative.")
        difference = counted - line.expected_quantity
        line.counted_quantity = counted
        if difference:
            current = get_current_average_cost(organisation=stock_count.organisation,
                product=line.product, warehouse=stock_count.warehouse)
            movement = create_stock_adjustment(organisation=stock_count.organisation,
                product=line.product, warehouse=stock_count.warehouse,
                adjustment_date=stock_count.count_date,
                adjustment_type=(StockMovement.MovementType.ADJUSTMENT_IN if difference > 0
                                 else StockMovement.MovementType.ADJUSTMENT_OUT),
                quantity=abs(difference), unit_cost=current["average_unit_cost"],
                offset_account=stock_count.offset_account, reference=stock_count.reference,
                description="Stock count adjustment", user=user,
                journal_source_type=JournalEntry.SourceType.STOCK_COUNT)
            line.adjustment_movement = movement; movement_ids.append(str(movement.id))
        line.save(update_fields=["counted_quantity", "adjustment_movement"])
    stock_count.status = StockCount.Status.POSTED; stock_count.posted_at = timezone.now()
    stock_count.save(update_fields=["status", "posted_at"])
    return movement_ids
