"""Resolve organisation roles into explicit permissions used by views and workflows."""

from rest_framework.exceptions import PermissionDenied

from apps.organisations.models import OrganisationMember
from apps.organisations.permissions import ALL_PERMISSIONS, ROLE_PERMISSIONS


def get_membership(*, organisation, user):
    if not user or not user.is_authenticated or not organisation.is_active:
        return None
    return OrganisationMember.objects.filter(
        organisation=organisation,
        user=user,
        is_active=True,
    ).first()


def has_organisation_permission(*, organisation, user, permission):
    if permission not in ALL_PERMISSIONS:
        return False
    membership = get_membership(organisation=organisation, user=user)
    if membership is None:
        return False
    return permission in ROLE_PERMISSIONS.get(membership.role, frozenset())


def require_organisation_permission(*, organisation, user, permission):
    if not has_organisation_permission(
        organisation=organisation, user=user, permission=permission,
    ):
        raise PermissionDenied(
            "You do not have permission to perform this action."
        )
