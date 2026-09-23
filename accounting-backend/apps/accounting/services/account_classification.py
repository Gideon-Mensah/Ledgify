"""Serialised account maintenance; never updates source documents or journal lines."""
from copy import copy
from contextlib import contextmanager
from django.db import connection, transaction
from django.db.models import Exists, OuterRef, Value
from rest_framework.exceptions import ValidationError
from common.ledger_integrity import lock_ledger
from apps.accounting.models import Account, AccountClassificationEvent
from .reports.cash_flow_service import CashFlowReport

CLASS_TYPES = {
    'bank':'asset', 'current_asset':'asset', 'fixed_asset':'asset', 'receivable':'asset',
    'current_liability':'liability', 'long_term_liability':'liability', 'payable':'liability',
    'equity':'equity', 'retained_earnings':'equity', 'sales':'revenue', 'other_income':'revenue',
    'cost_of_sales':'expense', 'operating_expense':'expense', 'other_expense':'expense',
}
CONTROLS = {'receivable', 'payable', 'retained_earnings'}
TYPE_ERROR = 'This account contains accounting activity. Its account type cannot be changed because doing so could alter historical financial statement presentation.'
FIELDS = ('account_type', 'account_class', 'currency', 'cash_flow_category', 'status', 'is_current_control')


def references(account):
    """Include draft sources, opening lines and configuration, not just posted journals."""
    found = []
    for relation in Account._meta.related_objects:
        model = relation.related_model
        if model is AccountClassificationEvent:
            continue
        if model._default_manager.filter(**{relation.field.name: account}).exists():
            found.append(model._meta.label_lower)
    return found


CONFIGURATION_APPS = {'tax','banking','payroll','inventory','manufacturing','organisations'}


def with_classification_policy(queryset):
    activity, configuration = Value(False), Value(False)
    for relation in Account._meta.related_objects:
        model = relation.related_model
        if model is AccountClassificationEvent: continue
        used = Exists(model._default_manager.filter(**{relation.field.attname: OuterRef('pk')}))
        activity = activity | used
        if model._meta.app_label in CONFIGURATION_APPS: configuration = configuration | used
    return queryset.annotate(_classification_activity=activity, _classification_configuration=configuration)


def policy(account):
    if hasattr(account, '_classification_activity'):
        used, configured = account._classification_activity, account._classification_configuration
    else:
        refs = references(account)
        used = bool(refs)
        configured = any(name.split('.')[0] in CONFIGURATION_APPS for name in refs)
    protected = account.is_system_account or account.account_class in CONTROLS or configured
    return {'has_activity': used, 'protected': protected,
            'can_change_type': not used and not protected,
            'can_change_class': not protected,
            'can_replace_control': account.account_class in {'receivable','payable'} and account.status == 'active' and account.is_current_control and not configured}


def snapshot(account):
    return {key: getattr(account, key) for key in FIELDS}


def compatible(kind, klass):
    if CLASS_TYPES.get(klass) != kind:
        label = dict(Account.AccountClass.choices).get(klass, klass)
        raise ValidationError({'account_class': f'{label} must use the {CLASS_TYPES.get(klass, "compatible").title()} account type.'})


def unique_control(organisation, klass, status, exclude=None):
    if klass in CONTROLS and status == 'active' and Account.objects.filter(organisation=organisation, account_class=klass, status='active', is_current_control=True).exclude(pk=exclude).exists():
        raise ValidationError({'account_class': f'An active {dict(Account.AccountClass.choices)[klass]} control account already exists. Use controlled replacement for future postings.'})


@contextmanager
def audited_change(event):
    if connection.vendor == 'postgresql':
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('ledgify.account_classification_event', %s, true)", [str(event.pk)])
    try:
        yield
    finally:
        if connection.vendor == 'postgresql':
            with connection.cursor() as cursor:
                cursor.execute("SELECT set_config('ledgify.account_classification_event', '', true)")


def cash_behaviour(account):
    report = object.__new__(CashFlowReport)
    return report._is_cash_account(account), report._classify_counterpart(account)


