"""Organisation-scoped accounting endpoints that delegate business rules to services."""

from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.db import transaction
from rest_framework.viewsets import ModelViewSet, ViewSet

from common.views import OrganisationScopedViewSetMixin
from common.permissions import OrganisationActionPermission
from apps.organisations.permissions import (
    CLOSE_FINANCIAL_YEAR, CLOSE_PERIOD, CREATE_JOURNAL, MANAGE_ACCOUNTS,
    MANAGE_FINANCIAL_YEARS, POST_JOURNAL, REOPEN_FINANCIAL_YEAR,
    REOPEN_PERIOD, REVERSE_JOURNAL, VIEW_ACCOUNTING,
)

from .models import Account, AccountingPeriod, FinancialYear, JournalEntry
from .report_serializers import (
    BalanceSheetQuerySerializer,
    CashFlowQuerySerializer,
    CashFlowDrilldownQuerySerializer,
    GeneralLedgerQuerySerializer,
    ProfitLossQuerySerializer,
    RatioAnalysisQuerySerializer,
    RatioTrendQuerySerializer,
    TrialBalanceQuerySerializer,
)
from .serializers import (
    AccountSerializer,
    AccountingPeriodSerializer,
    FinancialYearSerializer,
    JournalEntrySerializer,
    JournalReversalInputSerializer,
    ManualJournalInputSerializer,
    ReopenFinancialYearSerializer,
    ReopenAccountingPeriodSerializer,
)
from .services.periods.year_end_close import (
    close_financial_year_with_retained_earnings,
    reopen_financial_year,
)
from .services.periods import lock_accounting_period, reopen_accounting_period
from .services.journals import create_journal_entry, post_journal_entry, reverse_journal_entry
from .services.reports import (
    balance_sheet,
    cash_flow,
    cash_flow_drilldown,
    general_ledger,
    profit_loss,
    trial_balance,
)
from apps.finance.services import get_ratio_analysis, get_ratio_trend


class AccountViewSet(
    OrganisationScopedViewSetMixin,
    ModelViewSet,
):
    serializer_class = AccountSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
                          "create": MANAGE_ACCOUNTS, "update": MANAGE_ACCOUNTS,
                          "partial_update": MANAGE_ACCOUNTS, "destroy": MANAGE_ACCOUNTS}

    def get_queryset(self):
        organisation = self.get_organisation()

        queryset = Account.objects.filter(
            organisation=organisation,
        )

        account_type = self.request.query_params.get(
            "type"
        )

        account_class = self.request.query_params.get(
            "class"
        )

        account_status = self.request.query_params.get(
            "status"
        )

        cash_flow_category = self.request.query_params.get(
            "cash_flow_category"
        )

        if account_type:
            queryset = queryset.filter(
                account_type=account_type,
            )

        if account_class:
            queryset = queryset.filter(
                account_class=account_class,
            )

        if account_status:
            queryset = queryset.filter(
                status=account_status,
            )

        if cash_flow_category:
            queryset = queryset.filter(
                cash_flow_category=cash_flow_category,
            )

        return queryset

    def perform_create(self, serializer):
        serializer.save(
            organisation=self.get_organisation(),
            created_by=self.request.user,
        )


class JournalEntryViewSet(
    OrganisationScopedViewSetMixin,
    ModelViewSet,
):
    serializer_class = JournalEntrySerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {
        "list": VIEW_ACCOUNTING,
        "retrieve": VIEW_ACCOUNTING,
        "create_manual": CREATE_JOURNAL,
        "post": POST_JOURNAL,
        "reverse": REVERSE_JOURNAL,
    }

    http_method_names = [
        "get",
        "post",
        "head",
        "options",
    ]

    def get_queryset(self):
        organisation = self.get_organisation()

        queryset = (
            JournalEntry.objects
            .filter(
                organisation=organisation,
            )
            .select_related(
                "organisation",
                "created_by",
                "posted_by",
                "reversal_of",
            )
            .prefetch_related(
                "lines__account",
            )
        )

        journal_status = self.request.query_params.get(
            "status"
        )

        source_type = self.request.query_params.get(
            "source_type"
        )

        if journal_status:
            queryset = queryset.filter(
                status=journal_status,
            )

        if source_type:
            queryset = queryset.filter(
                source_type=source_type,
            )

        return queryset

    @action(detail=False, methods=["post"], url_path="manual")
    @transaction.atomic
    def create_manual(self, request):
        serializer = ManualJournalInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        organisation = self.get_organisation()
        accounts = {
            str(account.id): account
            for account in Account.objects.filter(
                organisation=organisation,
                id__in=[line["account_id"] for line in values["lines"]],
            )
        }
        lines = []
        for line in values["lines"]:
            account = accounts.get(str(line["account_id"]))
            if account is None:
                from rest_framework.exceptions import ValidationError
                raise ValidationError({"lines": "An account is not available in this organisation."})
            lines.append({**line, "account": account})
        journal = create_journal_entry(
            organisation=organisation,
            date=values["date"],
            reference=values.get("reference", ""),
            description=values["description"],
            lines=lines,
            user=request.user,
        )
        if values["post"]:
            journal = post_journal_entry(journal_entry=journal, user=request.user)
        return Response(JournalEntrySerializer(journal, context={"request": request}).data, status=201)

    @action(detail=True, methods=["post"], url_path="post")
    def post(self, request, pk=None):
        journal = post_journal_entry(journal_entry=self.get_object(), user=request.user)
        return Response(self.get_serializer(journal).data)

    @action(detail=True, methods=["post"], url_path="reverse")
    def reverse(self, request, pk=None):
        serializer = JournalReversalInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        journal = reverse_journal_entry(
            journal_entry=self.get_object(), user=request.user,
            reversal_date=serializer.validated_data.get("reversal_date"),
        )
        return Response(self.get_serializer(journal).data)


