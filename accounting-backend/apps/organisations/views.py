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

    @transaction.atomic
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
        from apps.accounts.identity import audit
        before = {key: str(getattr(serializer.instance, key, '')) for key in serializer.validated_data if key != 'logo_data'}
        obj = serializer.save()
        audit('ORGANISATION_DETAILS_UPDATED', self.request.user, obj, obj, before=before,
              after={key:str(value) for key,value in serializer.validated_data.items() if key != 'logo_data'}, logo_changed='logo_data' in serializer.validated_data)

    def perform_destroy(self, instance):
        self._require_user_management(instance)
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])

    def perform_create(self, serializer):
        from rest_framework.exceptions import ValidationError
        raise ValidationError("Use the confirmed onboarding operation to create a fully configured organisation.")

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
        from rest_framework.exceptions import ValidationError
        raise ValidationError("Invite the member so they can authenticate and accept membership.")

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

    @transaction.atomic
    def perform_update(self, serializer):
        Organisation.objects.select_for_update().get(pk=self.get_organisation().pk)
        instance = self.get_object()
        serializer.instance = instance
        from .invitation_services import allowed_roles
        roles = allowed_roles(instance.organisation, self.request.user)
        if instance.role not in roles or serializer.validated_data.get('role', instance.role) not in roles:
            raise PermissionDenied("You cannot assign or change this role.")
        if 'user' in serializer.validated_data and serializer.validated_data['user'] != instance.user:
            raise PermissionDenied("Membership ownership cannot change.")
        self._protect_last_owner(
            instance,
            new_role=serializer.validated_data.get("role"),
            new_active=serializer.validated_data.get("is_active"),
        )
        serializer.save()
        from apps.accounts.identity import audit
        audit('MEMBERSHIP_UPDATED', self.request.user, instance.organisation, instance, role=instance.role, active=instance.is_active)

    @transaction.atomic
    def perform_destroy(self, instance):
        Organisation.objects.select_for_update().get(pk=self.get_organisation().pk)
        instance.refresh_from_db()
        from .invitation_services import allowed_roles
        if instance.role not in allowed_roles(instance.organisation, self.request.user):
            raise PermissionDenied("You cannot remove this role.")
        self._protect_last_owner(instance, new_active=False)
        instance.is_active = False
        instance.save(update_fields=["is_active"])
        from apps.accounts.identity import audit
        audit('MEMBERSHIP_DEACTIVATED', self.request.user, instance.organisation, instance)
