"""Close a financial year and roll its final profit into retained earnings safely."""

from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from common.exceptions import BusinessRuleError
from apps.accounting.models import (
    LEDGER_EFFECTIVE_JOURNAL_STATUSES,
    Account,
    AccountingPeriod,
    AccountingPeriodHistory,
    FinancialYear,
    FinancialYearHistory,
    JournalEntry,
    JournalLine,
)
from apps.accounting.services.journals import (
    create_journal_entry,
    post_journal_entry,
    reverse_journal_entry,
)
from apps.organisations.permissions import (
    CLOSE_FINANCIAL_YEAR,
    REOPEN_FINANCIAL_YEAR,
)
from apps.organisations.services import require_organisation_permission


ZERO = Decimal("0.00")


def _lock_year(organisation, financial_year):
    financial_year = FinancialYear.objects.select_for_update().get(
        pk=financial_year.pk
    )
    if financial_year.organisation_id != organisation.id:
        raise BusinessRuleError(
            "Financial year does not belong to this organisation."
        )
    return financial_year


def _year_periods(financial_year):
    return list(
        AccountingPeriod.objects.select_for_update()
        .filter(
            organisation=financial_year.organisation,
            start_date__gte=financial_year.start_date,
            end_date__lte=financial_year.end_date,
        )
        .order_by("start_date", "end_date", "id")
    )


def _validate_periods_and_journals(financial_year, periods):
    if not periods:
        raise BusinessRuleError("The financial year has no accounting periods.")
    final_period = periods[-1]
    if final_period.end_date != financial_year.end_date:
        raise BusinessRuleError(
            "The final accounting period must end on the financial year end date."
        )
    if any(
        period.status != AccountingPeriod.Status.LOCKED
        for period in periods[:-1]
    ):
        raise BusinessRuleError(
            "All accounting periods before the final period must be locked."
        )
    if final_period.status != AccountingPeriod.Status.OPEN:
        raise BusinessRuleError(
            "The final accounting period must be open for the year-end close."
        )

    journals = JournalEntry.objects.filter(
        organisation=financial_year.organisation,
        date__range=(financial_year.start_date, financial_year.end_date),
    )
    if journals.filter(status=JournalEntry.Status.DRAFT).exists():
        raise BusinessRuleError(
            "All draft journals in the financial year must be posted or removed."
        )
    period_ranges = [(item.start_date, item.end_date) for item in periods]
    for journal_date in journals.values_list("date", flat=True).distinct():
        if not any(start <= journal_date <= end for start, end in period_ranges):
            raise BusinessRuleError(
                "Every journal date in the financial year must be covered by an accounting period."
            )
    return final_period


def _retained_earnings_account(organisation):
    accounts = Account.objects.select_for_update().filter(
        organisation=organisation,
        account_type=Account.AccountType.EQUITY,
        account_class=Account.AccountClass.RETAINED_EARNINGS,
        status=Account.Status.ACTIVE,
    )
    if accounts.count() != 1:
        raise BusinessRuleError(
            "The organisation must have exactly one active Retained Earnings account."
        )
    return accounts.get()


def _closing_lines(financial_year, retained_earnings):
    balances = (
        JournalLine.objects.filter(
            journal_entry__organisation=financial_year.organisation,
            journal_entry__status__in=LEDGER_EFFECTIVE_JOURNAL_STATUSES,
            journal_entry__date__range=(
                financial_year.start_date,
                financial_year.end_date,
            ),
            account__account_type__in=[
                Account.AccountType.REVENUE,
                Account.AccountType.EXPENSE,
            ],
        )
        .exclude(journal_entry__source_type=JournalEntry.SourceType.YEAR_END_CLOSE)
        .values("account_id", "account__account_type")
        .annotate(total_debit=Sum("debit"), total_credit=Sum("credit"))
        .order_by("account_id")
    )
    accounts = {
        item.id: item
        for item in Account.objects.filter(
            organisation=financial_year.organisation,
            id__in=[row["account_id"] for row in balances],
        )
    }
    lines = []
    total_revenue = ZERO
    total_expenses = ZERO
    for row in balances:
        debit = row["total_debit"] or ZERO
        credit = row["total_credit"] or ZERO
        account = accounts[row["account_id"]]
        if row["account__account_type"] == Account.AccountType.REVENUE:
            balance = credit - debit
            total_revenue += balance
            closing_debit = balance if balance > ZERO else ZERO
            closing_credit = abs(balance) if balance < ZERO else ZERO
        else:
            balance = debit - credit
            total_expenses += balance
            closing_credit = balance if balance > ZERO else ZERO
            closing_debit = abs(balance) if balance < ZERO else ZERO
        if balance != ZERO:
            lines.append({
                "account": account,
                "description": f"Year-end close - {account.name}",
                "debit": closing_debit,
                "credit": closing_credit,
            })

    net_profit = total_revenue - total_expenses
    if net_profit > ZERO:
        lines.append({
            "account": retained_earnings,
            "description": "Year-end profit transferred to retained earnings",
            "debit": ZERO,
            "credit": net_profit,
        })
    elif net_profit < ZERO:
        lines.append({
            "account": retained_earnings,
            "description": "Year-end loss transferred to retained earnings",
            "debit": abs(net_profit),
            "credit": ZERO,
        })

    total_debits = sum((item["debit"] for item in lines), ZERO)
    total_credits = sum((item["credit"] for item in lines), ZERO)
    if total_debits != total_credits:
        raise BusinessRuleError("Year-end closing journal is not balanced.")
    if lines and len(lines) < 2:
        raise BusinessRuleError(
            "Year-end closing journal does not contain enough valid lines."
        )
    return lines, net_profit


