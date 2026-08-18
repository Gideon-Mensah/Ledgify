"""Validate invoice data and create a draft sales document without posting accounting."""

from decimal import Decimal

from django.db import transaction

from common.exceptions import BusinessRuleError

from apps.accounting.models import Account
from apps.sales.models import Invoice, InvoiceLine
from apps.tax.services.calculation_service import calculate_tax
from apps.tax.services.ledger_service import validate_tax_rate
from apps.tax.models import TaxRate
from apps.fx.services import convert_amount, get_effective_rate

from .helpers import money


@transaction.atomic
def create_invoice(
    *,
    organisation,
    customer,
    invoice_number,
    issue_date,
    due_date,
    currency,
    lines,
    user,
    reference="",
    notes="",
):
    if customer.organisation_id != organisation.id:
        raise BusinessRuleError(
            "The customer does not belong to this organisation."
        )

    if not customer.is_customer:
        raise BusinessRuleError(
            "The selected contact is not a customer."
        )

    if customer.status != "active":
        raise BusinessRuleError(
            "The selected customer is not active."
        )

    if due_date < issue_date:
        raise BusinessRuleError(
            "Due date cannot be earlier than issue date."
        )

    currency = str(currency).upper().strip()

    if len(currency) != 3:
        raise BusinessRuleError(
            "Currency must be a 3-letter currency code."
        )

    if not lines:
        raise BusinessRuleError(
            "An invoice must contain at least one line."
        )

    invoice_number = str(invoice_number).strip()

    if not invoice_number:
        raise BusinessRuleError(
            "Invoice number is required."
        )

    if Invoice.objects.filter(
        organisation=organisation,
        invoice_number=invoice_number,
    ).exists():
        raise BusinessRuleError(
            f"Invoice number {invoice_number} already exists."
        )

    invoice = Invoice.objects.create(
        organisation=organisation,
        customer=customer,
        invoice_number=invoice_number,
        issue_date=issue_date,
        due_date=due_date,
        currency=currency,
        reference=reference,
        notes=notes,
        status=Invoice.Status.DRAFT,
        created_by=user,
        exchange_rate=get_effective_rate(organisation=organisation, base_currency=currency,
                                         target_currency=organisation.base_currency, date=issue_date),
    )

    subtotal = Decimal("0.00")
    tax_total = Decimal("0.00")
    grand_total = Decimal("0.00")

    invoice_lines = []

    for index, line in enumerate(lines, start=1):
        revenue_account = line.get("revenue_account")

        if revenue_account is None:
            raise BusinessRuleError(
                f"Invoice line {index} requires a revenue account."
            )

        if revenue_account.organisation_id != organisation.id:
            raise BusinessRuleError(
                f"Account {revenue_account.code} does not "
                f"belong to this organisation."
            )

        if revenue_account.status != Account.Status.ACTIVE:
            raise BusinessRuleError(
                f"Account {revenue_account.code} is not active."
            )

        if revenue_account.account_type != Account.AccountType.REVENUE:
            raise BusinessRuleError(
                f"Account {revenue_account.code} must be "
                f"a revenue account."
            )

        description = str(
            line.get("description", "")
        ).strip()

        if not description:
            raise BusinessRuleError(
                f"Invoice line {index} requires a description."
            )

        try:
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
                                  scope=TaxRate.Scope.SALES, date=issue_date)
                tax_rate = tax_rate_config.rate
            else:
                tax_rate = Decimal(str(line.get("tax_rate", "0")))
                if tax_rate:
                    raise BusinessRuleError("Select a configured tax rate for a taxed invoice line.")

        except (ValueError, TypeError, ArithmeticError):
            raise BusinessRuleError(
                f"Invoice line {index} contains an invalid number."
            )

        if quantity <= Decimal("0"):
            raise BusinessRuleError(
                f"Invoice line {index} quantity must be "
                f"greater than zero."
            )

        if unit_price < Decimal("0"):
            raise BusinessRuleError(
                f"Invoice line {index} unit price cannot be negative."
            )

        if discount_amount < Decimal("0"):
            raise BusinessRuleError(
                f"Invoice line {index} discount cannot be negative."
            )

        if tax_rate < Decimal("0"):
            raise BusinessRuleError(
                f"Invoice line {index} tax rate cannot be negative."
            )

        gross_amount = money(quantity * unit_price)

        if discount_amount > gross_amount:
            raise BusinessRuleError(
                f"Invoice line {index} discount cannot exceed "
                f"the line amount."
            )

        calculated = calculate_tax(quantity=quantity, unit_price=unit_price,
                                   discount=discount_amount, tax_rate=tax_rate,
                                   tax_inclusive=bool(line.get("tax_inclusive", False)))
        net_amount, tax_amount, line_total = calculated.values()

        subtotal += net_amount
        tax_total += tax_amount
        grand_total += line_total

        invoice_lines.append(
            InvoiceLine(
                invoice=invoice,
                description=description,
                quantity=quantity,
                unit_price=unit_price,
                discount_amount=discount_amount,
                tax_rate=tax_rate,
                tax_rate_config=tax_rate_config,
                tax_amount=tax_amount,
                line_total=line_total,
                revenue_account=revenue_account,
            )
        )

    InvoiceLine.objects.bulk_create(
        invoice_lines
    )

    invoice.subtotal = money(subtotal)
    invoice.tax_total = money(tax_total)
    invoice.total = money(grand_total)
    invoice.base_currency_amount = convert_amount(amount=invoice.total, rate=invoice.exchange_rate)

    invoice.save(
        update_fields=[
            "subtotal",
            "tax_total",
            "total",
            "base_currency_amount",
            "updated_at",
        ]
    )

    return invoice
