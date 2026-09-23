"""Organisation-scoped banking endpoints for imports, coding, and reconciliation."""

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet
from rest_framework.parsers import FormParser, MultiPartParser, JSONParser
from django.http import HttpResponse
from django.db import transaction
from django.db.models import Q

from common.views import OrganisationScopedViewSetMixin
from common.permissions import OrganisationActionPermission
from apps.organisations.permissions import (
    MANAGE_ACCOUNTS, MANAGE_BANK_TRANSACTIONS, RECONCILE_BANK,
    UNRECONCILE_BANK, VIEW_ACCOUNTING,
    IMPORT_BANK_STATEMENTS, MANAGE_BANK_RULES,
)

from .models import BankAccount, BankReconciliationHistory, BankRule, BankStatementImport, BankTransaction
from .serializers import (
    BankAccountSerializer,
    BankTransactionReconcileSerializer,
    BankTransactionSerializer,
    BankReconciliationSuggestionQuerySerializer,
    AcceptReconciliationSuggestionSerializer,
    UnreconcileBankTransactionSerializer,
    BankImportPreviewSerializer, BankImportSerializer, BankImportRowSerializer, BankRuleSerializer, BulkReconcileSerializer,
    BankReconciliationHistorySerializer, ReconciliationSummaryQuerySerializer,
)
from .services.reconciliation import BankReconciliationMatcher
from .services.reconciliation.summary import get_reconciliation_summary
from .services.reconciliation.reconcile import (
    accept_reconciliation_suggestion,
)
from .services.reconciliation.unreconcile import unreconcile_bank_transaction
from .services.imports import commit_bank_statement_import, preview_bank_statement_import
from .services.rules import apply_bank_rule, match_bank_rules
from .services.transactions import reconcile_bank_transaction_to_account
from common.exceptions import BusinessRuleError
from apps.accounting.models import Account


