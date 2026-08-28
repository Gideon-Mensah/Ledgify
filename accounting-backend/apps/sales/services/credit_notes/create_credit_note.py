"""Create a draft customer credit while preserving the original invoice history."""

from decimal import Decimal

from django.db import IntegrityError, transaction

from common.exceptions import BusinessRuleError
from apps.accounting.models import Account
from apps.sales.models import CustomerCreditNote, CustomerCreditNoteLine, Invoice
from apps.tax.models import TaxRate
from apps.tax.services import calculate_tax
from apps.tax.services.ledger_service import validate_tax_rate
from apps.fx.services import convert_amount,get_effective_rate
from .helpers import money


@transaction.atomic
def create_customer_credit_note(*, organisation, customer, credit_note_number,
                                issue_date, currency, lines, user, invoice=None,
                                reference="", notes=""):
    if customer.organisation_id != organisation.id or not customer.is_customer:
        raise BusinessRuleError("The selected customer is invalid.")
    if customer.status != "active":
        raise BusinessRuleError("The selected customer is not active.")
    from common.currencies import require_currency_code
    currency = require_currency_code(currency)
    if len(currency) != 3:
        raise BusinessRuleError("Currency must be a 3-letter currency code.")
    if invoice:
        if invoice.organisation_id != organisation.id or invoice.customer_id != customer.id:
            raise BusinessRuleError("The linked invoice is invalid.")
        if invoice.status in {Invoice.Status.DRAFT, Invoice.Status.VOID}:
            raise BusinessRuleError("A draft or void invoice cannot be credited.")
        if invoice.currency != currency:
            raise BusinessRuleError("Credit currency must match the invoice currency.")
    if not lines:
        raise BusinessRuleError("A credit note must contain at least one line.")
    try:
        credit = CustomerCreditNote.objects.create(
            organisation=organisation, customer=customer, invoice=invoice,
            credit_note_number=credit_note_number, issue_date=issue_date,
            currency=currency, reference=reference, notes=notes, created_by=user,
            exchange_rate=get_effective_rate(organisation=organisation,base_currency=currency,target_currency=organisation.base_currency,date=issue_date),
        )
    except IntegrityError as error:
        raise BusinessRuleError("Credit note number already exists.") from error
    subtotal = tax_total = total = Decimal("0.00")
    credit_lines = []
    for line in lines:
        account = line["revenue_account"]
        if (account.organisation_id != organisation.id
                or account.status != Account.Status.ACTIVE
                or account.account_type != Account.AccountType.REVENUE):
            raise BusinessRuleError("A valid active revenue account is required.")
        description = str(line.get("description", "")).strip()
        if not description:
            raise BusinessRuleError("Every credit line requires a description.")
        quantity = Decimal(str(line.get("quantity", "1")))
        unit_price = Decimal(str(line.get("unit_price", "0")))
        discount = money(line.get("discount_amount", "0"))
        source_line = invoice.lines.filter(id=line.get("source_line_id")).first() if invoice and line.get("source_line_id") else None
        tax_rate_config = source_line.tax_rate_config if source_line else line.get("tax_rate_config")
        if source_line:
            tax_rate = source_line.tax_rate
        elif tax_rate_config:
            validate_tax_rate(rate=tax_rate_config, organisation=organisation, scope=TaxRate.Scope.SALES, date=issue_date)
            tax_rate = tax_rate_config.rate
        else:
            tax_rate = Decimal(str(line.get("tax_rate", "0")))
            if tax_rate: raise BusinessRuleError("Select a configured tax rate for a taxed credit line.")
        if quantity <= 0 or unit_price < 0 or discount < 0 or tax_rate < 0:
            raise BusinessRuleError("Credit line amounts are invalid.")
        gross = money(quantity * unit_price)
        if discount > gross:
            raise BusinessRuleError("Discount cannot exceed the line amount.")
        calculated = calculate_tax(quantity=quantity, unit_price=unit_price, discount=discount,
                                   tax_rate=tax_rate, tax_inclusive=bool(line.get("tax_inclusive", False)))
        net, tax, line_total = calculated.values()
        subtotal += net; tax_total += tax; total += line_total
        credit_lines.append(CustomerCreditNoteLine(
            credit_note=credit, description=description, quantity=quantity,
            unit_price=unit_price, discount_amount=discount, tax_rate=tax_rate, tax_rate_config=tax_rate_config,
            tax_amount=tax, line_total=line_total, revenue_account=account,
        ))
    CustomerCreditNoteLine.objects.bulk_create(credit_lines)
    credit.subtotal = money(subtotal); credit.tax_total = money(tax_total); credit.total = money(total);credit.base_currency_amount=convert_amount(amount=credit.total,rate=credit.exchange_rate)
    credit.save(update_fields=["subtotal", "tax_total", "total","base_currency_amount", "updated_at"])
    return credit
