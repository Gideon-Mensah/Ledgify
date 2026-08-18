from django.utils import timezone

from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet

from common.views import OrganisationScopedViewSetMixin
from common.permissions import OrganisationActionPermission
from apps.organisations.permissions import VIEW_ACCOUNTING

from apps.contacts.models import Contact

from .serializers import (
    AgedPayablesQuerySerializer,
    AgedReceivablesQuerySerializer,
    CustomerBalanceQuerySerializer,
    CustomerStatementQuerySerializer,
    SupplierBalanceQuerySerializer,
    SupplierStatementQuerySerializer,
)
from .services import (
    aged_payables,
    aged_receivables,
    customer_balance_summary,
    customer_statement,
    supplier_balance_summary,
    supplier_statement,
)


def _resolve_customer(
    *,
    organisation,
    customer_id,
):
    if customer_id is None:
        return None

    customer = Contact.objects.filter(
        id=customer_id,
        organisation=organisation,
        is_customer=True,
    ).first()

    if customer is None:
        raise ValidationError(
            "Customer not found in this organisation."
        )

    return customer


def _resolve_supplier(
    *,
    organisation,
    supplier_id,
):
    if supplier_id is None:
        return None

    supplier = Contact.objects.filter(
        id=supplier_id,
        organisation=organisation,
        is_supplier=True,
    ).first()

    if supplier is None:
        raise ValidationError(
            "Supplier not found in this organisation."
        )

    return supplier


class FinanceReportViewSet(
    OrganisationScopedViewSetMixin,
    ViewSet,
):
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {
        "aged_receivables_report": VIEW_ACCOUNTING,
        "aged_payables_report": VIEW_ACCOUNTING,
        "customer_balances_report": VIEW_ACCOUNTING,
        "supplier_balances_report": VIEW_ACCOUNTING,
        "customer_statement_report": VIEW_ACCOUNTING,
        "supplier_statement_report": VIEW_ACCOUNTING,
    }

    @action(
        detail=False,
        methods=["get"],
        url_path="aged-receivables",
    )
    def aged_receivables_report(self, request):
        query = AgedReceivablesQuerySerializer(
            data=request.query_params,
        )
        query.is_valid(raise_exception=True)

        organisation = self.get_organisation()
        customer = _resolve_customer(
            organisation=organisation,
            customer_id=query.validated_data.get("customer_id"),
        )
        data = aged_receivables(
            organisation=organisation,
            as_of_date=(
                query.validated_data.get("as_of_date")
                or timezone.localdate()
            ),
            customer=customer,
        )

        return Response(data)

    @action(
        detail=False,
        methods=["get"],
        url_path="aged-payables",
    )
    def aged_payables_report(self, request):
        query = AgedPayablesQuerySerializer(
            data=request.query_params,
        )
        query.is_valid(raise_exception=True)

        organisation = self.get_organisation()
        supplier = _resolve_supplier(
            organisation=organisation,
            supplier_id=query.validated_data.get("supplier_id"),
        )
        data = aged_payables(
            organisation=organisation,
            as_of_date=(
                query.validated_data.get("as_of_date")
                or timezone.localdate()
            ),
            supplier=supplier,
        )

        return Response(data)

    @action(
        detail=False,
        methods=["get"],
        url_path="customer-balances",
    )
    def customer_balances_report(self, request):
        query = CustomerBalanceQuerySerializer(
            data=request.query_params,
        )
        query.is_valid(raise_exception=True)

        organisation = self.get_organisation()
        customer = _resolve_customer(
            organisation=organisation,
            customer_id=query.validated_data.get("customer_id"),
        )
        data = customer_balance_summary(
            organisation=organisation,
            customer=customer,
        )

        return Response(data)

    @action(
        detail=False,
        methods=["get"],
        url_path="supplier-balances",
    )
    def supplier_balances_report(self, request):
        query = SupplierBalanceQuerySerializer(
            data=request.query_params,
        )
        query.is_valid(raise_exception=True)

        organisation = self.get_organisation()
        supplier = _resolve_supplier(
            organisation=organisation,
            supplier_id=query.validated_data.get("supplier_id"),
        )
        data = supplier_balance_summary(
            organisation=organisation,
            supplier=supplier,
        )

        return Response(data)

    @action(
        detail=False,
        methods=["get"],
        url_path="customer-statement",
    )
    def customer_statement_report(self, request):
        query = CustomerStatementQuerySerializer(
            data=request.query_params,
        )
        query.is_valid(raise_exception=True)

        organisation = self.get_organisation()
        customer = _resolve_customer(
            organisation=organisation,
            customer_id=query.validated_data["customer_id"],
        )
        data = customer_statement(
            organisation=organisation,
            customer=customer,
            start_date=query.validated_data.get("start_date"),
            end_date=(
                query.validated_data.get("end_date")
                or timezone.localdate()
            ),
        )

        return Response(data)

    @action(
        detail=False,
        methods=["get"],
        url_path="supplier-statement",
    )
    def supplier_statement_report(self, request):
        query = SupplierStatementQuerySerializer(
            data=request.query_params,
        )
        query.is_valid(raise_exception=True)

        organisation = self.get_organisation()
        supplier = _resolve_supplier(
            organisation=organisation,
            supplier_id=query.validated_data["supplier_id"],
        )
        data = supplier_statement(
            organisation=organisation,
            supplier=supplier,
            start_date=query.validated_data.get("start_date"),
            end_date=(
                query.validated_data.get("end_date")
                or timezone.localdate()
            ),
        )

        return Response(data)