class BankImportViewSet(OrganisationScopedViewSetMixin, ModelViewSet):
    serializer_class = BankImportSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {
        "list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING, "rows": VIEW_ACCOUNTING,
        "import_schema": IMPORT_BANK_STATEMENTS, "template": IMPORT_BANK_STATEMENTS,
        "detect": IMPORT_BANK_STATEMENTS, "preview": IMPORT_BANK_STATEMENTS,
        "commit": IMPORT_BANK_STATEMENTS,
    }
    http_method_names = ["get", "post", "head", "options"]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        return BankStatementImport.objects.filter(organisation=self.get_organisation()).select_related("bank_account").order_by("-created_at")

    def list(self, request, *args, **kwargs):
        # History is bounded; row detail has a separate paginated endpoint.
        return Response(self.get_serializer(self.get_queryset()[:50], many=True).data)

    @action(detail=False, methods=["get"], url_path="schema")
    def import_schema(self, request):
        from .services.imports.statement_schema import schema
        return Response(schema())

    @action(detail=False, methods=["get"])
    def template(self, request):
        from .services.imports.statement_schema import template_csv
        response = HttpResponse(template_csv(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="ledgify-bank-statement.csv"'
        return response

    def upload(self, request):
        query = BankImportPreviewSerializer(data=request.data)
        query.is_valid(raise_exception=True)
        data = query.validated_data
        account = BankAccount.objects.filter(organisation=self.get_organisation(), id=data["bank_account_id"], status="active").first()
        if not account:
            raise BusinessRuleError("An active bank account was not found in this organisation.")
        return data, account

    @action(detail=False, methods=["post"])
    def detect(self, request):
        from .services.imports.statement_schema import detect_statement
        data, account = self.upload(request)
        return Response(detect_statement(data["file"].name, data["file"].read(), data["file"].content_type or ""))

    @action(detail=False, methods=["post"])
    def preview(self, request):
        data, account = self.upload(request)
        batch = preview_bank_statement_import(
            organisation=self.get_organisation(), bank_account=account,
            file_name=data["file"].name, content=data["file"].read(), mapping=data["mapping"],
            date_format=data["date_format"], amount_sign=data["amount_sign"],
            mime=data["file"].content_type or "", user=request.user,
        )
        return Response(self.get_serializer(batch).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def rows(self, request, pk=None):
        batch = self.get_object()
        rows = batch.rows.order_by("row_number")
        row_status = request.query_params.get("status", "")
        if row_status:
            if row_status not in {"ready", "duplicate", "rejected", "information", "imported"}:
                raise BusinessRuleError("Choose a valid row status.")
            rows = rows.filter(status=row_status)
        try:
            page = max(1, int(request.query_params.get("page", 1)))
        except (ValueError, TypeError):
            raise BusinessRuleError("Choose a valid preview page.") from None
        count = rows.count()
        page = min(page, max(1, (count + 99) // 100))
        return Response({"count": count, "page": page, "page_size": 100,
                         "results": BankImportRowSerializer(rows[(page-1)*100:page*100], many=True).data})

    @action(detail=True, methods=["post"])
    def commit(self, request, pk=None):
        batch = commit_bank_statement_import(organisation=self.get_organisation(), import_batch=self.get_object(), user=request.user)
        return Response(self.get_serializer(batch).data)


class BankRuleViewSet(OrganisationScopedViewSetMixin, ModelViewSet):
    serializer_class=BankRuleSerializer; permission_classes=[IsAuthenticated, OrganisationActionPermission]
    action_permissions={"list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
        "create": MANAGE_BANK_RULES, "update": MANAGE_BANK_RULES,
        "partial_update": MANAGE_BANK_RULES, "destroy": MANAGE_BANK_RULES}
    def get_queryset(self): return BankRule.objects.filter(organisation=self.get_organisation()).select_related("bank_account", "target_account", "contact")
    def perform_create(self, serializer):
        values=serializer.validated_data; organisation=self.get_organisation()
        for obj in (values.get("bank_account"), values.get("target_account"), values.get("contact")):
            if obj and obj.organisation_id != organisation.id: raise PermissionDenied("Rule relationship belongs to another organisation.")
        serializer.save(organisation=organisation, created_by=self.request.user)


class BankAccountViewSet(
    OrganisationScopedViewSetMixin,
    ModelViewSet,
):
    serializer_class = BankAccountSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
                          "unlinked_ledger_accounts": VIEW_ACCOUNTING,
                          "reconciliation_summary": VIEW_ACCOUNTING,
                          "reconciliation_history": VIEW_ACCOUNTING,
                          "create": MANAGE_ACCOUNTS, "update": MANAGE_ACCOUNTS,
                          "partial_update": MANAGE_ACCOUNTS, "destroy": MANAGE_ACCOUNTS}

    def get_queryset(self):
        organisation = self.get_organisation()

        queryset = (
            BankAccount.objects
            .filter(
                organisation=organisation,
            )
            .select_related(
                "ledger_account",
            )
        )

        account_status = self.request.query_params.get(
            "status"
        )

        currency = self.request.query_params.get(
            "currency"
        )

        if account_status:
            queryset = queryset.filter(
                status=account_status,
            )

        if currency:
            queryset = queryset.filter(
                currency=currency.upper(),
            )

        return queryset

    def perform_create(self, serializer):
        organisation = self.get_organisation()

        ledger_account = serializer.validated_data[
            "ledger_account"
        ]

        if (
            ledger_account.organisation_id
            != organisation.id
        ):
            raise PermissionDenied(
                "The ledger account does not belong "
                "to this organisation."
            )

        if (
            ledger_account.account_class
            != ledger_account.AccountClass.BANK
        ):
            raise PermissionDenied(
                "The ledger account must be classified "
                "as a bank account."
            )

        serializer.save(
            organisation=organisation,
            created_by=self.request.user,
        )

    @action(detail=False, methods=["get"], url_path="unlinked-ledger-accounts")
    def unlinked_ledger_accounts(self, request):
        accounts = Account.objects.filter(
            organisation=self.get_organisation(),
            account_type=Account.AccountType.ASSET,
            account_class=Account.AccountClass.BANK,
            status=Account.Status.ACTIVE,
            bank_profile__isnull=True,
        ).order_by("code")
        return Response([
            {
                "id": str(account.id), "code": account.code,
                "name": account.name, "currency": account.currency,
            }
            for account in accounts
        ])

    @action(detail=True, methods=["get"], url_path="reconciliation-summary")
    def reconciliation_summary(self, request, pk=None):
        query = ReconciliationSummaryQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        return Response(get_reconciliation_summary(
            organisation=self.get_organisation(), bank_account=self.get_object(),
            reconciliation_date=query.validated_data["reconciliation_date"],
        ))

    @action(detail=True, methods=["get"], url_path="reconciliation-history")
    def reconciliation_history(self, request, pk=None):
        bank_account = self.get_object()
        queryset = BankReconciliationHistory.objects.filter(
            organisation=self.get_organisation(), bank_transaction__bank_account=bank_account,
        ).select_related("bank_transaction", "performed_by", "accounting_journal")
        return Response(BankReconciliationHistorySerializer(queryset, many=True).data)


class BankTransactionViewSet(
    OrganisationScopedViewSetMixin,
    ModelViewSet,
):
    serializer_class = BankTransactionSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
                          "create": MANAGE_BANK_TRANSACTIONS,
                          "reconcile": RECONCILE_BANK, "suggestions": VIEW_ACCOUNTING,
                          "accept_suggestion": RECONCILE_BANK,
                          "unreconcile": UNRECONCILE_BANK, "apply_rule": RECONCILE_BANK,
                          "bulk_reconcile": RECONCILE_BANK, "queue": VIEW_ACCOUNTING}

    http_method_names = [
        "get",
        "post",
        "head",
        "options",
    ]

    def get_queryset(self):
        organisation = self.get_organisation()

        queryset = (
            BankTransaction.objects
            .filter(
                organisation=organisation,
            )
            .select_related(
                "bank_account",
                "bank_account__ledger_account",
                "accounting_journal",
                "reconciled_by",
            )
        )

        transaction_status = self.request.query_params.get(
            "status"
        )

        transaction_type = self.request.query_params.get(
            "type"
        )

        bank_account_id = self.request.query_params.get(
            "bank_account"
        )

        if transaction_status:
            queryset = queryset.filter(
                status=transaction_status,
            )

        if transaction_type:
            queryset = queryset.filter(
                transaction_type=transaction_type,
            )

        if bank_account_id:
            queryset = queryset.filter(
                bank_account_id=bank_account_id,
            )

        filters = {
            "transaction_date__gte": self.request.query_params.get("date_from"),
            "transaction_date__lte": self.request.query_params.get("date_to"),
            "amount__gte": self.request.query_params.get("min_amount"),
            "amount__lte": self.request.query_params.get("max_amount"),
            "reference__icontains": self.request.query_params.get("reference"),
        }
        queryset = queryset.filter(**{key: value for key, value in filters.items() if value not in (None, "")})
        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(Q(description__icontains=search) | Q(reference__icontains=search))

        return queryset

    @action(detail=True, methods=["post"], url_path="apply-rule")
    def apply_rule(self, request, pk=None):
        rule=BankRule.objects.filter(organisation=self.get_organisation(), id=request.data.get("rule_id")).first()
        if not rule: raise BusinessRuleError("Bank rule was not found.")
        result=apply_bank_rule(organisation=self.get_organisation(), bank_transaction=self.get_object(), rule=rule, user=request.user)
        return Response(self.get_serializer(result).data)

    @action(detail=False, methods=["post"], url_path="bulk-reconcile")
    @transaction.atomic
    def bulk_reconcile(self, request):
        query=BulkReconcileSerializer(data=request.data); query.is_valid(raise_exception=True); data=query.validated_data
        organisation=self.get_organisation(); account=Account.objects.filter(organisation=organisation, id=data["target_account_id"]).first()
        rows=list(BankTransaction.objects.select_for_update().filter(organisation=organisation, id__in=data["transaction_ids"]))
        if not account or len(rows) != len(set(data["transaction_ids"])): raise BusinessRuleError("Account or transaction was not found.")
        for row in rows: reconcile_bank_transaction_to_account(bank_transaction=row, target_account=account, user=request.user)
        return Response({"reconciled": len(rows)})

    @action(detail=False, methods=["get"])
    def queue(self, request):
        rows=self.get_queryset().filter(status=BankTransaction.Status.UNRECONCILED)
        output=[]
        for row in rows[:200]:
            suggestion_payload=BankReconciliationMatcher(organisation=self.get_organisation(), bank_transaction=row).get_suggestions(limit=1)
            suggestions=suggestion_payload["suggestions"]
            rules=match_bank_rules(organisation=self.get_organisation(), bank_transaction=row)
            output.append({"transaction": self.get_serializer(row).data,
                "best_suggestion": suggestions[0] if suggestions else (rules[0] if rules else None),
                "rule_suggestion": rules[0] if rules else None})
        return Response(output)

    @action(
        detail=True,
        methods=["post"],
    )
    def reconcile(self, request, pk=None):
        bank_transaction = self.get_object()

        serializer = BankTransactionReconcileSerializer(
            data=request.data,
            context={
                "request": request,
                "bank_transaction": bank_transaction,
            },
        )

        serializer.is_valid(
            raise_exception=True,
        )

        bank_transaction = serializer.save()

        output = self.get_serializer(
            bank_transaction,
        )

        return Response(
            output.data,
            status=status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=["get"],
        url_path="suggestions",
    )
    def suggestions(self, request, pk=None):
        query = BankReconciliationSuggestionQuerySerializer(
            data=request.query_params,
        )
        query.is_valid(raise_exception=True)

        bank_transaction = self.get_object()
        matcher = BankReconciliationMatcher(
            organisation=self.get_organisation(),
            bank_transaction=bank_transaction,
        )

        payload=matcher.get_suggestions(limit=query.validated_data["limit"])
        existing=payload["suggestions"]
        rules=match_bank_rules(organisation=self.get_organisation(), bank_transaction=bank_transaction)
        payload["suggestions"] = existing + rules[:max(0, query.validated_data["limit"] - len(existing))]
        return Response(payload)

    @action(
        detail=True,
        methods=["post"],
        url_path="accept-suggestion",
    )
    def accept_suggestion(self, request, pk=None):
        serializer = AcceptReconciliationSuggestionSerializer(
            data=request.data,
        )
        serializer.is_valid(raise_exception=True)

        bank_transaction = accept_reconciliation_suggestion(
            organisation=self.get_organisation(),
            bank_transaction=self.get_object(),
            match_type=serializer.validated_data["match_type"],
            object_id=serializer.validated_data["object_id"],
            user=request.user,
        )

        return Response(
            self.get_serializer(bank_transaction).data,
            status=status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=["post"],
        url_path="unreconcile",
    )
    def unreconcile(self, request, pk=None):
        serializer = UnreconcileBankTransactionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        bank_transaction = unreconcile_bank_transaction(
            organisation=self.get_organisation(),
            bank_transaction=self.get_object(),
            user=request.user,
            **serializer.validated_data,
        )
        return Response(
            self.get_serializer(bank_transaction).data,
            status=status.HTTP_200_OK,
        )