@transaction.atomic
def close_financial_year_with_retained_earnings(
    *, organisation, financial_year, user
):
    financial_year = _lock_year(organisation, financial_year)
    require_organisation_permission(
        organisation=organisation, user=user, permission=CLOSE_FINANCIAL_YEAR,
    )
    duplicate = (
        financial_year.status != FinancialYear.Status.OPEN
        or financial_year.closing_journal_id is not None
        or FinancialYearHistory.objects.filter(
            financial_year=financial_year,
            action=FinancialYearHistory.Action.CLOSED,
        ).exists()
        or JournalEntry.objects.filter(
            organisation=organisation,
            source_type=JournalEntry.SourceType.YEAR_END_CLOSE,
            source_id=financial_year.id,
        ).exists()
    )
    if duplicate:
        raise BusinessRuleError("This financial year has already been closed.")

    periods = _year_periods(financial_year)
    final_period = _validate_periods_and_journals(financial_year, periods)
    retained_earnings = _retained_earnings_account(organisation)
    lines, net_profit = _closing_lines(financial_year, retained_earnings)

    closing_journal = None
    if lines:
        closing_journal = create_journal_entry(
            organisation=organisation,
            date=financial_year.end_date,
            description=f"Year-end close - {financial_year.name}",
            reference=financial_year.name,
            source_type=JournalEntry.SourceType.YEAR_END_CLOSE,
            source_id=financial_year.id,
            user=user,
            lines=lines,
        )
        post_journal_entry(journal_entry=closing_journal, user=user)

    now = timezone.now()
    final_period.status = AccountingPeriod.Status.LOCKED
    final_period.locked_at = now
    final_period.locked_by = user
    final_period.save(update_fields=[
        "status", "locked_at", "locked_by", "updated_at",
    ])
    AccountingPeriodHistory.objects.create(
        organisation=organisation,
        accounting_period=final_period,
        action=AccountingPeriodHistory.Action.LOCKED,
        performed_by=user,
        metadata={"financial_year_id": str(financial_year.id)},
    )

    financial_year.closing_journal = closing_journal
    financial_year.profit_or_loss = net_profit
    financial_year.status = FinancialYear.Status.CLOSED
    financial_year.closed_at = now
    financial_year.closed_by = user
    financial_year.save(update_fields=[
        "closing_journal", "profit_or_loss", "status", "closed_at",
        "closed_by", "updated_at",
    ])
    FinancialYearHistory.objects.create(
        organisation=organisation,
        financial_year=financial_year,
        action=FinancialYearHistory.Action.CLOSED,
        performed_by=user,
        accounting_journal=closing_journal,
        metadata={"profit_or_loss": str(net_profit)},
    )
    return financial_year


@transaction.atomic
def reopen_financial_year(
    *, organisation, financial_year, user, reason, reversal_date=None
):
    financial_year = _lock_year(organisation, financial_year)
    require_organisation_permission(
        organisation=organisation, user=user, permission=REOPEN_FINANCIAL_YEAR,
    )
    reason = str(reason).strip()
    if not reason:
        raise BusinessRuleError("A reason is required to reopen a financial year.")
    if financial_year.status != FinancialYear.Status.CLOSED:
        raise BusinessRuleError("Only a closed financial year can be reopened.")
    if financial_year.closing_reversal_journal_id:
        raise BusinessRuleError("This financial year close has already been reversed.")

    periods = _year_periods(financial_year)
    if not periods or periods[-1].end_date != financial_year.end_date:
        raise BusinessRuleError("The final accounting period was not found.")
    final_period = periods[-1]
    final_period.status = AccountingPeriod.Status.OPEN
    final_period.locked_at = None
    final_period.locked_by = None
    final_period.save(update_fields=[
        "status", "locked_at", "locked_by", "updated_at",
    ])
    AccountingPeriodHistory.objects.create(
        organisation=organisation,
        accounting_period=final_period,
        action=AccountingPeriodHistory.Action.REOPENED,
        performed_by=user,
        reason=reason,
        metadata={"financial_year_id": str(financial_year.id)},
    )

    reversal = None
    if financial_year.closing_journal_id:
        requested_date = reversal_date or financial_year.end_date
        if requested_date != financial_year.end_date:
            raise BusinessRuleError(
                "The year-end close must be reversed on the financial year end date."
            )
        reversal = reverse_journal_entry(
            journal_entry=financial_year.closing_journal,
            user=user,
            reversal_date=requested_date,
            check_permissions=False,
        )

    financial_year.closing_reversal_journal = reversal
    financial_year.status = FinancialYear.Status.OPEN
    financial_year.closed_at = None
    financial_year.closed_by = None
    financial_year.save(update_fields=[
        "closing_reversal_journal", "status", "closed_at", "closed_by",
        "updated_at",
    ])
    FinancialYearHistory.objects.create(
        organisation=organisation,
        financial_year=financial_year,
        action=FinancialYearHistory.Action.REOPENED,
        performed_by=user,
        reason=reason,
        accounting_journal=reversal,
        metadata={
            "closing_journal_id": (
                str(financial_year.closing_journal_id)
                if financial_year.closing_journal_id else None
            ),
        },
    )
    return financial_year
