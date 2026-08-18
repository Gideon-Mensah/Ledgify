"""Expose organisation sales workflows with action-specific permissions."""

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from common.views import OrganisationScopedViewSetMixin
from common.exceptions import BusinessRuleError
from common.permissions import OrganisationActionPermission
from apps.organisations.permissions import (
    APPROVE_CUSTOMER_CREDIT, APPROVE_INVOICE, CREATE_BAD_DEBT_WRITE_OFF,
    CREATE_CUSTOMER_CREDIT, CREATE_CUSTOMER_PAYMENT, CREATE_CUSTOMER_REFUND,
    CREATE_INVOICE, VIEW_ACCOUNTING,
    APPROVE_QUOTE, APPROVE_SALES_ORDER, CREATE_QUOTE, CREATE_SALES_ORDER,
    FULFIL_SALES_ORDER,
)

from .models import (
    BadDebtWriteOff,
    CustomerCreditNote,
    CustomerPayment,
    CustomerRefund,
    Invoice,
    Quote, SalesOrder, SalesOrderLine,
)
from .serializers import (
    CustomerPaymentSerializer,
    CustomerCreditAllocationSerializer,
    CustomerCreditNoteSerializer,
    ApplyCustomerCreditSerializer,
    BadDebtWriteOffSerializer,
    CustomerRefundSerializer,
    CustomerPaymentAllocationRequestSerializer,
    InvoiceSerializer,
    DocumentConversionSerializer, FulfilSalesOrderSerializer, QuoteSerializer,
    SalesOrderSerializer,
)
from .services.invoices import approve_invoice
from .services.credit_notes import (
    apply_customer_credit_note,
    approve_customer_credit_note,
)
from apps.finance.services.allocations import (
    allocate_customer_payment,
    auto_allocate_customer_payment,
)
from apps.inventory.models import Warehouse
from .services.commercial import (
    accept_quote, approve_sales_order, convert_quote_to_invoice,
    convert_sales_order_to_invoice, fulfil_sales_order_line,
)


class QuoteViewSet(OrganisationScopedViewSetMixin, ModelViewSet):
    serializer_class=QuoteSerializer
    permission_classes=[IsAuthenticated, OrganisationActionPermission]
    action_permissions={"list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
        "create": CREATE_QUOTE, "update": CREATE_QUOTE, "partial_update": CREATE_QUOTE,
        "destroy": CREATE_QUOTE, "accept": APPROVE_QUOTE, "convert_to_invoice": CREATE_INVOICE}
    def get_queryset(self):
        return Quote.objects.filter(organisation=self.get_organisation()).select_related("customer", "converted_invoice").prefetch_related("lines__product", "lines__revenue_account")
    def get_serializer_context(self):
        return {**super().get_serializer_context(), "organisation": self.get_organisation()}
    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        return Response(self.get_serializer(accept_quote(organisation=self.get_organisation(), quote=self.get_object(), user=request.user)).data)
    @action(detail=True, methods=["post"], url_path="convert-to-invoice")
    def convert_to_invoice(self, request, pk=None):
        query=DocumentConversionSerializer(data=request.data); query.is_valid(raise_exception=True); data=query.validated_data
        invoice=convert_quote_to_invoice(organisation=self.get_organisation(), quote=self.get_object(), user=request.user,
            invoice_number=data["document_number"], issue_date=data["issue_date"], due_date=data["due_date"])
        return Response(InvoiceSerializer(invoice).data, status=status.HTTP_201_CREATED)


