"""Generate organisation-specific journal numbers without sharing sequences across businesses."""

from django.db import transaction

from apps.accounting.models import JournalSequence


@transaction.atomic
def get_next_journal_number(organisation):
    sequence = (
        JournalSequence.objects
        .select_for_update()
        .filter(
            organisation=organisation,
        )
        .first()
    )

    if sequence is None:
        sequence = JournalSequence.objects.create(
            organisation=organisation,
            last_number=0,
        )

    sequence.last_number += 1

    sequence.save(
        update_fields=[
            "last_number",
            "updated_at",
        ]
    )

    return f"JE-{sequence.last_number:06d}"
