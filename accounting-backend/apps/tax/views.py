"""Organisation tax endpoints that use configured rates and posted ledger data."""

from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet, ViewSet

from common.permissions import OrganisationActionPermission
from common.views import OrganisationScopedViewSetMixin
from apps.organisations.permissions import MANAGE_TAX_RATES, PREPARE_TAX_RETURN, VIEW_TAX
from apps.tax.models import TaxPeriod, TaxRate, TaxTransaction
from apps.tax.serializers import TaxPeriodSerializer, TaxRateSerializer, TaxReportQuerySerializer, TaxTransactionSerializer
from apps.tax.services.report_service import tax_liability, tax_summary


class TaxRateViewSet(OrganisationScopedViewSetMixin, ModelViewSet):
    serializer_class = TaxRateSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_TAX, "retrieve": VIEW_TAX, "create": MANAGE_TAX_RATES,
                          "update": MANAGE_TAX_RATES, "partial_update": MANAGE_TAX_RATES,
                          "destroy": MANAGE_TAX_RATES}
    def get_queryset(self):
        return TaxRate.objects.filter(organisation=self.get_organisation()).select_related("input_tax_account", "output_tax_account")
    def perform_create(self, serializer):
        serializer.save(organisation=self.get_organisation(), created_by=self.request.user)


class TaxPeriodViewSet(OrganisationScopedViewSetMixin, ModelViewSet):
    serializer_class = TaxPeriodSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_TAX, "retrieve": VIEW_TAX, "create": PREPARE_TAX_RETURN,
                          "update": PREPARE_TAX_RETURN, "partial_update": PREPARE_TAX_RETURN,
                          "destroy": PREPARE_TAX_RETURN}
    def get_queryset(self): return TaxPeriod.objects.filter(organisation=self.get_organisation())
    def perform_create(self, serializer): serializer.save(organisation=self.get_organisation())


class TaxTransactionViewSet(OrganisationScopedViewSetMixin, ReadOnlyModelViewSet):
    serializer_class = TaxTransactionSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_TAX, "retrieve": VIEW_TAX}
    def get_queryset(self):
        qs = TaxTransaction.objects.filter(organisation=self.get_organisation()).select_related("tax_rate", "contact", "tax_account", "journal_entry")
        for field in ("tax_rate", "direction", "status"):
            if self.request.query_params.get(field): qs = qs.filter(**{field: self.request.query_params[field]})
        if self.request.query_params.get("start_date"): qs = qs.filter(transaction_date__gte=self.request.query_params["start_date"])
        if self.request.query_params.get("end_date"): qs = qs.filter(transaction_date__lte=self.request.query_params["end_date"])
        return qs


class TaxReportViewSet(OrganisationScopedViewSetMixin, ViewSet):
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"summary": VIEW_TAX, "preview": PREPARE_TAX_RETURN, "liability": VIEW_TAX}
    def _report(self, request):
        query = TaxReportQuerySerializer(data=request.query_params); query.is_valid(raise_exception=True)
        data = {key: value for key, value in query.validated_data.items() if key in {"start_date", "end_date"}}
        return Response(tax_summary(organisation=self.get_organisation(), **data))
    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request): return self._report(request)
    @action(detail=False, methods=["get"], url_path="returns/preview")
    def preview(self, request): return self._report(request)
    @action(detail=False, methods=["get"], url_path="liability")
    def liability(self, request):
        query = TaxReportQuerySerializer(data=request.query_params); query.is_valid(raise_exception=True)
        data = {key: value for key, value in query.validated_data.items() if key in {"start_date", "end_date"}}
        return Response(tax_liability(organisation=self.get_organisation(), **data))
