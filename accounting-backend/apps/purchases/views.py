"""Expose organisation purchase actions while service functions enforce accounting rules."""

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from common.views import OrganisationScopedViewSetMixin
from common.permissions import OrganisationActionPermission
from apps.organisations.permissions import (
    APPROVE_BILL, APPROVE_SUPPLIER_CREDIT, CREATE_BILL,
    CREATE_SUPPLIER_CREDIT, CREATE_SUPPLIER_PAYMENT, CREATE_SUPPLIER_REFUND,
    VIEW_ACCOUNTING,
    APPROVE_PURCHASE_ORDER, CREATE_PURCHASE_ORDER, RECEIVE_PURCHASE_ORDER,
)

from .models import Bill, PurchaseOrder, PurchaseOrderLine, SupplierCredit, SupplierPayment, SupplierRefund
from .serializers import (
    BillSerializer,
    ApplySupplierCreditSerializer,
    SupplierCreditAllocationSerializer,
    SupplierCreditSerializer,
    SupplierRefundSerializer,
    SupplierPaymentAllocationRequestSerializer,
    SupplierPaymentSerializer,
    ConvertPurchaseOrderSerializer, PurchaseOrderSerializer, ReceivePurchaseOrderSerializer,
)
from .services.bills import approve_bill
from .services.credits import apply_supplier_credit, approve_supplier_credit
from apps.finance.services.allocations import (
    allocate_supplier_payment,
    auto_allocate_supplier_payment,
)
from common.exceptions import BusinessRuleError
from apps.accounting.models import Account
from apps.inventory.models import Warehouse
from .services.commercial import (
    approve_purchase_order, convert_purchase_order_to_bill, receive_purchase_order_line,
)


class PurchaseOrderViewSet(OrganisationScopedViewSetMixin, ModelViewSet):
    serializer_class=PurchaseOrderSerializer
    permission_classes=[IsAuthenticated, OrganisationActionPermission]
    action_permissions={"list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
        "create": CREATE_PURCHASE_ORDER, "update": CREATE_PURCHASE_ORDER,
        "partial_update": CREATE_PURCHASE_ORDER, "destroy": CREATE_PURCHASE_ORDER,
        "approve": APPROVE_PURCHASE_ORDER, "receive": RECEIVE_PURCHASE_ORDER,
        "convert_to_bill": CREATE_BILL}
    def get_queryset(self):
        return PurchaseOrder.objects.filter(organisation=self.get_organisation()).select_related("supplier", "bill").prefetch_related("lines__product", "lines__expense_account")
    def get_serializer_context(self): return {**super().get_serializer_context(), "organisation": self.get_organisation()}
    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return Response(self.get_serializer(approve_purchase_order(organisation=self.get_organisation(), purchase_order=self.get_object(), user=request.user)).data)
    @action(detail=True, methods=["post"])
    def receive(self, request, pk=None):
        query=ReceivePurchaseOrderSerializer(data=request.data); query.is_valid(raise_exception=True); data=query.validated_data
        line=PurchaseOrderLine.objects.filter(purchase_order=self.get_object(), id=data["line_id"]).first()
        warehouse=Warehouse.objects.filter(organisation=self.get_organisation(), id=data["warehouse_id"]).first()
        account=Account.objects.filter(organisation=self.get_organisation(), id=data["grni_account_id"]).first()
        if not line or not warehouse or not account: raise BusinessRuleError("PO line, warehouse, or GRNI account was not found.")
        receipt=receive_purchase_order_line(organisation=self.get_organisation(), line=line,
            warehouse=warehouse, quantity=data["quantity"], transaction_date=data["transaction_date"],
            grni_account=account, user=request.user)
        from apps.inventory.serializers import InventoryTransactionSerializer
        return Response(InventoryTransactionSerializer(receipt).data, status=status.HTTP_201_CREATED)
    @action(detail=True, methods=["post"], url_path="convert-to-bill")
    def convert_to_bill(self, request, pk=None):
        query=ConvertPurchaseOrderSerializer(data=request.data); query.is_valid(raise_exception=True); data=query.validated_data
        bill=convert_purchase_order_to_bill(organisation=self.get_organisation(), purchase_order=self.get_object(),
            user=request.user, **data)
        return Response(BillSerializer(bill).data, status=status.HTTP_201_CREATED)


class BillViewSet(
    OrganisationScopedViewSetMixin,
    ModelViewSet,
):
    serializer_class = BillSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
                          "create": CREATE_BILL, "update": CREATE_BILL,
                          "partial_update": CREATE_BILL, "destroy": CREATE_BILL,
                          "approve": APPROVE_BILL}

    def get_queryset(self):
        organisation = self.get_organisation()

        queryset = (
            Bill.objects
            .filter(
                organisation=organisation,
            )
            .select_related(
                "supplier",
                "accounting_journal",
            )
            .prefetch_related(
                "lines__expense_account",
            )
        )

        bill_status = self.request.query_params.get(
            "status"
        )

        supplier_id = self.request.query_params.get(
            "supplier"
        )

        if bill_status:
            queryset = queryset.filter(
                status=bill_status,
            )

        if supplier_id:
            queryset = queryset.filter(
                supplier_id=supplier_id,
            )

        return queryset

    @action(
        detail=True,
        methods=["post"],
    )
    def approve(self, request, pk=None):
        bill = self.get_object()

        bill = approve_bill(
            bill=bill,
            user=request.user,
        )

        serializer = self.get_serializer(
            bill,
        )

        return Response(
            serializer.data,
            status=status.HTTP_200_OK,
        )


