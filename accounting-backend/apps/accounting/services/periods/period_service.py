"""Inclusive, non-overlapping periods sharing the organisation posting lock."""
from django.db import transaction
from django.utils import timezone
from common.exceptions import BusinessRuleError
from common.ledger_integrity import lock_ledger, period_transition
from apps.accounting.models import AccountingPeriod, AccountingPeriodHistory, FinancialYear
from apps.organisations.permissions import CLOSE_PERIOD, REOPEN_PERIOD
from apps.organisations.services import require_organisation_permission


def get_accounting_period(organisation, transaction_date):
    periods=list(AccountingPeriod.objects.filter(organisation=organisation,
        start_date__lte=transaction_date,end_date__gte=transaction_date)[:2])
    if not periods:
        raise BusinessRuleError('Create an accounting period covering the transaction date before posting.')
    if len(periods)!=1:
        raise BusinessRuleError('Overlapping accounting periods require review before posting.')
    return periods[0]


@transaction.atomic
def validate_period_open(organisation, transaction_date):
    lock_ledger(organisation.pk)
    period=get_accounting_period(organisation,transaction_date)
    if period.status != AccountingPeriod.Status.OPEN:
        raise BusinessRuleError('The accounting period is closed or locked.')
    if FinancialYear.objects.filter(organisation=organisation,status=FinancialYear.Status.CLOSED,
                                   start_date__lte=transaction_date,end_date__gte=transaction_date).exists():
        raise BusinessRuleError('The financial year is closed.')
    return period


@transaction.atomic
def lock_accounting_period(*, period, user):
    lock_ledger(period.organisation_id)
    period=AccountingPeriod.objects.select_for_update().get(pk=period.pk)
    require_organisation_permission(organisation=period.organisation,user=user,permission=CLOSE_PERIOD)
    if period.status != AccountingPeriod.Status.OPEN:
        raise BusinessRuleError('This accounting period is already locked.')
    AccountingPeriodHistory.objects.create(organisation=period.organisation,accounting_period=period,
        action=AccountingPeriodHistory.Action.LOCKED,performed_by=user)
    period.status=AccountingPeriod.Status.LOCKED
    period.locked_by=user;period.locked_at=timezone.now()
    with period_transition():
        period.save(update_fields=['status','locked_by','locked_at','updated_at'])
    return period


@transaction.atomic
def reopen_accounting_period(*, period, user, reason):
    lock_ledger(period.organisation_id)
    period=AccountingPeriod.objects.select_for_update().get(pk=period.pk)
    require_organisation_permission(organisation=period.organisation,user=user,permission=REOPEN_PERIOD)
    if not isinstance(reason,str) or not reason.strip():
        raise BusinessRuleError('A reason is required to reopen an accounting period.')
    if period.status != AccountingPeriod.Status.LOCKED:
        raise BusinessRuleError('Only a locked accounting period can be reopened.')
    AccountingPeriodHistory.objects.create(organisation=period.organisation,accounting_period=period,
        action=AccountingPeriodHistory.Action.REOPENED,performed_by=user,reason=reason.strip())
    period.status=AccountingPeriod.Status.OPEN;period.locked_at=None;period.locked_by=None
    with period_transition():
        period.save(update_fields=['status','locked_at','locked_by','updated_at'])
    return period
