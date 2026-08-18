"""Create balanced journal entries after organisation and period checks pass."""

from decimal import Decimal

from django.db import transaction

from common.exceptions import BusinessRuleError

from apps.accounting.models import Account, JournalEntry, JournalLine
from apps.accounting.services.journals.journal_number import (
    get_next_journal_number,
)
from apps.organisations.permissions import CREATE_JOURNAL
from apps.organisations.services import require_organisation_permission


@transaction.atomic
def create_journal_entry(
    *,
    organisation,
    date,
    description,
    lines,
    user,
    reference="",
    source_type=JournalEntry.SourceType.MANUAL,
    source_id=None,
):
    # Manual journals need an explicit permission check. Journals created by an
    # approved business workflow are authorised by that workflow instead.
    if source_type == JournalEntry.SourceType.MANUAL:
        require_organisation_permission(
            organisation=organisation,
            user=user,
            permission=CREATE_JOURNAL,
        )
    if not lines:
        raise BusinessRuleError(
            "A journal entry must contain lines."
        )

    if len(lines) < 2:
        raise BusinessRuleError(
            "A journal entry must contain at least two lines."
        )

    entry_number = get_next_journal_number(
        organisation,
    )

    journal_entry = JournalEntry.objects.create(
        organisation=organisation,
        entry_number=entry_number,
        date=date,
        reference=reference,
        description=description,
        source_type=source_type,
        source_id=source_id,
        status=JournalEntry.Status.DRAFT,
        created_by=user,
    )

    # Validate every line before it is inserted. This also prevents an account
    # from another organisation being used in this organisation's journal.
    journal_lines = []

    for index, line in enumerate(lines, start=1):
        account = line.get("account")

        if account is None:
            raise BusinessRuleError(
                f"Journal line {index} requires an account."
            )

        if account.organisation_id != organisation.id:
            raise BusinessRuleError(
                f"Account {account.code} does not belong "
                f"to this organisation."
            )

        if account.status != Account.Status.ACTIVE:
            raise BusinessRuleError(
                f"Account {account.code} is not active."
            )

        try:
            debit = Decimal(
                str(
                    line.get(
                        "debit",
                        Decimal("0.00"),
                    )
                )
            )

            credit = Decimal(
                str(
                    line.get(
                        "credit",
                        Decimal("0.00"),
                    )
                )
            )

        except (ValueError, TypeError, ArithmeticError):
            raise BusinessRuleError(
                f"Journal line {index} contains "
                f"an invalid debit or credit amount."
            )

        if debit < Decimal("0.00"):
            raise BusinessRuleError(
                f"Journal line {index} debit cannot be negative."
            )

        if credit < Decimal("0.00"):
            raise BusinessRuleError(
                f"Journal line {index} credit cannot be negative."
            )

        if (
            debit == Decimal("0.00")
            and credit == Decimal("0.00")
        ):
            raise BusinessRuleError(
                f"Journal line {index} must contain "
                f"a debit or credit amount."
            )

        if (
            debit > Decimal("0.00")
            and credit > Decimal("0.00")
        ):
            raise BusinessRuleError(
                f"Journal line {index} cannot contain "
                f"both a debit and a credit."
            )

        journal_lines.append(
            JournalLine(
                journal_entry=journal_entry,
                account=account,
                description=str(
                    line.get(
                        "description",
                        "",
                    )
                ).strip(),
                debit=debit,
                credit=credit,
            )
        )

    # Insert the already validated lines together. The surrounding transaction
    # rolls the entry and all of its lines back if any database write fails.
    JournalLine.objects.bulk_create(
        journal_lines,
    )

    return journal_entry
