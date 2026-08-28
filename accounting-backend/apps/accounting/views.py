"""Organisation-scoped accounting endpoints that delegate business rules to services."""

from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.db import transaction
from django.db.models import Q, Sum
from rest_framework.pagination import PageNumberPagination
from rest_framework.viewsets import ModelViewSet, ViewSet
from django.http import HttpResponse
from django.shortcuts import get_object_or_404

from common.views import OrganisationScopedViewSetMixin
from common.permissions import OrganisationActionPermission
from apps.organisations.permissions import (
    CLOSE_FINANCIAL_YEAR, CLOSE_PERIOD, CREATE_JOURNAL, MANAGE_ACCOUNTS,
    MANAGE_FINANCIAL_YEARS, POST_JOURNAL, REOPEN_FINANCIAL_YEAR,
    REOPEN_PERIOD, REVERSE_JOURNAL, VIEW_ACCOUNTING,
    MANAGE_OPENING_BALANCES, APPROVE_OPENING_BALANCES,
)

from .models import Account, AccountImportBatch, AccountingPeriod, FinancialYear, JournalEntry, JournalLine, OpeningBalance
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


class GeneralJournalPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100
from .serializers import (
    AccountSerializer,
    AccountingPeriodSerializer,
    FinancialYearSerializer,
    JournalEntrySerializer,
    JournalReversalInputSerializer,
    ManualJournalInputSerializer,
    OpeningBalanceSerializer, OpeningBalanceWriteSerializer, OpeningBalanceReverseSerializer,
    ReopenFinancialYearSerializer,
    ReopenAccountingPeriodSerializer,
)
from .services.opening_balances import save_draft,submit as submit_opening,post as post_opening,reverse as reverse_opening
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
from .services.account_imports import batch_data, confirm as confirm_account_import, preview as preview_account_import, template_workbook


