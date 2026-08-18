from django.db import transaction
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from .models import Organisation, OrganisationMember
from common.permissions import OrganisationActionPermission
from common.views import OrganisationScopedViewSetMixin
from .permissions import MANAGE_ORGANISATION_USERS, MANAGE_TAX_RATES
from .serializers import OrganisationMemberSerializer, OrganisationSerializer


class OrganisationViewSet(ModelViewSet):
    serializer_class = OrganisationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            Organisation.objects
            .filter(
                members__user=self.request.user,
                members__is_active=True,
                is_active=True,
            )
            .distinct()
        )

    def _require_user_management(self, organisation):
        from .services import require_organisation_permission
        require_organisation_permission(
            organisation=organisation,
            user=self.request.user,
            permission=MANAGE_ORGANISATION_USERS,
        )

    def perform_update(self, serializer):
        tax_fields = {"tax_registered", "tax_registration_number", "tax_scheme",
                      "tax_reporting_currency", "tax_period_frequency", "tax_effective_date"}
        submitted = set(serializer.validated_data)
        if submitted and submitted <= tax_fields:
            from .services import require_organisation_permission
            require_organisation_permission(organisation=self.get_object(), user=self.request.user,
                                            permission=MANAGE_TAX_RATES)
        else:
            self._require_user_management(self.get_object())
        serializer.save()

    def perform_destroy(self, instance):
        self._require_user_management(instance)
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])

    @transaction.atomic
    def perform_create(self, serializer):
        organisation = serializer.save(
            created_by=self.request.user,
        )

        OrganisationMember.objects.create(
            organisation=organisation,
            user=self.request.user,
            role=OrganisationMember.Role.OWNER,
        )

    @action(detail=True, methods=["get"], url_path="my-permissions")
    def my_permissions(self, request, pk=None):
        organisation = self.get_object()
        membership = OrganisationMember.objects.filter(
            organisation=organisation, user=request.user, is_active=True,
        ).first()
        if membership is None:
            raise PermissionDenied("You do not have access to this organisation.")
        from .permissions import ROLE_PERMISSIONS
        return Response({
            "organisation_id": str(organisation.id),
            "role": membership.role,
            "permissions": sorted(ROLE_PERMISSIONS.get(membership.role, ())),
        })


class OrganisationMemberViewSet(OrganisationScopedViewSetMixin, ModelViewSet):
    serializer_class = OrganisationMemberSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {
        "list": MANAGE_ORGANISATION_USERS,
        "retrieve": MANAGE_ORGANISATION_USERS,
        "create": MANAGE_ORGANISATION_USERS,
        "update": MANAGE_ORGANISATION_USERS,
        "partial_update": MANAGE_ORGANISATION_USERS,
        "destroy": MANAGE_ORGANISATION_USERS,
    }

    def get_queryset(self):
        return OrganisationMember.objects.filter(
            organisation=self.get_organisation(),
        ).select_related("user", "organisation")

    def perform_create(self, serializer):
        serializer.save(organisation=self.get_organisation())

    def _protect_last_owner(self, instance, *, new_role=None, new_active=None):
        removing_owner = (
            instance.role == OrganisationMember.Role.OWNER
            and (new_role not in {None, OrganisationMember.Role.OWNER}
                 or new_active is False)
        )
        if removing_owner and not OrganisationMember.objects.filter(
            organisation=instance.organisation,
            role=OrganisationMember.Role.OWNER,
            is_active=True,
        ).exclude(pk=instance.pk).exists():
            raise PermissionDenied("The organisation must retain at least one active owner.")

    def perform_update(self, serializer):
        instance = self.get_object()
        self._protect_last_owner(
            instance,
            new_role=serializer.validated_data.get("role"),
            new_active=serializer.validated_data.get("is_active"),
        )
        serializer.save()

    def perform_destroy(self, instance):
        self._protect_last_owner(instance, new_active=False)
        instance.is_active = False
        instance.save(update_fields=["is_active"])
