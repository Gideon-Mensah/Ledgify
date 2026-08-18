from rest_framework.permissions import BasePermission, SAFE_METHODS

from apps.organisations.permissions import VIEW_ACCOUNTING


class OrganisationActionPermission(BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        required = getattr(view, "action_permissions", {}).get(
            getattr(view, "action", None)
        )
        if required is None:
            if request.method in SAFE_METHODS:
                required = VIEW_ACCOUNTING
            else:
                return False
        view.require_permission(required)
        return True