class SalesOrderViewSet(OrganisationScopedViewSetMixin, ModelViewSet):
    serializer_class=SalesOrderSerializer
    permission_classes=[IsAuthenticated, OrganisationActionPermission]
    action_permissions={"list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
        "create": CREATE_SALES_ORDER, "update": CREATE_SALES_ORDER,
        "partial_update": CREATE_SALES_ORDER, "destroy": CREATE_SALES_ORDER,
        "approve": APPROVE_SALES_ORDER, "fulfil": FULFIL_SALES_ORDER,
        "convert_to_invoice": CREATE_INVOICE}
    def get_queryset(self):
        return SalesOrder.objects.filter(organisation=self.get_organisation()).select_related("customer", "quote", "invoice").prefetch_related("lines__product", "lines__revenue_account")
    def get_serializer_context(self): return {**super().get_serializer_context(), "organisation": self.get_organisation()}
    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return Response(self.get_serializer(approve_sales_order(organisation=self.get_organisation(), sales_order=self.get_object(), user=request.user)).data)
    @action(detail=True, methods=["post"])
    def fulfil(self, request, pk=None):
        query=FulfilSalesOrderSerializer(data=request.data); query.is_valid(raise_exception=True); data=query.validated_data
        line=SalesOrderLine.objects.filter(sales_order=self.get_object(), id=data["line_id"]).first()
        warehouse=Warehouse.objects.filter(organisation=self.get_organisation(), id=data["warehouse_id"]).first()
        if not line or not warehouse: raise BusinessRuleError("Sales order line or warehouse was not found.")
        transaction=fulfil_sales_order_line(organisation=self.get_organisation(), line=line, warehouse=warehouse,
            quantity=data["quantity"], transaction_date=data["transaction_date"], user=request.user)
        from apps.inventory.serializers import InventoryTransactionSerializer
        return Response(InventoryTransactionSerializer(transaction).data, status=status.HTTP_201_CREATED)
    @action(detail=True, methods=["post"], url_path="convert-to-invoice")
    def convert_to_invoice(self, request, pk=None):
        query=DocumentConversionSerializer(data=request.data); query.is_valid(raise_exception=True); data=query.validated_data
        invoice=convert_sales_order_to_invoice(organisation=self.get_organisation(), sales_order=self.get_object(), user=request.user,
            invoice_number=data["document_number"], issue_date=data["issue_date"], due_date=data["due_date"])
        return Response(InvoiceSerializer(invoice).data, status=status.HTTP_201_CREATED)


class InvoiceViewSet(
    OrganisationScopedViewSetMixin,
    ModelViewSet,
):
    serializer_class = InvoiceSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
                          "create": CREATE_INVOICE, "update": CREATE_INVOICE,
                          "partial_update": CREATE_INVOICE, "destroy": CREATE_INVOICE,
                          "approve": APPROVE_INVOICE}

    def get_queryset(self):
        organisation = self.get_organisation()

        queryset = (
            Invoice.objects
            .filter(
                organisation=organisation,
            )
            .select_related(
                "customer",
                "accounting_journal",
            )
            .prefetch_related(
                "lines__revenue_account",
            )
        )

        invoice_status = self.request.query_params.get(
            "status"
        )

        customer_id = self.request.query_params.get(
            "customer"
        )

        if invoice_status:
            queryset = queryset.filter(
                status=invoice_status,
            )

        if customer_id:
            queryset = queryset.filter(
                customer_id=customer_id,
            )

        return queryset

    def update(self, request, *args, **kwargs):
        if self.get_object().status != Invoice.Status.DRAFT:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Only draft invoices can be edited. Use a credit note or another correction workflow.")
        return super().update(request, *args, **kwargs)

    @action(
        detail=True,
        methods=["post"],
    )
    def approve(self, request, pk=None):
        invoice = self.get_object()

        invoice = approve_invoice(
            invoice=invoice,
            user=request.user,
        )

        serializer = self.get_serializer(
            invoice,
        )

        return Response(
            serializer.data,
            status=status.HTTP_200_OK,
        )


