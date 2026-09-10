"""Shared posting lock and controlled journal transitions.

PostgreSQL uses a transaction-scoped organisation advisory lock, including in
DB triggers. It serialises period changes and postings without locking an
optional period row before the common lock. SQLite is not concurrency proof.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from django.db import connection, models, transaction
from common.exceptions import BusinessRuleError

_transition = ContextVar('ledger_transition', default=False)
_period_transition = ContextVar('period_transition', default=False)


@contextmanager
def journal_transition():
    token = _transition.set(True)
    try:
        yield
    finally:
        _transition.reset(token)


@contextmanager
def period_transition():
    token = _period_transition.set(True)
    try:
        yield
    finally:
        _period_transition.reset(token)


def lock_ledger(organisation_id):
    if not connection.in_atomic_block:
        raise BusinessRuleError('A ledger operation requires an atomic transaction.')
    if connection.vendor == 'postgresql':
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", [f'ledgify-ledger:{organisation_id}'])


class JournalQuerySet(models.QuerySet):
    @transaction.atomic
    def update(self, **kwargs):
        if self.select_for_update().exclude(status='draft').exists():
            raise BusinessRuleError('Posted or reversed journals are immutable.')
        if any(key in kwargs for key in ('status','reversal_of','reversal_of_id','posted_by','posted_by_id','posted_at')):
            raise BusinessRuleError('Use the journal posting or reversal service.')
        return super().update(**kwargs)

    @transaction.atomic
    def delete(self):
        if self.select_for_update().exclude(status='draft').exists():
            raise BusinessRuleError('Posted or reversed journals cannot be deleted.')
        return super().delete()

    def bulk_create(self, objs, **kwargs):
        if any(obj.status != 'draft' for obj in objs):
            raise BusinessRuleError('Journals must be created as drafts.')
        return super().bulk_create(objs, **kwargs)


class JournalLineQuerySet(models.QuerySet):
    @transaction.atomic
    def _check(self):
        from apps.accounting.models import JournalEntry
        ids=self.values_list('journal_entry_id', flat=True)
        if JournalEntry.objects.select_for_update().filter(pk__in=ids).exclude(status='draft').exists():
            raise BusinessRuleError('Posted or reversed journal lines are immutable.')

    @transaction.atomic
    def update(self, **kwargs):
        self._check()
        if 'journal_entry' in kwargs or 'journal_entry_id' in kwargs:
            raise BusinessRuleError('Bulk journal-line reparenting is not permitted.')
        return super().update(**kwargs)

    @transaction.atomic
    def delete(self):
        self._check()
        return super().delete()

    @transaction.atomic
    def bulk_create(self, objs, **kwargs):
        from apps.accounting.models import JournalEntry
        ids={obj.journal_entry_id for obj in objs}
        parents=list(JournalEntry.objects.select_for_update().filter(pk__in=ids).order_by('id'))
        if len(parents)!=len(ids) or any(parent.status!='draft' for parent in parents):
            raise BusinessRuleError('Lines may only be added to draft journals.')
        return super().bulk_create(objs, **kwargs)


def ledger_transaction(function):
    """Acquire the organisation ledger lock before any domain row locks.

    Use on services with an explicit organisation argument. Nested journal calls
    take the same transaction-scoped lock, which is reentrant on PostgreSQL.
    """
    from functools import wraps
    from inspect import signature
    parameters = signature(function)

    @wraps(function)
    @transaction.atomic
    def wrapped(*args, **kwargs):
        arguments = parameters.bind(*args, **kwargs).arguments
        organisation = arguments["organisation"]
        lock_ledger(organisation.pk)
        return function(*args, **kwargs)
    return wrapped