class SupplierPaymentViewSet(
    OrganisationScopedViewSetMixin,
    ModelViewSet,
):
    serializer_class = SupplierPaymentSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
                          "create": CREATE_SUPPLIER_PAYMENT,
                          "allocate": CREATE_SUPPLIER_PAYMENT,
                          "auto_allocate": CREATE_SUPPLIER_PAYMENT}

    http_method_names = [
        "get",
        "post",
        "head",
        "options",
    ]

    def get_queryset(self):
        organisation = self.get_organisation()

        queryset = (
            SupplierPayment.objects
            .filter(
                organisation=organisation,
            )
            .select_related(
                "bill",
                "bill__supplier",
                "supplier",
                "bank_account",
                "accounting_journal",
            )
            .prefetch_related("allocations")
        )

        payment_status = self.request.query_params.get(
            "status"
        )

        bill_id = self.request.query_params.get(
            "bill"
        )

        if payment_status:
            queryset = queryset.filter(
                status=payment_status,
            )

        if bill_id:
            queryset = queryset.filter(
                bill_id=bill_id,
            )

        return queryset

    @action(detail=True, methods=["post"])
    def allocate(self, request, pk=None):
        query = SupplierPaymentAllocationRequestSerializer(data=request.data)
        query.is_valid(raise_exception=True)
        bill = Bill.objects.filter(
            id=query.validated_data["bill_id"],
            organisation=self.get_organisation(),
        ).first()
        if bill is None:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Bill not found in this organisation.")
        allocate_supplier_payment(
            organisation=self.get_organisation(), payment=self.get_object(),
            bill=bill, amount=query.validated_data["amount"], user=request.user,
        )
        return Response(self.get_serializer(self.get_object()).data)

    @action(detail=True, methods=["post"], url_path="auto-allocate")
    def auto_allocate(self, request, pk=None):
        auto_allocate_supplier_payment(
            organisation=self.get_organisation(), payment=self.get_object(),
            user=request.user,
        )
        return Response(self.get_serializer(self.get_object()).data)


class SupplierCreditViewSet(OrganisationScopedViewSetMixin, ModelViewSet):
    serializer_class = SupplierCreditSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
                          "create": CREATE_SUPPLIER_CREDIT,
                          "update": CREATE_SUPPLIER_CREDIT,
                          "partial_update": CREATE_SUPPLIER_CREDIT,
                          "destroy": CREATE_SUPPLIER_CREDIT,
                          "approve": APPROVE_SUPPLIER_CREDIT,
                          "apply": APPROVE_SUPPLIER_CREDIT}

    def get_queryset(self):
        return SupplierCredit.objects.filter(
            organisation=self.get_organisation()
        ).select_related("supplier", "bill", "accounting_journal").prefetch_related(
            "lines__expense_account"
        )

    def update(self, request, *args, **kwargs):
        if self.get_object().status != SupplierCredit.Status.DRAFT:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Only draft supplier credits can be edited.")
        return super().update(request, *args, **kwargs)

    def perform_destroy(self, instance):
        instance.delete()

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        credit = approve_supplier_credit(credit=self.get_object(), user=request.user)
        return Response(self.get_serializer(credit).data)

    @action(detail=True, methods=["post"])
    def apply(self, request, pk=None):
        query = ApplySupplierCreditSerializer(data=request.data)
        query.is_valid(raise_exception=True)
        bill = Bill.objects.filter(
            id=query.validated_data["bill_id"], organisation=self.get_organisation()
        ).first()
        if bill is None:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Bill not found in this organisation.")
        allocation = apply_supplier_credit(
            credit=self.get_object(), bill=bill,
            amount=query.validated_data["amount"], user=request.user,
        )
        return Response(SupplierCreditAllocationSerializer(allocation).data)


class SupplierRefundViewSet(OrganisationScopedViewSetMixin, ModelViewSet):
    serializer_class = SupplierRefundSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
                          "create": CREATE_SUPPLIER_REFUND}
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = SupplierRefund.objects.filter(
            organisation=self.get_organisation()
        ).select_related(
            "supplier", "supplier_credit", "bank_account", "accounting_journal"
        )
        supplier_id = self.request.query_params.get("supplier")
        refund_status = self.request.query_params.get("status")
        credit_id = self.request.query_params.get("supplier_credit")
        if supplier_id:
            queryset = queryset.filter(supplier_id=supplier_id)
        if refund_status:
            queryset = queryset.filter(status=refund_status)
        if credit_id:
            queryset = queryset.filter(supplier_credit_id=credit_id)
        return queryset
