"""Correct a posted journal with an auditable opposite entry instead of editing history."""

from django.db import transaction
from django.utils import timezone

from common.exceptions import BusinessRuleError

from apps.accounting.models import JournalEntry, JournalLine
from apps.accounting.services.journals.post_journal import (
    post_journal_entry,
)
from apps.accounting.services.periods.period_service import (
    validate_period_open,
)
from apps.organisations.permissions import REVERSE_JOURNAL
from apps.organisations.services import require_organisation_permission


@transaction.atomic
def reverse_journal_entry(
    journal_entry,
    user,
    reversal_date=None,
    check_permissions=True,
):
    """
    Reverse a posted journal by creating and posting
    an equal and opposite journal entry.
    """

    original = (
        JournalEntry.objects
        .select_for_update()
        .select_related("organisation")
        .prefetch_related(
            "lines__account",
        )
        .get(pk=journal_entry.pk)
    )

    if check_permissions:
        require_organisation_permission(
            organisation=original.organisation,
            user=user,
            permission=REVERSE_JOURNAL,
        )

    if original.status != JournalEntry.Status.POSTED:
        raise BusinessRuleError(
            "Only posted journal entries can be reversed."
        )

    if hasattr(
        original,
        "reversal_entry",
    ):
        raise BusinessRuleError(
            "This journal entry has already been reversed."
        )

    original_lines = list(
        original.lines.all()
    )

    if len(original_lines) < 2:
        raise BusinessRuleError(
            "The original journal does not contain "
            "enough lines to be reversed."
        )

    reversal_date = (
        reversal_date
        or timezone.localdate()
    )

    # A reversal is also a new posting,
    # so the target period must be open.
    validate_period_open(
        original.organisation,
        reversal_date,
    )

    reversal_entry_number = (
        f"REV-{original.entry_number}"
    )

    if JournalEntry.objects.filter(
        organisation=original.organisation,
        entry_number=reversal_entry_number,
    ).exists():
        raise BusinessRuleError(
            "A reversal journal already exists "
            "for this entry."
        )

    reversal = JournalEntry.objects.create(
        organisation=original.organisation,
        entry_number=reversal_entry_number,
        date=reversal_date,
        reference=original.reference,
        description=(
            f"Reversal of {original.entry_number}"
        ),
        source_type=original.source_type,
        source_id=original.source_id,
        status=JournalEntry.Status.DRAFT,
        created_by=user,
        reversal_of=original,
    )

    reversal_lines = []

    for line in original_lines:
        reversal_lines.append(
            JournalLine(
                journal_entry=reversal,
                account=line.account,
                description=(
                    f"Reversal: {line.description}"
                ),
                debit=line.credit,
                credit=line.debit,
            )
        )

    JournalLine.objects.bulk_create(
        reversal_lines,
    )

    post_journal_entry(
        journal_entry=reversal,
        user=user,
    )

    original.status = JournalEntry.Status.REVERSED

    original.save(
        update_fields=[
            "status",
            "updated_at",
        ]
    )

    return reversal