class AccountViewSet(
    OrganisationScopedViewSetMixin,
    ModelViewSet,
):
    serializer_class = AccountSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
                          "create": MANAGE_ACCOUNTS, "update": MANAGE_ACCOUNTS,
                          "partial_update": MANAGE_ACCOUNTS, "destroy": MANAGE_ACCOUNTS,
                          "import_template": MANAGE_ACCOUNTS, "import_preview": MANAGE_ACCOUNTS,
                          "import_status": MANAGE_ACCOUNTS, "import_confirm": MANAGE_ACCOUNTS,
                          "import_errors": MANAGE_ACCOUNTS}

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

    @action(detail=False, methods=["get"], url_path="import/template")
    def import_template(self, request):
        response = HttpResponse(template_workbook(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        response["Content-Disposition"] = 'attachment; filename="Ledgify_Chart_of_Accounts_Import_Template.xlsx"'
        response["X-Content-Type-Options"] = "nosniff"
        return response

    @action(detail=False, methods=["post"], url_path="import/preview")
    def import_preview(self, request):
        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response({"file": ["Select an .xlsx workbook."]}, status=400)
        batch = preview_account_import(organisation=self.get_organisation(), user=request.user, uploaded_file=uploaded, import_mode=request.data.get("import_mode", "stop_on_existing"))
        return Response(batch_data(batch), status=201)

    def _import_batch(self, batch_id):
        return get_object_or_404(AccountImportBatch, id=batch_id, organisation=self.get_organisation())

    @action(detail=False, methods=["get"], url_path=r"import/(?P<batch_id>[^/.]+)/status")
    def import_status(self, request, batch_id=None):
        return Response(batch_data(self._import_batch(batch_id)))

    @action(detail=False, methods=["post"], url_path=r"import/(?P<batch_id>[^/.]+)/confirm")
    def import_confirm(self, request, batch_id=None):
        return Response(batch_data(confirm_account_import(batch=self._import_batch(batch_id), user=request.user)))

    @action(detail=False, methods=["get"], url_path=r"import/(?P<batch_id>[^/.]+)/errors")
    def import_errors(self, request, batch_id=None):
        batch = self._import_batch(batch_id)
        lines = ['"Row Number","Account Code","Account Name","Field","Error"']
        for row in batch.rows:
            for error in row["errors"]:
                values = [row["row_number"], row["data"].get("code", ""), row["data"].get("name", ""), error["field"], error["message"]]
                lines.append(",".join('"' + str(value).replace('"', '""') + '"' for value in values))
        response = HttpResponse("\ufeff" + "\r\n".join(lines), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="Ledgify_Account_Import_Errors_{batch.id}.csv"'
        return response

    def perform_create(self, serializer):
        serializer.save(
            organisation=self.get_organisation(),
            created_by=self.request.user,
        )


class OpeningBalanceViewSet(OrganisationScopedViewSetMixin, ModelViewSet):
    serializer_class=OpeningBalanceSerializer;permission_classes=[IsAuthenticated,OrganisationActionPermission];http_method_names=["get","post","put","patch","head","options"]
    action_permissions={"list":VIEW_ACCOUNTING,"retrieve":VIEW_ACCOUNTING,"create":MANAGE_OPENING_BALANCES,"update":MANAGE_OPENING_BALANCES,"partial_update":MANAGE_OPENING_BALANCES,"submit":MANAGE_OPENING_BALANCES,"post_balance":APPROVE_OPENING_BALANCES,"reverse_balance":APPROVE_OPENING_BALANCES}
    def get_queryset(self):return OpeningBalance.objects.filter(organisation=self.get_organisation()).select_related("organisation","created_by","updated_by","posted_by","journal","reversal_journal").prefetch_related("lines__account","journal__lines__account","reversal_journal__lines__account")
    def create(self,request):
        query=OpeningBalanceWriteSerializer(data=request.data);query.is_valid(raise_exception=True);record=save_draft(record=None,organisation=self.get_organisation(),user=request.user,data=query.validated_data);return Response(self.get_serializer(record).data,status=201)
    def update(self,request,*args,**kwargs):
        record=self.get_object();query=OpeningBalanceWriteSerializer(data=request.data,partial=kwargs.get("partial",False));query.is_valid(raise_exception=True);data={"opening_date":query.validated_data.get("opening_date",record.opening_date),"reference":query.validated_data.get("reference",record.reference),"description":query.validated_data.get("description",record.description),"lines":query.validated_data.get("lines",[{"account_id":line.account_id,"debit":line.debit,"credit":line.credit,"unusual_side_confirmed":line.unusual_side_confirmed} for line in record.lines.all()])};record=save_draft(record=record,organisation=self.get_organisation(),user=request.user,data=data);return Response(self.get_serializer(record).data)
    @action(detail=True,methods=["post"])
    def submit(self,request,pk=None):return Response(self.get_serializer(submit_opening(self.get_object(),request.user)).data)
    @action(detail=True,methods=["post"],url_path="post")
    def post_balance(self,request,pk=None):return Response(self.get_serializer(post_opening(self.get_object(),request.user)).data)
    @action(detail=True,methods=["post"],url_path="reverse")
    def reverse_balance(self,request,pk=None):
        query=OpeningBalanceReverseSerializer(data=request.data);query.is_valid(raise_exception=True);return Response(self.get_serializer(reverse_opening(self.get_object(),request.user,query.validated_data["reversal_date"])).data)


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
        "register": VIEW_ACCOUNTING,
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
        start_date = self.request.query_params.get("start_date")
        end_date = self.request.query_params.get("end_date")
        account_id = self.request.query_params.get("account_id")
        search = self.request.query_params.get("search", "").strip()

        if journal_status:
            queryset = queryset.filter(
                status=journal_status,
            )

        if source_type:
            queryset = queryset.filter(
                source_type=source_type,
            )

        if start_date:
            queryset = queryset.filter(date__gte=start_date)
        if end_date:
            queryset = queryset.filter(date__lte=end_date)
        if account_id:
            queryset = queryset.filter(lines__account_id=account_id)
        if search:
            queryset = queryset.filter(
                Q(entry_number__icontains=search)
                | Q(reference__icontains=search)
                | Q(description__icontains=search)
                | Q(lines__description__icontains=search)
                | Q(lines__account__code__icontains=search)
                | Q(lines__account__name__icontains=search)
            )

        return queryset.distinct().order_by("date", "entry_number")

    @action(detail=False, methods=["get"], url_path="register")
    def register(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        totals = JournalLine.objects.filter(journal_entry__in=queryset).aggregate(
            total_debit=Sum("debit"),
            total_credit=Sum("credit"),
        )
        ledger_totals = JournalLine.objects.filter(
            journal_entry__in=queryset.filter(status__in=["posted", "reversed"])
        ).aggregate(
            total_debit=Sum("debit"),
            total_credit=Sum("credit"),
        )
        paginator = GeneralJournalPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        response = paginator.get_paginated_response(
            self.get_serializer(page, many=True).data
        )
        organisation = self.get_organisation()
        response.data["totals"] = {
            "debit": totals["total_debit"] or 0,
            "credit": totals["total_credit"] or 0,
        }
        response.data["ledger_totals"] = {
            "debit": ledger_totals["total_debit"] or 0,
            "credit": ledger_totals["total_credit"] or 0,
        }
        response.data["facets"] = {
            "sources": list(
                JournalEntry.objects.filter(organisation=organisation)
                .exclude(source_type="").values_list("source_type", flat=True)
                .distinct().order_by("source_type")
            ),
            "accounts": [
                {"id": str(row.id), "code": row.code, "name": row.name}
                for row in Account.objects.filter(
                    organisation=organisation,
                    journal_lines__isnull=False,
                ).distinct().order_by("code", "name")
            ],
        }
        return response

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
