"""Fail-closed access and relationship checks, shared by APIs and services."""
from django.conf import settings
from django.db.models import Q
from rest_framework.exceptions import NotFound, ValidationError
from apps.organisations.permissions import MANAGE_CONSOLIDATION
from apps.organisations.services.permission_service import require_organisation_permission


def require_enabled():
    if not settings.ENABLE_CONSOLIDATION:
        raise NotFound()


def require_source(user, organisation):
    require_organisation_permission(organisation=organisation, user=user, permission=MANAGE_CONSOLIDATION)


def check_line(group, line, user):
    account = line.get("consolidation_account")
    if not account or account.group_id != group.pk:
        raise ValidationError("Invalid consolidation relationship.")
    for key in ("organisation", "counterparty_organisation"):
        org = line.get(key)
        if org:
            require_source(user, org)
            if not group.members.filter(organisation=org, status="active").exists():
                raise ValidationError("Invalid consolidation relationship.")


def require_group(group, user, period=None):
    require_enabled()
    require_source(user, group.parent_organisation)
    if period and period.group_id != group.pk:
        raise ValidationError("Invalid consolidation period.")
    if group.cta_account_id and group.cta_account.group_id != group.pk:
        raise ValidationError("Invalid consolidation relationship.")
    # Check historical as well as active sources: reports can contain old snapshots.
    members = {m.organisation_id for m in group.members.select_related("organisation")
               if _checked_source(user, m.organisation)}
    for mapping in group.mappings.select_related("organisation", "source_account", "consolidation_account"):
        require_source(user, mapping.organisation)
        if (mapping.organisation_id not in members or mapping.source_account.organisation_id != mapping.organisation_id
                or mapping.consolidation_account.group_id != group.pk):
            raise ValidationError("Invalid consolidation relationship.")
    from .models import ConsolidationSnapshot, EliminationJournal, ConsolidationHistory
    for snapshot in ConsolidationSnapshot.objects.filter(Q(group=group)|Q(period__group=group)).select_related("organisation", "period"):
        require_source(user, snapshot.organisation)
        if snapshot.group_id != group.pk or snapshot.organisation_id not in members or snapshot.period.group_id != group.pk:
            raise ValidationError("Invalid consolidation relationship.")
        for line in snapshot.lines.select_related("source_account", "consolidation_account"):
            if line.source_account.organisation_id != snapshot.organisation_id or line.consolidation_account.group_id != group.pk:
                raise ValidationError("Invalid consolidation relationship.")
    for journal in EliminationJournal.objects.filter(Q(group=group)|Q(period__group=group)).select_related("period", "reversal_of"):
        if journal.group_id != group.pk or journal.period.group_id != group.pk or (journal.reversal_of_id and journal.reversal_of.group_id != group.pk):
            raise ValidationError("Invalid consolidation relationship.")
        for line in journal.lines.select_related("consolidation_account", "organisation", "counterparty_organisation"):
            check_line(group, {key: getattr(line, key) for key in ("consolidation_account", "organisation", "counterparty_organisation")}, user)
    if ConsolidationHistory.objects.filter(Q(group=group)|Q(period__group=group)).exclude(group=group,period__group=group).exists():
        raise ValidationError("Invalid consolidation relationship.")


def _checked_source(user, organisation):
    require_source(user, organisation)
    return True
