"""Create a draft supplier credit without changing the bill it may later reduce."""

from decimal import Decimal
from django.db import IntegrityError, transaction
from common.exceptions import BusinessRuleError
from apps.accounting.models import Account
from apps.purchases.models import Bill, SupplierCredit, SupplierCreditLine
from apps.tax.models import TaxRate
from apps.tax.services import calculate_tax
from apps.tax.services.ledger_service import validate_tax_rate
from apps.fx.services import convert_amount,get_effective_rate
from .helpers import money


@transaction.atomic
def create_supplier_credit(*, organisation, supplier, credit_number, issue_date,
                           currency, lines, user, bill=None, reference="", notes=""):
    if supplier.organisation_id != organisation.id or not supplier.is_supplier:
        raise BusinessRuleError("The selected supplier is invalid.")
    if supplier.status != "active": raise BusinessRuleError("The selected supplier is not active.")
    from common.currencies import require_currency_code
    currency = require_currency_code(currency)
    if len(currency) != 3: raise BusinessRuleError("Currency must be a 3-letter currency code.")
    if bill:
        if bill.organisation_id != organisation.id or bill.supplier_id != supplier.id:
            raise BusinessRuleError("The linked bill is invalid.")
        if bill.status in {Bill.Status.DRAFT, Bill.Status.VOID}:
            raise BusinessRuleError("A draft or void bill cannot be credited.")
        if bill.currency != currency: raise BusinessRuleError("Credit currency must match the bill currency.")
    if not lines: raise BusinessRuleError("A supplier credit must contain at least one line.")
    try:
        credit = SupplierCredit.objects.create(organisation=organisation, supplier=supplier,
            bill=bill, credit_number=credit_number, issue_date=issue_date, currency=currency,
            reference=reference, notes=notes, created_by=user)
        credit.exchange_rate=get_effective_rate(organisation=organisation,base_currency=currency,target_currency=organisation.base_currency,date=issue_date);credit.save(update_fields=["exchange_rate","updated_at"])
    except IntegrityError as error:
        raise BusinessRuleError("Supplier credit number already exists.") from error
    subtotal = tax_total = total = Decimal("0.00"); credit_lines = []
    for line in lines:
        account = line["expense_account"]
        if account.organisation_id != organisation.id or account.status != Account.Status.ACTIVE or account.account_type != Account.AccountType.EXPENSE:
            raise BusinessRuleError("A valid active expense account is required.")
        description = str(line.get("description", "")).strip()
        quantity = Decimal(str(line.get("quantity", "1"))); unit_price = Decimal(str(line.get("unit_price", "0")))
        discount = money(line.get("discount_amount", "0")); source_line = bill.lines.filter(id=line.get("source_line_id")).first() if bill and line.get("source_line_id") else None
        tax_rate_config = source_line.tax_rate_config if source_line else line.get("tax_rate_config")
        if source_line:
            tax_rate = source_line.tax_rate
        elif tax_rate_config:
            validate_tax_rate(rate=tax_rate_config, organisation=organisation, scope=TaxRate.Scope.PURCHASES, date=issue_date)
            tax_rate = tax_rate_config.rate
        else:
            tax_rate = Decimal(str(line.get("tax_rate", "0")))
            if tax_rate: raise BusinessRuleError("Select a configured tax rate for a taxed supplier credit line.")
        if not description or quantity <= 0 or unit_price < 0 or discount < 0 or tax_rate < 0:
            raise BusinessRuleError("Supplier credit line is invalid.")
        gross = money(quantity * unit_price)
        if discount > gross: raise BusinessRuleError("Discount cannot exceed the line amount.")
        calculated = calculate_tax(quantity=quantity, unit_price=unit_price, discount=discount,
                                   tax_rate=tax_rate, tax_inclusive=bool(line.get("tax_inclusive", False)))
        net, tax, line_total = calculated.values(); subtotal += net; tax_total += tax; total += line_total
        credit_lines.append(SupplierCreditLine(credit=credit, description=description,
            quantity=quantity, unit_price=unit_price, discount_amount=discount,
            tax_rate=tax_rate, tax_rate_config=tax_rate_config, tax_amount=tax, line_total=line_total, expense_account=account))
    SupplierCreditLine.objects.bulk_create(credit_lines)
    credit.subtotal = money(subtotal); credit.tax_total = money(tax_total); credit.total = money(total);credit.base_currency_amount=convert_amount(amount=credit.total,rate=credit.exchange_rate)
    credit.save(update_fields=["subtotal", "tax_total", "total","base_currency_amount", "updated_at"])
    return credit
