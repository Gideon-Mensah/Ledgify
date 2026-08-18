from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet

from common.views import OrganisationScopedViewSetMixin
from common.permissions import OrganisationActionPermission
from apps.organisations.permissions import MANAGE_CONTACTS, VIEW_ACCOUNTING

from .models import Contact
from .serializers import ContactSerializer


class ContactViewSet(
    OrganisationScopedViewSetMixin,
    ModelViewSet,
):
    serializer_class = ContactSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
                          "create": MANAGE_CONTACTS, "update": MANAGE_CONTACTS,
                          "partial_update": MANAGE_CONTACTS, "destroy": MANAGE_CONTACTS}

    def get_queryset(self):
        organisation = self.get_organisation()

        queryset = Contact.objects.filter(
            organisation=organisation,
        )

        contact_type = self.request.query_params.get(
            "type"
        )

        if contact_type == "customer":
            queryset = queryset.filter(
                is_customer=True,
            )

        elif contact_type == "supplier":
            queryset = queryset.filter(
                is_supplier=True,
            )

        return queryset

    def perform_create(self, serializer):
        serializer.save(
            organisation=self.get_organisation(),
            created_by=self.request.user,
        )