@transaction.atomic
def update_account(account, values, user, *, confirmed=False, reason=''):
    from apps.organisations.services import require_organisation_permission
    require_organisation_permission(organisation=account.organisation,user=user,permission='manage_accounts')
    lock_ledger(account.organisation_id)
    account = Account.objects.select_for_update().get(pk=account.pk, organisation_id=account.organisation_id)
    before = snapshot(account)
    proposed = copy(account)
    for key, value in values.items(): setattr(proposed, key, value)
    changed = [key for key in FIELDS if getattr(proposed,key) != getattr(account,key)]
    rules = policy(account)
    if 'account_type' in changed and rules['has_activity']:
        raise ValidationError({'account_type': TYPE_ERROR})
    if rules['protected'] and any(key in changed for key in FIELDS):
        raise ValidationError('This system/control account cannot be reclassified or deactivated while configured for automatic postings. Use controlled replacement where available.')
    if rules['has_activity'] and 'currency' in changed:
        raise ValidationError({'currency': 'Currency cannot change on an account containing accounting activity.'})
    if rules['has_activity'] and cash_behaviour(account) != cash_behaviour(proposed):
        raise ValidationError({'account_class': 'This change would alter historical Cash Flow presentation. Keep the existing cash classification.'})
    if any(key in changed for key in ('account_type','account_class')):
        compatible(proposed.account_type, proposed.account_class)
        if confirmed is not True or not reason.strip():
            raise ValidationError({'classification_confirmed': 'Explicit confirmation and a reason are required. Historical transactions will not be modified; financial statement grouping and future control-account behaviour may change.'})
    if any(key in changed for key in ('account_class','status','account_type')):
        unique_control(account.organisation, proposed.account_class, proposed.status, account.pk)
    event = None
    if changed:
        event = AccountClassificationEvent.objects.create(organisation=account.organisation, account=account, performed_by=user, reason=reason.strip() or 'Account settings updated', before=before, after=snapshot(proposed))
    for key,value in values.items(): setattr(account,key,value)
    if event:
        with audited_change(event):
            with transaction.atomic(): account.save()
    else: account.save()
    return account


@transaction.atomic
def create_account(values):
    lock_ledger(values['organisation'].pk)
    compatible(values['account_type'], values['account_class'])
    unique_control(values['organisation'], values['account_class'], values.get('status','active'))
    return Account.objects.create(**values)


@transaction.atomic
def delete_account(account):
    lock_ledger(account.organisation_id)
    account = Account.objects.select_for_update().get(pk=account.pk)
    rules = policy(account)
    if rules['protected'] or rules['has_activity'] or account.classification_events.exists() or account.control_replacement_events.exists():
        raise ValidationError('Accounts with accounting activity, configuration or classification history cannot be deleted. Preserve the audit history.')
    account.delete()


@transaction.atomic
def replace_control(old, replacement_id, user, *, confirmed, reason):
    from apps.organisations.services import require_organisation_permission
    require_organisation_permission(organisation=old.organisation,user=user,permission='manage_accounts')
    lock_ledger(old.organisation_id)
    old = Account.objects.select_for_update().get(pk=old.pk, organisation_id=old.organisation_id)
    target = Account.objects.select_for_update().filter(pk=replacement_id, organisation_id=old.organisation_id).first()
    if not target or target.pk == old.pk:
        raise ValidationError({'replacement_id': 'Select a different account in the current organisation.'})
    if confirmed is not True or not reason.strip():
        raise ValidationError('Confirm that historical transactions stay on the old account, future postings use the replacement, and balances are not transferred. Enter a reason.')
    if not policy(old)['can_replace_control']:
        raise ValidationError('Only active AR/AP controls without other system configuration can be replaced here. Other controls require their configuration-specific workflow.')
    if Account.objects.filter(organisation_id=old.organisation_id, account_class=old.account_class, status='active', is_current_control=True).exclude(pk=old.pk).exists():
        raise ValidationError('Multiple active controls exist. Resolve the legacy configuration before replacement.')
    rules = policy(target)
    if rules['has_activity'] or rules['protected'] or target.status != 'active' or target.account_type != old.account_type or target.currency != old.currency:
        raise ValidationError({'replacement_id': 'Choose an unused, active, unprotected account with the same type and currency as the existing control.'})
    before = snapshot(old)
    old.is_current_control = False
    target_before = snapshot(target)
    target.account_class = old.account_class
    target.cash_flow_category = old.cash_flow_category
    target.is_system_account = True
    target.is_current_control = True
    AccountClassificationEvent.objects.create(organisation=old.organisation, account=old, replacement=target, performed_by=user, reason=reason.strip(), before={'old':before,'replacement':target_before}, after={'old':snapshot(old),'replacement':snapshot(target)})
    old.save(update_fields=['is_current_control','updated_at'])
    target.save(update_fields=['account_class','cash_flow_category','is_system_account','is_current_control','updated_at'])
    return target
