"""Validate supplier costs and create a draft bill for later approval and posting."""

from decimal import Decimal

from django.db import transaction

from common.exceptions import BusinessRuleError

from apps.accounting.models import Account
from apps.purchases.models import Bill, BillLine
from apps.tax.services.calculation_service import calculate_tax
from apps.tax.services.ledger_service import validate_tax_rate
from apps.tax.models import TaxRate
from apps.fx.services import convert_amount, get_effective_rate

from .helpers import money


@transaction.atomic
def create_bill(
    *,
    organisation,
    supplier,
    bill_number,
    issue_date,
    due_date,
    currency,
    lines,
    user,
    supplier_reference="",
    notes="",
):
    if supplier.organisation_id != organisation.id:
        raise BusinessRuleError(
            "The supplier does not belong to this organisation."
        )

    if not supplier.is_supplier:
        raise BusinessRuleError(
            "The selected contact is not a supplier."
        )

    if supplier.status != "active":
        raise BusinessRuleError(
            "The selected supplier is not active."
        )

    if due_date < issue_date:
        raise BusinessRuleError(
            "Due date cannot be earlier than issue date."
        )

    from common.currencies import require_currency_code
    currency = require_currency_code(currency)

    if not lines:
        raise BusinessRuleError(
            "A bill must contain at least one line."
        )

    bill = Bill.objects.create(
        organisation=organisation,
        supplier=supplier,
        bill_number=bill_number,
        supplier_reference=supplier_reference,
        issue_date=issue_date,
        due_date=due_date,
        currency=currency,
        notes=notes,
        status=Bill.Status.DRAFT,
        created_by=user,
        exchange_rate=get_effective_rate(organisation=organisation, base_currency=currency,
                                         target_currency=organisation.base_currency, date=issue_date),
    )

    subtotal = Decimal("0.00")
    tax_total = Decimal("0.00")
    grand_total = Decimal("0.00")

    bill_lines = []

    for line in lines:
        inventory_receipt = line.get("inventory_receipt")
        expense_account = line["expense_account"]

        if inventory_receipt is not None:
            if inventory_receipt.organisation_id != organisation.id:
                raise BusinessRuleError("Inventory receipt belongs to another organisation.")
            if inventory_receipt.transaction_type != inventory_receipt.TransactionType.PURCHASE_RECEIPT:
                raise BusinessRuleError("Only purchase receipts can be matched to bill lines.")
            if inventory_receipt.debit_credit_account_id != expense_account.id:
                raise BusinessRuleError("Receipt bill line must use the receipt GRNI account.")
            if BillLine.objects.filter(inventory_receipt=inventory_receipt).exists():
                raise BusinessRuleError("This purchase receipt has already been billed.")

        if expense_account.organisation_id != organisation.id:
            raise BusinessRuleError(
                f"Account {expense_account.code} does not belong to this organisation."
            )

        if expense_account.status != Account.Status.ACTIVE:
            raise BusinessRuleError(
                f"Account {expense_account.code} is not active."
            )

        if inventory_receipt is None and expense_account.account_type != "expense":
            raise BusinessRuleError(
                f"Account {expense_account.code} must be an expense account."
            )

        description = str(
            line.get("description", "")
        ).strip()

        if not description:
            raise BusinessRuleError(
                "Every bill line requires a description."
            )

        quantity = Decimal(
            str(line.get("quantity", "1"))
        )

        unit_price = Decimal(
            str(line.get("unit_price", "0"))
        )

        discount_amount = money(
            line.get("discount_amount", "0")
        )

        tax_rate_config = line.get("tax_rate_config")
        if tax_rate_config:
            validate_tax_rate(rate=tax_rate_config, organisation=organisation,
                              scope=TaxRate.Scope.PURCHASES, date=issue_date)
            tax_rate = tax_rate_config.rate
        else:
            tax_rate = Decimal(str(line.get("tax_rate", "0")))
            if tax_rate:
                raise BusinessRuleError("Select a configured tax rate for a taxed bill line.")

        if quantity <= 0:
            raise BusinessRuleError(
                "Quantity must be greater than zero."
            )

        if unit_price < 0:
            raise BusinessRuleError(
                "Unit price cannot be negative."
            )

        if discount_amount < 0:
            raise BusinessRuleError(
                "Discount cannot be negative."
            )

        gross = money(
            quantity * unit_price
        )

        if discount_amount > gross:
            raise BusinessRuleError(
                "Discount cannot exceed the line amount."
            )

        calculated = calculate_tax(quantity=quantity, unit_price=unit_price,
                                   discount=discount_amount, tax_rate=tax_rate,
                                   tax_inclusive=bool(line.get("tax_inclusive", False)))
        net, tax, total = calculated.values()

        subtotal += net
        tax_total += tax
        grand_total += total

        bill_lines.append(
            BillLine(
                bill=bill,
                description=description,
                quantity=quantity,
                unit_price=unit_price,
                discount_amount=discount_amount,
                tax_rate=tax_rate,
                tax_rate_config=tax_rate_config,
                tax_amount=tax,
                line_total=total,
                expense_account=expense_account,
                inventory_receipt=inventory_receipt,
            )
        )

    BillLine.objects.bulk_create(
        bill_lines
    )

    bill.subtotal = money(subtotal)
    bill.tax_total = money(tax_total)
    bill.total = money(grand_total)
    bill.base_currency_amount = convert_amount(amount=bill.total, rate=bill.exchange_rate)

    bill.save(
        update_fields=[
            "subtotal",
            "tax_total",
            "total",
            "base_currency_amount",
            "updated_at",
        ]
    )

    return bill
