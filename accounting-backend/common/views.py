from rest_framework.exceptions import PermissionDenied


class OrganisationScopedViewSetMixin:
    def get_organisation(self):
        if hasattr(self, "_organisation"):
            return self._organisation
        organisation_id = self.request.headers.get(
            "X-Organisation-ID"
        )

        if not organisation_id:
            raise PermissionDenied(
                "X-Organisation-ID header is required."
            )

        from apps.organisations.models import OrganisationMember

        membership = (
            OrganisationMember.objects
            .select_related("organisation")
            .filter(
                organisation_id=organisation_id,
                user=self.request.user,
                is_active=True,
                organisation__is_active=True,
            )
            .first()
        )

        if not membership:
            raise PermissionDenied(
                "You do not have access to this organisation."
            )

        self._membership = membership
        self._organisation = membership.organisation
        return self._organisation

    def get_membership(self):
        if not hasattr(self, "_membership"):
            self.get_organisation()
        return self._membership

    def require_permission(self, permission):
        from apps.organisations.services.permission_service import (
            require_organisation_permission,
        )
        require_organisation_permission(
            organisation=self.get_organisation(),
            user=self.request.user,
            permission=permission,
        )

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["organisation"] = self.get_organisation()
        return context
