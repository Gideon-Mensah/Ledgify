from .carrying import carrying_slice, source_slice, post_allocation_fx
"""Allocate supplier payments to bills without exceeding either available balance."""

from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from common.exceptions import BusinessRuleError
from common.ledger_integrity import lock_ledger
from apps.accounting.services.periods.period_service import validate_period_open
from django.db.models import DateField
from apps.purchases.models import Bill, SupplierPayment, SupplierPaymentAllocation


@transaction.atomic
def allocate_supplier_payment(*, organisation, payment, bill, amount, user, effective_date=None):
    lock_ledger(organisation.id)
    payment = SupplierPayment.objects.select_for_update().get(pk=payment.pk)
    bill = Bill.objects.select_for_update().get(pk=bill.pk)
    if payment.organisation_id != organisation.id or bill.organisation_id != organisation.id:
        raise BusinessRuleError("Payment and bill must belong to this organisation.")
    if payment.supplier_id != bill.supplier_id:
        raise BusinessRuleError("Payment and bill must belong to the same supplier.")
    if payment.currency != bill.currency:
        raise BusinessRuleError("Payment and bill currencies must match.")
    if payment.status != SupplierPayment.Status.POSTED:
        raise BusinessRuleError("Only posted payments can be allocated.")
    if not bill.accounting_journal_id or bill.status in {Bill.Status.DRAFT, Bill.Status.AWAITING_APPROVAL, Bill.Status.VOID}:
        raise BusinessRuleError("Bill is not available for payment allocation.")
    try:
        amount = Decimal(str(amount))
    except (ValueError, TypeError, ArithmeticError) as error:
        raise BusinessRuleError("Allocation amount is invalid.") from error
    if amount <= 0:
        raise BusinessRuleError("Allocation amount must be greater than zero.")
    if amount > payment.amount_unallocated:
        raise BusinessRuleError("Allocation exceeds the unallocated payment balance.")
    if bill.amount_due <= 0 or amount > bill.amount_due:
        raise BusinessRuleError("Allocation exceeds the bill outstanding balance.")
    effective_date = DateField().to_python(effective_date or timezone.localdate())
    if effective_date < max(payment.payment_date, bill.issue_date):
        raise BusinessRuleError("Allocation date cannot precede either document.")
    validate_period_open(organisation, effective_date)
    allocation = SupplierPaymentAllocation.objects.create(
        organisation=organisation, payment=payment, bill=bill,
        carrying_base_amount=carrying_slice(bill,amount,payable=True),
        source_base_amount=source_slice(payment,amount,payable=True),
        amount=amount, effective_date=effective_date, allocated_at=timezone.now(), allocated_by=user,
    )
    post_allocation_fx(allocation=allocation,source=payment,document=bill,user=user,payable=True)
    bill.amount_paid += amount
    bill.status = Bill.Status.PAID if bill.amount_due == 0 else Bill.Status.PARTLY_PAID
    bill.save(update_fields=["amount_paid", "status", "updated_at"])
    return allocation
