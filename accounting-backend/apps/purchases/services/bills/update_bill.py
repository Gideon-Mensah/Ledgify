"""Replace validated lines on a draft bill while keeping posted bills immutable."""

from decimal import Decimal

from django.db import transaction

from apps.accounting.models import Account
from apps.fx.services import convert_amount, get_effective_rate
from apps.purchases.models import Bill, BillLine
from apps.tax.models import TaxRate
from apps.tax.services.calculation_service import calculate_tax
from apps.tax.services.ledger_service import validate_tax_rate
from common.exceptions import BusinessRuleError

from .helpers import money


@transaction.atomic
def update_bill(*, bill, organisation, supplier, lines, **values):
    bill = Bill.objects.select_for_update().get(pk=bill.pk, organisation=organisation)
    if bill.status != Bill.Status.DRAFT:
        raise BusinessRuleError("Only draft bills can be edited.")
    if supplier.organisation_id != organisation.id or not supplier.is_supplier:
        raise BusinessRuleError("The selected supplier is invalid.")
    if supplier.status != "active":
        raise BusinessRuleError("The selected supplier is not active.")

    issue_date = values["issue_date"]
    due_date = values["due_date"]
    if due_date < issue_date:
        raise BusinessRuleError("Due date cannot be earlier than issue date.")
    from common.currencies import require_currency_code
    currency = require_currency_code(values["currency"])
    if not lines:
        raise BusinessRuleError("A bill must contain at least one line.")

    prepared = []
    subtotal = tax_total = grand_total = Decimal("0.00")
    for line in lines:
        account = line["expense_account"]
        receipt = line.get("inventory_receipt")
        if account.organisation_id != organisation.id or account.status != Account.Status.ACTIVE:
            raise BusinessRuleError(f"Account {account.code} is not a valid active organisation account.")
        if receipt is not None:
            if receipt.organisation_id != organisation.id or receipt.transaction_type != receipt.TransactionType.PURCHASE_RECEIPT:
                raise BusinessRuleError("Only this organisation's purchase receipts can be matched.")
            if receipt.debit_credit_account_id != account.id:
                raise BusinessRuleError("Receipt bill line must use the receipt GRNI account.")
            if BillLine.objects.filter(inventory_receipt=receipt).exclude(bill=bill).exists():
                raise BusinessRuleError("This purchase receipt has already been billed.")
        elif account.account_type != "expense":
            raise BusinessRuleError(f"Account {account.code} must be an expense account.")

        description = str(line.get("description", "")).strip()
        quantity = Decimal(str(line.get("quantity", "1")))
        unit_price = Decimal(str(line.get("unit_price", "0")))
        discount = money(line.get("discount_amount", "0"))
        if not description or quantity <= 0 or unit_price < 0 or discount < 0:
            raise BusinessRuleError("Every bill line requires valid description, quantity, price and discount values.")
        gross = money(quantity * unit_price)
        if discount > gross:
            raise BusinessRuleError("Discount cannot exceed the line amount.")

        rate_config = line.get("tax_rate_config")
        if rate_config:
            validate_tax_rate(rate=rate_config, organisation=organisation, scope=TaxRate.Scope.PURCHASES, date=issue_date)
            tax_rate = rate_config.rate
        else:
            tax_rate = Decimal(str(line.get("tax_rate", "0")))
            if tax_rate:
                raise BusinessRuleError("Select a configured tax rate for a taxed bill line.")
        calculated = calculate_tax(quantity=quantity, unit_price=unit_price, discount=discount,
                                   tax_rate=tax_rate, tax_inclusive=bool(line.get("tax_inclusive", False)))
        net, tax, total = calculated.values()
        subtotal += net
        tax_total += tax
        grand_total += total
        prepared.append(BillLine(bill=bill, description=description, quantity=quantity,
                                 unit_price=unit_price, discount_amount=discount, tax_rate=tax_rate,
                                 tax_rate_config=rate_config, tax_amount=tax, line_total=total,
                                 expense_account=account, inventory_receipt=receipt))

    bill.lines.all().delete()
    BillLine.objects.bulk_create(prepared)
    bill.supplier = supplier
    bill.currency = currency
    for field in ("bill_number", "supplier_reference", "issue_date", "due_date", "notes"):
        setattr(bill, field, values.get(field, getattr(bill, field)))
    bill.exchange_rate = get_effective_rate(organisation=organisation, base_currency=currency,
                                            target_currency=organisation.base_currency, date=issue_date)
    bill.subtotal = money(subtotal)
    bill.tax_total = money(tax_total)
    bill.total = money(grand_total)
    bill.base_currency_amount = convert_amount(amount=bill.total, rate=bill.exchange_rate)
    bill.save()
    return bill
