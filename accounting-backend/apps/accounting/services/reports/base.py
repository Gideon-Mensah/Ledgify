"""Provide the organisation-scoped posted-journal query shared by financial reports."""

from decimal import Decimal

from apps.accounting.models import LEDGER_EFFECTIVE_JOURNAL_STATUSES, JournalLine


ZERO = Decimal("0.00")


class ReportQuery:
    """
    Shared base query for financial reports.
    Only posted journal entries are included.
    """

    def __init__(
        self,
        organisation,
        start_date=None,
        end_date=None,
    ):
        self.organisation = organisation
        self.start_date = start_date
        self.end_date = end_date

    def journal_lines(self):
        queryset = (
            JournalLine.objects
            .select_related(
                "account",
                "journal_entry",
            )
            .filter(
                journal_entry__organisation=self.organisation,
                journal_entry__status__in=LEDGER_EFFECTIVE_JOURNAL_STATUSES,
            )
        )

        if self.start_date:
            queryset = queryset.filter(
                journal_entry__date__gte=self.start_date,
            )

        if self.end_date:
            queryset = queryset.filter(
                journal_entry__date__lte=self.end_date,
            )

        return queryset
