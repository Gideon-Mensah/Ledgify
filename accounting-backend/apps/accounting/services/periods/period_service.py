"""Manage accounting period locks that prevent transactions changing closed reports."""

from django.db import transaction
from django.utils import timezone

from common.exceptions import BusinessRuleError

from apps.accounting.models import AccountingPeriod, AccountingPeriodHistory
from apps.organisations.permissions import CLOSE_PERIOD, REOPEN_PERIOD
from apps.organisations.services import require_organisation_permission


def get_accounting_period(
    organisation,
    transaction_date,
):
    return (
        AccountingPeriod.objects
        .filter(
            organisation=organisation,
            start_date__lte=transaction_date,
            end_date__gte=transaction_date,
        )
        .first()
    )


def validate_period_open(
    organisation,
    transaction_date,
):
    period = get_accounting_period(
        organisation,
        transaction_date,
    )

    if period is None:
        return None

    if period.status == AccountingPeriod.Status.LOCKED:
        raise BusinessRuleError(
            f"Accounting period {period.name} is locked. "
            f"Transactions cannot be posted to this period."
        )

    return period


@transaction.atomic
def lock_accounting_period(
    *,
    period,
    user,
):
    period = (
        AccountingPeriod.objects
        .select_for_update()
        .get(pk=period.pk)
    )
    require_organisation_permission(
        organisation=period.organisation, user=user, permission=CLOSE_PERIOD,
    )

    if period.status == AccountingPeriod.Status.LOCKED:
        raise BusinessRuleError(
            "This accounting period is already locked."
        )

    period.status = AccountingPeriod.Status.LOCKED
    period.locked_by = user
    period.locked_at = timezone.now()

    period.save(
        update_fields=[
            "status",
            "locked_by",
            "locked_at",
            "updated_at",
        ]
    )

    AccountingPeriodHistory.objects.create(
        organisation=period.organisation,
        accounting_period=period,
        action=AccountingPeriodHistory.Action.LOCKED,
        performed_by=user,
    )

    return period


@transaction.atomic
def reopen_accounting_period(*, period, user, reason):
    period = AccountingPeriod.objects.select_for_update().get(pk=period.pk)
    require_organisation_permission(
        organisation=period.organisation, user=user, permission=REOPEN_PERIOD,
    )
    reason = str(reason).strip()
    if not reason:
        raise BusinessRuleError("A reason is required to reopen an accounting period.")
    if period.status != AccountingPeriod.Status.LOCKED:
        raise BusinessRuleError("Only a locked accounting period can be reopened.")
    period.status = AccountingPeriod.Status.OPEN
    period.locked_at = None
    period.locked_by = None
    period.save(update_fields=["status", "locked_at", "locked_by", "updated_at"])
    AccountingPeriodHistory.objects.create(
        organisation=period.organisation,
        accounting_period=period,
        action=AccountingPeriodHistory.Action.REOPENED,
        performed_by=user,
        reason=reason,
    )
    return period
