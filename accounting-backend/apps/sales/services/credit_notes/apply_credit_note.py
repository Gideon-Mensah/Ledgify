from decimal import Decimal
from django.db import transaction
from django.utils import timezone
from common.exceptions import BusinessRuleError
from apps.sales.models import CustomerCreditAllocation, CustomerCreditNote, Invoice


@transaction.atomic
def apply_customer_credit_note(*, credit_note, invoice, amount, user):
    credit_note = CustomerCreditNote.objects.select_for_update().get(pk=credit_note.pk)
    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
    if credit_note.organisation_id != invoice.organisation_id or credit_note.customer_id != invoice.customer_id:
        raise BusinessRuleError("Credit note and invoice must belong to the same customer and organisation.")
    if credit_note.currency != invoice.currency:
        raise BusinessRuleError("Credit note and invoice currencies must match.")
    if credit_note.status not in {credit_note.Status.APPROVED, credit_note.Status.PARTLY_APPLIED}:
        raise BusinessRuleError("Only approved credits can be applied.")
    if invoice.status not in {Invoice.Status.APPROVED, Invoice.Status.SENT, Invoice.Status.PARTLY_PAID}:
        raise BusinessRuleError("Invoice is not available for credit allocation.")
    try: amount = Decimal(str(amount))
    except (ValueError, TypeError, ArithmeticError): raise BusinessRuleError("Credit amount is invalid.")
    if amount <= 0 or amount > credit_note.available_credit or amount > invoice.amount_due:
        raise BusinessRuleError("Credit amount exceeds the available balance.")
    allocation = CustomerCreditAllocation.objects.create(organisation=invoice.organisation,
        credit_note=credit_note, invoice=invoice, amount=amount, applied_at=timezone.now(), applied_by=user)
    credit_note.amount_applied += amount
    credit_note.status = credit_note.Status.APPLIED if credit_note.amount_applied == credit_note.total else credit_note.Status.PARTLY_APPLIED
    credit_note.save(update_fields=["amount_applied", "status", "updated_at"])
    invoice.amount_credited += amount
    if invoice.amount_due == 0: invoice.status = Invoice.Status.PAID
    elif invoice.amount_paid > 0 or invoice.amount_credited > 0: invoice.status = Invoice.Status.PARTLY_PAID
    invoice.save(update_fields=["amount_credited", "status", "updated_at"])
    return allocation
