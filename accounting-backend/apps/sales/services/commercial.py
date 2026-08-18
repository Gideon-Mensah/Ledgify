from decimal import Decimal, ROUND_HALF_UP

from django.db import models, transaction
from django.utils import timezone

from common.exceptions import BusinessRuleError
from apps.accounting.models import Account
from apps.inventory.services.workflows import issue_inventory_transaction
from apps.sales.models import Quote, QuoteLine, SalesOrder, SalesOrderLine
from apps.sales.services.invoices import create_invoice


def money(value):
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _validate_party(organisation, contact):
    if contact.organisation_id != organisation.id or not contact.is_customer or contact.status != "active":
        raise BusinessRuleError("Customer must be active and belong to this organisation.")


def _line_values(organisation, line, account_key):
    account = line.get(account_key)
    product = line.get("product")
    if account is None or account.organisation_id != organisation.id or account.status != Account.Status.ACTIVE:
        raise BusinessRuleError("A valid organisation revenue account is required.")
    if product and product.organisation_id != organisation.id:
        raise BusinessRuleError("Product belongs to another organisation.")
    quantity = Decimal(str(line.get("quantity", 0))); price = Decimal(str(line.get("unit_price", 0)))
    discount = money(line.get("discount_amount", 0)); tax_rate = Decimal(str(line.get("tax_rate", 0)))
    if quantity <= 0 or price < 0 or discount < 0 or tax_rate != 0:
        raise BusinessRuleError("Line quantity/pricing is invalid; tax must remain zero.")
    gross = money(quantity * price)
    if discount > gross: raise BusinessRuleError("Discount cannot exceed line amount.")
    total = money(gross - discount)
    return quantity, price, discount, total


@transaction.atomic
def create_quote(*, organisation, customer, quote_number, issue_date, expiry_date,
                 currency, lines, user, reference="", notes=""):
    _validate_party(organisation, customer)
    if expiry_date < issue_date or not lines: raise BusinessRuleError("Quote dates or lines are invalid.")
    quote = Quote.objects.create(organisation=organisation, customer=customer,
        quote_number=quote_number, issue_date=issue_date, expiry_date=expiry_date,
        currency=currency.upper(), reference=reference, notes=notes, created_by=user)
    subtotal = Decimal("0")
    objects = []
    for line in lines:
        quantity, price, discount, total = _line_values(organisation, line, "revenue_account")
        subtotal += total
        objects.append(QuoteLine(quote=quote, product=line.get("product"),
            description=line["description"], quantity=quantity, unit_price=price,
            discount_amount=discount, line_total=total, revenue_account=line["revenue_account"]))
    QuoteLine.objects.bulk_create(objects); quote.subtotal=money(subtotal); quote.total=money(subtotal)
    quote.save(update_fields=["subtotal", "total", "updated_at"]); return quote


@transaction.atomic
def accept_quote(*, organisation, quote, user):
    quote = Quote.objects.select_for_update().get(pk=quote.pk, organisation=organisation)
    if quote.status not in {Quote.Status.DRAFT, Quote.Status.SENT}: raise BusinessRuleError("Quote cannot be accepted.")
    if quote.expiry_date < timezone.localdate(): raise BusinessRuleError("Expired quote cannot be accepted.")
    quote.status=Quote.Status.ACCEPTED; quote.accepted_by=user; quote.accepted_at=timezone.now()
    quote.save(update_fields=["status", "accepted_by", "accepted_at", "updated_at"]); return quote


@transaction.atomic
def convert_quote_to_invoice(*, organisation, quote, user, invoice_number, issue_date, due_date):
    quote = Quote.objects.select_for_update().prefetch_related("lines__revenue_account").get(pk=quote.pk, organisation=organisation)
    if quote.status != Quote.Status.ACCEPTED or quote.converted_invoice_id: raise BusinessRuleError("Only an unconverted accepted quote can be invoiced.")
    invoice = create_invoice(organisation=organisation, customer=quote.customer,
        invoice_number=invoice_number, issue_date=issue_date, due_date=due_date,
        currency=quote.currency, reference=quote.reference, notes=quote.notes, user=user,
        lines=[{"description": x.description, "quantity": x.quantity,
                "unit_price": x.unit_price, "discount_amount": x.discount_amount,
                "tax_rate": Decimal("0"), "revenue_account": x.revenue_account} for x in quote.lines.all()])
    quote.status=Quote.Status.CONVERTED; quote.converted_invoice=invoice
    quote.save(update_fields=["status", "converted_invoice", "updated_at"]); return invoice


