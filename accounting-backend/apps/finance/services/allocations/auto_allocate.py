"""Apply available payments to the oldest eligible documents deterministically."""

from decimal import Decimal

from django.db import transaction

from common.exceptions import BusinessRuleError
from apps.purchases.models import Bill, SupplierPayment
from apps.sales.models import CustomerPayment, Invoice
from .customer_allocation import allocate_customer_payment
from .supplier_allocation import allocate_supplier_payment


@transaction.atomic
def auto_allocate_customer_payment(*, organisation, payment, user):
    payment = CustomerPayment.objects.select_for_update().get(pk=payment.pk)
    if (
        payment.organisation_id != organisation.id
        or payment.status != CustomerPayment.Status.POSTED
    ):
        raise BusinessRuleError("Only posted organisation payments can be allocated.")
    allocations = []
    invoices = Invoice.objects.filter(
        organisation=organisation, customer_id=payment.customer_id,
        currency=payment.currency,
    ).exclude(status__in=[Invoice.Status.DRAFT, Invoice.Status.VOID,
                         Invoice.Status.PAID, Invoice.Status.WRITTEN_OFF]).order_by(
        "due_date", "issue_date", "invoice_number"
    )
    for invoice in invoices:
        if payment.amount_unallocated <= 0:
            break
        if invoice.amount_due <= 0:
            continue
        allocations.append(allocate_customer_payment(
            organisation=organisation, payment=payment, invoice=invoice,
            amount=min(payment.amount_unallocated, invoice.amount_due), user=user,
        ))
    allocated = sum((item.amount for item in allocations), Decimal("0.00"))
    return {"allocations": allocations, "amount_allocated": allocated,
            "amount_unallocated": payment.amount_unallocated}


@transaction.atomic
def auto_allocate_supplier_payment(*, organisation, payment, user):
    payment = SupplierPayment.objects.select_for_update().get(pk=payment.pk)
    if (
        payment.organisation_id != organisation.id
        or payment.status != SupplierPayment.Status.POSTED
    ):
        raise BusinessRuleError("Only posted organisation payments can be allocated.")
    allocations = []
    bills = Bill.objects.filter(
        organisation=organisation, supplier_id=payment.supplier_id,
        currency=payment.currency,
    ).exclude(status__in=[Bill.Status.DRAFT, Bill.Status.VOID, Bill.Status.PAID]).order_by(
        "due_date", "issue_date", "bill_number"
    )
    for bill in bills:
        if payment.amount_unallocated <= 0:
            break
        if bill.amount_due <= 0:
            continue
        allocations.append(allocate_supplier_payment(
            organisation=organisation, payment=payment, bill=bill,
            amount=min(payment.amount_unallocated, bill.amount_due), user=user,
        ))
    allocated = sum((item.amount for item in allocations), Decimal("0.00"))
    return {"allocations": allocations, "amount_allocated": allocated,
            "amount_unallocated": payment.amount_unallocated}
