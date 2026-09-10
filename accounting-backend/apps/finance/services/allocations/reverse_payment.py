from .carrying import reverse_allocation_fx
"""Atomic payment correction: preserve the receipt and reverse its allocations."""
from django.db import transaction
from django.db.models import DateField
from django.utils import timezone
from common.exceptions import BusinessRuleError
from common.ledger_integrity import lock_ledger
from apps.accounting.services.journals import reverse_journal_entry
from apps.organisations.permissions import REVERSE_JOURNAL
from apps.organisations.services import require_organisation_permission


@transaction.atomic
def reverse_payment(*, organisation, payment, user, reversal_date, reason):
    from apps.sales.models import CustomerPayment
    from apps.banking.models import BankTransaction
    lock_ledger(organisation.id)
    require_organisation_permission(organisation=organisation, user=user, permission=REVERSE_JOURNAL)
    reason = reason.strip() if isinstance(reason, str) else ""
    if not reason:
        raise BusinessRuleError("A reason is required to reverse a payment.")
    payment = type(payment).objects.select_for_update().get(pk=payment.pk, organisation=organisation)
    date = DateField().to_python(reversal_date)
    if not date or date < payment.payment_date:
        raise BusinessRuleError("Reversal date cannot precede payment date.")
    if payment.status == payment.Status.REVERSED:
        return payment
    if payment.status != payment.Status.POSTED or not payment.accounting_journal_id:
        raise BusinessRuleError("Only posted payments can be reversed.")
    if BankTransaction.objects.filter(organisation=organisation, accounting_journal=payment.accounting_journal, status="reconciled").exists():
        raise BusinessRuleError("Unreconcile this payment through its bank reconciliation first.")
    document_key = "invoice" if isinstance(payment, CustomerPayment) else "bill"
    allocations = list(payment.allocations.select_for_update().filter(status="active").order_by("id"))
    for allocation in allocations:
        if allocation.effective_date and date < allocation.effective_date:
            raise BusinessRuleError("Reverse no earlier than the latest allocation date.")
    reversal = reverse_journal_entry(payment.accounting_journal, user, date, check_permissions=False, source_workflow=True)
    for allocation in allocations:
        reverse_allocation_fx(allocation=allocation,user=user,date=date)
        allocation.status = "reversed"
        allocation.reversal_effective_date = date
        allocation.reversed_at = timezone.now()
        allocation.reversed_by = user
        allocation.reversal_reason = reason
        allocation.save(update_fields=["status", "reversal_effective_date", "reversed_at", "reversed_by", "reversal_reason"])
        document = getattr(allocation, document_key)
        document = type(document).objects.select_for_update().get(pk=document.pk, organisation=organisation)
        document.amount_paid -= allocation.amount
        document.status = document.Status.PARTLY_PAID if document.amount_paid or document.amount_credited else document.Status.APPROVED
        document.save(update_fields=["amount_paid", "status", "updated_at"])
    payment.status = payment.Status.REVERSED
    payment.save(update_fields=["status", "updated_at"])
    # The immutable reversal identifies the actor/date; allocations retain reason.
    from apps.accounting.models import AccountingCorrection
    AccountingCorrection.objects.create(organisation=organisation, source_id=payment.pk,
        operation="customer_payment" if isinstance(payment, CustomerPayment) else "supplier_payment",
        reversal_journal=reversal, reason=reason, performed_by=user)
    return payment
