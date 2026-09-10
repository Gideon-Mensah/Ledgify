"""Reverse an unsettled invoice or bill with its source state in one transaction."""
from django.db import transaction
from common.exceptions import BusinessRuleError
from common.ledger_integrity import lock_ledger
from apps.accounting.models import AccountingCorrection
from apps.accounting.services.journals import reverse_journal_entry
from apps.organisations.permissions import REVERSE_JOURNAL
from apps.organisations.services import require_organisation_permission


@transaction.atomic
def reverse_document(*, organisation, document, user, reversal_date, reason):
    from apps.sales.models import Invoice
    lock_ledger(organisation.pk)
    require_organisation_permission(organisation=organisation,user=user,permission=REVERSE_JOURNAL)
    document=type(document).objects.select_for_update().get(pk=document.pk,organisation=organisation)
    reason=reason.strip() if isinstance(reason,str) else ""
    if not reason:raise BusinessRuleError("A reversal reason is required.")
    if document.payment_allocations.filter(status="active").exists() or document.credit_allocations.exists():
        raise BusinessRuleError("Reverse or unallocate settlements before reversing this document.")
    if isinstance(document,Invoice) and document.write_offs.exclude(status="draft").exists():
        raise BusinessRuleError("A written-off invoice cannot use this correction workflow.")
    if not document.accounting_journal_id:raise BusinessRuleError("Only posted documents can be reversed.")
    reversal=reverse_journal_entry(document.accounting_journal,user,reversal_date,check_permissions=False,source_workflow=True)
    document.status=document.Status.VOID
    document.save(update_fields=["status","updated_at"])
    AccountingCorrection.objects.create(organisation=organisation,source_id=document.pk,
        operation="invoice" if isinstance(document,Invoice) else "bill",reversal_journal=reversal,reason=reason,performed_by=user)
    # Tax register uses the original immutable tax rows plus the dated reversal.
    return document
