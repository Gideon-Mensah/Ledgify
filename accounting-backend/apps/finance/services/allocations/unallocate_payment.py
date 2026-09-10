"""Dated unallocation retains receipt and allocation history."""
from django.db import transaction
from django.db.models import DateField
from django.utils import timezone
from common.exceptions import BusinessRuleError
from common.ledger_integrity import lock_ledger
from apps.accounting.services.periods.period_service import validate_period_open
from apps.organisations.permissions import REVERSE_JOURNAL
from apps.organisations.services import require_organisation_permission
from .carrying import reverse_allocation_fx


@transaction.atomic
def unallocate_payment(*, organisation, allocation, user, effective_date, reason):
    from apps.sales.models import CustomerPaymentAllocation
    lock_ledger(organisation.pk)
    require_organisation_permission(organisation=organisation,user=user,permission=REVERSE_JOURNAL)
    allocation=type(allocation).objects.select_for_update().get(pk=allocation.pk,organisation=organisation)
    reason=reason.strip() if isinstance(reason,str) else ""
    if not reason:raise BusinessRuleError("An unallocation reason is required.")
    date=DateField().to_python(effective_date)
    original_date=allocation.effective_date or timezone.localtime(allocation.allocated_at).date()
    if not date or date<original_date:raise BusinessRuleError("Unallocation cannot precede allocation.")
    validate_period_open(organisation,date)
    if allocation.status=="reversed":return allocation
    reverse_allocation_fx(allocation=allocation,user=user,date=date)
    allocation.status="reversed";allocation.reversal_effective_date=date
    allocation.reversed_by=user;allocation.reversed_at=timezone.now();allocation.reversal_reason=reason
    allocation.save(update_fields=["status","reversal_effective_date","reversed_by","reversed_at","reversal_reason"])
    key="invoice" if isinstance(allocation,CustomerPaymentAllocation) else "bill"
    document=getattr(allocation,key)
    document=type(document).objects.select_for_update().get(pk=document.pk,organisation=organisation)
    document.amount_paid-=allocation.amount
    document.status=document.Status.PARTLY_PAID if document.amount_paid or document.amount_credited else document.Status.APPROVED
    document.save(update_fields=["amount_paid","status","updated_at"])
    return allocation