@transaction.atomic
def create_sales_order(*, organisation, customer, order_number, order_date, currency,
                       lines, user, expected_delivery_date=None, reference="", notes="",
                       quote=None):
    _validate_party(organisation, customer)
    if quote and (quote.organisation_id != organisation.id or hasattr(quote, "sales_order")):
        raise BusinessRuleError("Quote is invalid or already converted to a sales order.")
    order = SalesOrder.objects.create(organisation=organisation, customer=customer,
        order_number=order_number, order_date=order_date,
        expected_delivery_date=expected_delivery_date, currency=currency.upper(),
        reference=reference, notes=notes, quote=quote, created_by=user)
    subtotal=Decimal("0"); objects=[]
    for line in lines:
        quantity, price, discount, total = _line_values(organisation, line, "revenue_account")
        subtotal += total; objects.append(SalesOrderLine(sales_order=order,
            product=line.get("product"), description=line["description"], quantity=quantity,
            unit_price=price, discount_amount=discount, line_total=total,
            revenue_account=line["revenue_account"]))
    SalesOrderLine.objects.bulk_create(objects); order.subtotal=money(subtotal); order.total=money(subtotal)
    order.save(update_fields=["subtotal", "total", "updated_at"]); return order


@transaction.atomic
def convert_sales_order_to_invoice(*, organisation, sales_order, user,
                                   invoice_number, issue_date, due_date):
    order = SalesOrder.objects.select_for_update().prefetch_related("lines__revenue_account").get(
        pk=sales_order.pk, organisation=organisation)
    if order.invoice_id or order.status not in {SalesOrder.Status.APPROVED,
            SalesOrder.Status.PARTLY_FULFILLED, SalesOrder.Status.FULFILLED}:
        raise BusinessRuleError("Sales order cannot be invoiced.")
    invoice=create_invoice(organisation=organisation, customer=order.customer,
        invoice_number=invoice_number, issue_date=issue_date, due_date=due_date,
        currency=order.currency, reference=order.reference, notes=order.notes, user=user,
        lines=[{"description": x.description, "quantity": x.quantity,
                "unit_price": x.unit_price, "discount_amount": x.discount_amount,
                "tax_rate": Decimal("0"), "revenue_account": x.revenue_account}
               for x in order.lines.all()])
    order.invoice=invoice; order.status=SalesOrder.Status.INVOICED
    order.save(update_fields=["invoice", "status", "updated_at"]); return invoice


@transaction.atomic
def approve_sales_order(*, organisation, sales_order, user):
    order = SalesOrder.objects.select_for_update().get(pk=sales_order.pk, organisation=organisation)
    if order.status != SalesOrder.Status.DRAFT: raise BusinessRuleError("Only draft sales orders can be approved.")
    order.status=SalesOrder.Status.APPROVED; order.approved_by=user; order.approved_at=timezone.now()
    order.save(update_fields=["status", "approved_by", "approved_at", "updated_at"]); return order


@transaction.atomic
def fulfil_sales_order_line(*, organisation, line, warehouse, quantity, transaction_date, user):
    line = SalesOrderLine.objects.select_for_update().select_related("sales_order", "product").get(pk=line.pk)
    if line.sales_order.organisation_id != organisation.id or line.sales_order.status not in {SalesOrder.Status.APPROVED, SalesOrder.Status.PARTLY_FULFILLED}:
        raise BusinessRuleError("Sales order is not available for fulfilment.")
    quantity=Decimal(str(quantity)); remaining=line.quantity-line.quantity_fulfilled
    if not line.product or quantity <= 0 or quantity > remaining: raise BusinessRuleError("Fulfilment quantity is invalid.")
    transaction=issue_inventory_transaction(organisation=organisation, product=line.product,
        warehouse=warehouse, transaction_date=transaction_date, quantity=quantity,
        source_document_id=line.sales_order_id, reference=line.sales_order.order_number,
        description=f"Sales order fulfilment - {line.description}", user=user)
    line.quantity_fulfilled += quantity; line.save(update_fields=["quantity_fulfilled"])
    order=line.sales_order; complete=not order.lines.exclude(quantity_fulfilled=models.F("quantity")).exists()
    order.status=SalesOrder.Status.FULFILLED if complete else SalesOrder.Status.PARTLY_FULFILLED
    order.save(update_fields=["status", "updated_at"]); return transaction