class CustomerPaymentViewSet(
    OrganisationScopedViewSetMixin,
    ModelViewSet,
):
    serializer_class = CustomerPaymentSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
                          "create": CREATE_CUSTOMER_PAYMENT,
                          "allocate": CREATE_CUSTOMER_PAYMENT,
                          "auto_allocate": CREATE_CUSTOMER_PAYMENT}

    http_method_names = [
        "get",
        "post",
        "head",
        "options",
    ]

    def get_queryset(self):
        organisation = self.get_organisation()

        queryset = (
            CustomerPayment.objects
            .filter(
                organisation=organisation,
            )
            .select_related(
                "invoice",
                "invoice__customer",
                "customer",
                "bank_account",
                "accounting_journal",
            )
            .prefetch_related("allocations")
        )

        payment_status = self.request.query_params.get(
            "status"
        )

        invoice_id = self.request.query_params.get(
            "invoice"
        )

        if payment_status:
            queryset = queryset.filter(
                status=payment_status,
            )

        if invoice_id:
            queryset = queryset.filter(
                invoice_id=invoice_id,
            )

        return queryset

    @action(detail=True, methods=["post"])
    def allocate(self, request, pk=None):
        query = CustomerPaymentAllocationRequestSerializer(data=request.data)
        query.is_valid(raise_exception=True)
        invoice = Invoice.objects.filter(
            id=query.validated_data["invoice_id"],
            organisation=self.get_organisation(),
        ).first()
        if invoice is None:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Invoice not found in this organisation.")
        allocate_customer_payment(
            organisation=self.get_organisation(), payment=self.get_object(),
            invoice=invoice, amount=query.validated_data["amount"], user=request.user,
        )
        return Response(self.get_serializer(self.get_object()).data)

    @action(detail=True, methods=["post"], url_path="auto-allocate")
    def auto_allocate(self, request, pk=None):
        auto_allocate_customer_payment(
            organisation=self.get_organisation(), payment=self.get_object(),
            user=request.user,
        )
        return Response(self.get_serializer(self.get_object()).data)


class CustomerCreditNoteViewSet(OrganisationScopedViewSetMixin, ModelViewSet):
    serializer_class = CustomerCreditNoteSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
                          "create": CREATE_CUSTOMER_CREDIT,
                          "update": CREATE_CUSTOMER_CREDIT,
                          "partial_update": CREATE_CUSTOMER_CREDIT,
                          "destroy": CREATE_CUSTOMER_CREDIT,
                          "approve": APPROVE_CUSTOMER_CREDIT,
                          "apply": APPROVE_CUSTOMER_CREDIT}

    def get_queryset(self):
        return CustomerCreditNote.objects.filter(
            organisation=self.get_organisation()
        ).select_related("customer", "invoice", "accounting_journal").prefetch_related(
            "lines__revenue_account"
        )

    def update(self, request, *args, **kwargs):
        if self.get_object().status != CustomerCreditNote.Status.DRAFT:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Only draft credit notes can be edited.")
        return super().update(request, *args, **kwargs)

    def perform_destroy(self, instance):
        instance.delete()

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        credit = approve_customer_credit_note(
            credit_note=self.get_object(), user=request.user
        )
        return Response(self.get_serializer(credit).data)

    @action(detail=True, methods=["post"])
    def apply(self, request, pk=None):
        query = ApplyCustomerCreditSerializer(data=request.data)
        query.is_valid(raise_exception=True)
        invoice = Invoice.objects.filter(
            id=query.validated_data["invoice_id"],
            organisation=self.get_organisation(),
        ).first()
        if invoice is None:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Invoice not found in this organisation.")
        allocation = apply_customer_credit_note(
            credit_note=self.get_object(), invoice=invoice,
            amount=query.validated_data["amount"], user=request.user,
        )
        return Response(CustomerCreditAllocationSerializer(allocation).data)


class CustomerRefundViewSet(OrganisationScopedViewSetMixin, ModelViewSet):
    serializer_class = CustomerRefundSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
                          "create": CREATE_CUSTOMER_REFUND}
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return CustomerRefund.objects.filter(
            organisation=self.get_organisation()
        ).select_related("customer", "credit_note", "bank_account", "accounting_journal")


class BadDebtWriteOffViewSet(OrganisationScopedViewSetMixin, ModelViewSet):
    serializer_class = BadDebtWriteOffSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
                          "create": CREATE_BAD_DEBT_WRITE_OFF}
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return BadDebtWriteOff.objects.filter(
            organisation=self.get_organisation()
        ).select_related("invoice", "bad_debt_account", "accounting_journal")
