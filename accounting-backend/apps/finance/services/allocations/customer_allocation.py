from .carrying import carrying_slice, source_slice, post_allocation_fx
"""Allocate customer receipts to invoices and update balances only after validation."""

from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from common.exceptions import BusinessRuleError
from common.ledger_integrity import lock_ledger
from apps.accounting.services.periods.period_service import validate_period_open
from django.db.models import DateField
from apps.sales.models import CustomerPayment, CustomerPaymentAllocation, Invoice


@transaction.atomic
def allocate_customer_payment(*, organisation, payment, invoice, amount, user, effective_date=None):
    lock_ledger(organisation.id)
    payment = CustomerPayment.objects.select_for_update().get(pk=payment.pk)
    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
    if payment.organisation_id != organisation.id or invoice.organisation_id != organisation.id:
        raise BusinessRuleError("Payment and invoice must belong to this organisation.")
    if payment.customer_id != invoice.customer_id:
        raise BusinessRuleError("Payment and invoice must belong to the same customer.")
    if payment.currency != invoice.currency:
        raise BusinessRuleError("Payment and invoice currencies must match.")
    if payment.status != CustomerPayment.Status.POSTED:
        raise BusinessRuleError("Only posted payments can be allocated.")
    if not invoice.accounting_journal_id or invoice.status in {Invoice.Status.DRAFT, Invoice.Status.AWAITING_APPROVAL, Invoice.Status.VOID, Invoice.Status.WRITTEN_OFF}:
        raise BusinessRuleError("Invoice is not available for payment allocation.")
    try:
        amount = Decimal(str(amount))
    except (ValueError, TypeError, ArithmeticError) as error:
        raise BusinessRuleError("Allocation amount is invalid.") from error
    if amount <= 0:
        raise BusinessRuleError("Allocation amount must be greater than zero.")
    if amount > payment.amount_unallocated:
        raise BusinessRuleError("Allocation exceeds the unallocated payment balance.")
    if invoice.amount_due <= 0 or amount > invoice.amount_due:
        raise BusinessRuleError("Allocation exceeds the invoice outstanding balance.")
    effective_date = DateField().to_python(effective_date or timezone.localdate())
    if effective_date < max(payment.payment_date, invoice.issue_date):
        raise BusinessRuleError("Allocation date cannot precede either document.")
    validate_period_open(organisation, effective_date)
    allocation = CustomerPaymentAllocation.objects.create(
        organisation=organisation, payment=payment, invoice=invoice,
        carrying_base_amount=carrying_slice(invoice,amount,payable=False),
        source_base_amount=source_slice(payment,amount,payable=False),
        amount=amount, effective_date=effective_date, allocated_at=timezone.now(), allocated_by=user,
    )
    post_allocation_fx(allocation=allocation,source=payment,document=invoice,user=user,payable=False)
    invoice.amount_paid += amount
    if invoice.amount_due == 0:
        invoice.status = (
            Invoice.Status.WRITTEN_OFF
            if invoice.amount_written_off > 0
            else Invoice.Status.PAID
        )
    else:
        invoice.status = Invoice.Status.PARTLY_PAID
    invoice.save(update_fields=["amount_paid", "status", "updated_at"])
    return allocation