class FinancialYearViewSet(
    OrganisationScopedViewSetMixin,
    ModelViewSet,
):
    serializer_class = FinancialYearSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
                          "create": MANAGE_FINANCIAL_YEARS,
                          "close": CLOSE_FINANCIAL_YEAR,
                          "reopen": REOPEN_FINANCIAL_YEAR}
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return FinancialYear.objects.filter(
            organisation=self.get_organisation(),
        ).select_related(
            "closing_journal", "closing_reversal_journal", "closed_by",
        )

    def perform_create(self, serializer):
        serializer.save(organisation=self.get_organisation())

    @action(detail=True, methods=["post"], url_path="close")
    def close(self, request, pk=None):
        financial_year = close_financial_year_with_retained_earnings(
            organisation=self.get_organisation(),
            financial_year=self.get_object(),
            user=request.user,
        )
        return Response(self.get_serializer(financial_year).data)

    @action(detail=True, methods=["post"], url_path="reopen")
    def reopen(self, request, pk=None):
        serializer = ReopenFinancialYearSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        financial_year = reopen_financial_year(
            organisation=self.get_organisation(),
            financial_year=self.get_object(),
            user=request.user,
            **serializer.validated_data,
        )
        return Response(self.get_serializer(financial_year).data)


class AccountingPeriodViewSet(OrganisationScopedViewSetMixin, ModelViewSet):
    serializer_class = AccountingPeriodSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {
        "list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
        "create": CLOSE_PERIOD, "close": CLOSE_PERIOD, "reopen": REOPEN_PERIOD,
    }
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return AccountingPeriod.objects.filter(organisation=self.get_organisation())

    def perform_create(self, serializer):
        serializer.save(organisation=self.get_organisation())

    @action(detail=True, methods=["post"], url_path="close")
    def close(self, request, pk=None):
        period = lock_accounting_period(period=self.get_object(), user=request.user)
        return Response(self.get_serializer(period).data)

    @action(detail=True, methods=["post"], url_path="reopen")
    def reopen(self, request, pk=None):
        serializer = ReopenAccountingPeriodSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        period = reopen_accounting_period(
            period=self.get_object(), user=request.user,
            reason=serializer.validated_data["reason"],
        )
        return Response(self.get_serializer(period).data)

class AccountingReportViewSet(
    OrganisationScopedViewSetMixin,
    ViewSet,
):
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {
        "general_ledger_report": VIEW_ACCOUNTING,
        "trial_balance_report": VIEW_ACCOUNTING,
        "profit_loss_report": VIEW_ACCOUNTING,
        "balance_sheet_report": VIEW_ACCOUNTING,
        "cash_flow_report": VIEW_ACCOUNTING,
        "cash_flow_drilldown_report": VIEW_ACCOUNTING,
        "ratio_analysis_report": VIEW_ACCOUNTING,
        "ratio_trend_report": VIEW_ACCOUNTING,
    }

    @action(
        detail=False,
        methods=["get"],
        url_path="general-ledger",
    )
    def general_ledger_report(self, request):
        query = GeneralLedgerQuerySerializer(
            data=request.query_params,
        )

        query.is_valid(
            raise_exception=True,
        )

        data = general_ledger(
            organisation=self.get_organisation(),
            **query.validated_data,
        )

        return Response(data)

    @action(
        detail=False,
        methods=["get"],
        url_path="trial-balance",
    )
    def trial_balance_report(self, request):
        query = TrialBalanceQuerySerializer(
            data=request.query_params,
        )

        query.is_valid(
            raise_exception=True,
        )

        data = trial_balance(
            organisation=self.get_organisation(),
            **query.validated_data,
        )

        return Response(data)

    @action(
        detail=False,
        methods=["get"],
        url_path="profit-loss",
    )
    def profit_loss_report(self, request):
        query = ProfitLossQuerySerializer(
            data=request.query_params,
        )

        query.is_valid(
            raise_exception=True,
        )

        data = profit_loss(
            organisation=self.get_organisation(),
            **query.validated_data,
        )

        return Response(data)

    @action(
        detail=False,
        methods=["get"],
        url_path="balance-sheet",
    )
    def balance_sheet_report(self, request):
        query = BalanceSheetQuerySerializer(
            data=request.query_params,
        )

        query.is_valid(
            raise_exception=True,
        )

        data = balance_sheet(
            organisation=self.get_organisation(),
            **query.validated_data,
        )

        return Response(data)

    @action(
        detail=False,
        methods=["get"],
        url_path="cash-flow",
    )
    def cash_flow_report(self, request):
        query = CashFlowQuerySerializer(
            data=request.query_params,
        )

        query.is_valid(
            raise_exception=True,
        )

        data = cash_flow(
            organisation=self.get_organisation(),
            **query.validated_data,
        )

        return Response(data)

    @action(
        detail=False,
        methods=["get"],
        url_path="cash-flow/drilldown",
    )
    def cash_flow_drilldown_report(self, request):
        query = CashFlowDrilldownQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        data = cash_flow_drilldown(
            organisation=self.get_organisation(),
            **query.validated_data,
        )
        if data is None:
            from rest_framework.exceptions import NotFound
            raise NotFound("Cash Flow report line was not found.")
        return Response(data)

    @action(detail=False, methods=["get"], url_path="financial-analysis")
    def ratio_analysis_report(self, request):
        query = RatioAnalysisQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        return Response(get_ratio_analysis(organisation=self.get_organisation(), **query.validated_data))

    @action(detail=False, methods=["get"], url_path="financial-analysis/trend")
    def ratio_trend_report(self, request):
        query = RatioTrendQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        return Response(get_ratio_trend(organisation=self.get_organisation(), **query.validated_data))
