"""Post a draft journal so its debit and credit lines affect financial reports."""

from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from common.exceptions import BusinessRuleError

from apps.accounting.models import Account, JournalEntry
from apps.accounting.services.periods.period_service import (
    validate_period_open,
)
from apps.organisations.permissions import POST_JOURNAL
from apps.organisations.services import require_organisation_permission


@transaction.atomic
def post_journal_entry(
    journal_entry,
    user,
    check_permissions=True,
):
    """
    Validate and post a draft journal entry.
    """

    journal_entry = (
        JournalEntry.objects
        .select_for_update()
        .select_related("organisation")
        .get(pk=journal_entry.pk)
    )

    if journal_entry.status != JournalEntry.Status.DRAFT:
        raise BusinessRuleError(
            "Only draft journal entries can be posted."
        )

    if check_permissions and journal_entry.source_type == JournalEntry.SourceType.MANUAL:
        require_organisation_permission(
            organisation=journal_entry.organisation,
            user=user,
            permission=POST_JOURNAL,
        )
        if (
            journal_entry.organisation.require_separate_approver
            and journal_entry.created_by_id == user.id
        ):
            raise BusinessRuleError("You cannot approve a transaction you created.")

    # Prevent posting into a locked accounting period.
    validate_period_open(
        journal_entry.organisation,
        journal_entry.date,
    )

    lines = list(
        journal_entry.lines
        .select_related("account")
        .all()
    )

    if len(lines) < 2:
        raise BusinessRuleError(
            "A journal entry must contain at least two lines."
        )

    for index, line in enumerate(lines, start=1):
        account = line.account

        if (
            account.organisation_id
            != journal_entry.organisation_id
        ):
            raise BusinessRuleError(
                f"Journal line {index} uses an account "
                f"from another organisation."
            )

        if account.status != Account.Status.ACTIVE:
            raise BusinessRuleError(
                f"Account {account.code} is not active."
            )

        if (
            journal_entry.source_type
            == JournalEntry.SourceType.MANUAL
            and not account.allow_manual_journals
        ):
            raise BusinessRuleError(
                f"Manual journals are not allowed for account "
                f"{account.code} - {account.name}."
            )

        if line.debit < Decimal("0.00"):
            raise BusinessRuleError(
                f"Journal line {index} debit cannot be negative."
            )

        if line.credit < Decimal("0.00"):
            raise BusinessRuleError(
                f"Journal line {index} credit cannot be negative."
            )

        if (
            line.debit == Decimal("0.00")
            and line.credit == Decimal("0.00")
        ):
            raise BusinessRuleError(
                f"Journal line {index} must contain "
                f"a debit or credit amount."
            )

        if (
            line.debit > Decimal("0.00")
            and line.credit > Decimal("0.00")
        ):
            raise BusinessRuleError(
                f"Journal line {index} cannot contain "
                f"both a debit and a credit."
            )

    totals = journal_entry.lines.aggregate(
        total_debit=Sum("debit"),
        total_credit=Sum("credit"),
    )

    total_debit = (
        totals["total_debit"]
        or Decimal("0.00")
    )

    total_credit = (
        totals["total_credit"]
        or Decimal("0.00")
    )

    if total_debit <= Decimal("0.00"):
        raise BusinessRuleError(
            "The journal entry must contain a debit."
        )

    if total_credit <= Decimal("0.00"):
        raise BusinessRuleError(
            "The journal entry must contain a credit."
        )

    if total_debit != total_credit:
        raise BusinessRuleError(
            f"Journal entry is not balanced. "
            f"Debits: {total_debit}, "
            f"Credits: {total_credit}."
        )

    journal_entry.status = JournalEntry.Status.POSTED
    journal_entry.posted_by = user
    journal_entry.posted_at = timezone.now()

    journal_entry.save(
        update_fields=[
            "status",
            "posted_by",
            "posted_at",
            "updated_at",
        ]
    )

    return journal_entry
