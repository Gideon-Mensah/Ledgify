from decimal import Decimal
from django.db import transaction
from django.utils import timezone
from common.exceptions import BusinessRuleError
from apps.purchases.models import Bill, SupplierCredit, SupplierCreditAllocation


@transaction.atomic
def apply_supplier_credit(*, credit, bill, amount, user):
    credit = SupplierCredit.objects.select_for_update().get(pk=credit.pk)
    bill = Bill.objects.select_for_update().get(pk=bill.pk)
    if credit.organisation_id != bill.organisation_id or credit.supplier_id != bill.supplier_id:
        raise BusinessRuleError("Credit and bill must belong to the same supplier and organisation.")
    if credit.currency != bill.currency: raise BusinessRuleError("Credit and bill currencies must match.")
    if credit.status not in {credit.Status.APPROVED, credit.Status.PARTLY_APPLIED}:
        raise BusinessRuleError("Only approved supplier credits can be applied.")
    if bill.status not in {Bill.Status.APPROVED, Bill.Status.PARTLY_PAID}:
        raise BusinessRuleError("Bill is not available for credit allocation.")
    try: amount = Decimal(str(amount))
    except (ValueError, TypeError, ArithmeticError): raise BusinessRuleError("Credit amount is invalid.")
    if amount <= 0 or amount > credit.available_credit or amount > bill.amount_due:
        raise BusinessRuleError("Credit amount exceeds the available balance.")
    allocation = SupplierCreditAllocation.objects.create(organisation=bill.organisation,
        credit=credit, bill=bill, amount=amount, applied_at=timezone.now(), applied_by=user)
    credit.amount_applied += amount
    credit.status = credit.Status.APPLIED if credit.amount_applied == credit.total else credit.Status.PARTLY_APPLIED
    credit.save(update_fields=["amount_applied", "status", "updated_at"])
    bill.amount_credited += amount
    if bill.amount_due == 0: bill.status = Bill.Status.PAID
    elif bill.amount_paid > 0 or bill.amount_credited > 0: bill.status = Bill.Status.PARTLY_PAID
    bill.save(update_fields=["amount_credited", "status", "updated_at"])
    return allocation
