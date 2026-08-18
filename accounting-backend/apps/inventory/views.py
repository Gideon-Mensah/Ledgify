"""Expose organisation inventory workflows without duplicating costing in the API layer."""

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet, ModelViewSet, ViewSet
from rest_framework.mixins import CreateModelMixin, ListModelMixin, RetrieveModelMixin

from common.exceptions import BusinessRuleError
from common.permissions import OrganisationActionPermission
from common.views import OrganisationScopedViewSetMixin
from apps.accounting.models import Account
from apps.inventory.models import InventoryTransaction, Product, StockCount, StockMovement, Warehouse
from apps.inventory.serializers import (
    InventoryTransactionSerializer, InventoryValuationQuerySerializer,
    InventoryWorkflowRequestSerializer, ProductSerializer, StockCountCreateSerializer,
    StockCountPostSerializer, StockCountSerializer, StockAdjustmentRequestSerializer,
    StockMovementSerializer, WarehouseSerializer,
)
from apps.inventory.services.adjustments import create_stock_adjustment
from apps.inventory.services.stock import get_product_stock_summary
from apps.inventory.services.valuation import get_inventory_valuation
from apps.inventory.services.reports import (
    movement_history, movement_velocity, negative_stock, reorder_report, stock_on_hand,
)
from apps.inventory.services.workflows import (
    create_stock_count, issue_sale, post_stock_count, receive_purchase,
    return_customer_stock, return_supplier_stock, start_stock_count, transfer_stock,
)
from apps.sales.models import Invoice
from apps.organisations.permissions import (
    ADJUST_STOCK, MANAGE_PRODUCTS, MANAGE_WAREHOUSES, VIEW_INVENTORY,
)


class ProductViewSet(OrganisationScopedViewSetMixin, ModelViewSet):
    serializer_class = ProductSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {
        "list": VIEW_INVENTORY, "retrieve": VIEW_INVENTORY,
        "create": MANAGE_PRODUCTS, "update": MANAGE_PRODUCTS,
        "partial_update": MANAGE_PRODUCTS, "destroy": MANAGE_PRODUCTS,
        "stock": VIEW_INVENTORY,
    }

    def get_queryset(self):
        return Product.objects.filter(organisation=self.get_organisation()).select_related(
            "inventory_asset_account", "sales_account", "cost_of_goods_sold_account",
            "preferred_supplier",
        )

    def perform_create(self, serializer):
        serializer.save(organisation=self.get_organisation(), created_by=self.request.user)

    def perform_destroy(self, instance):
        instance.status = Product.Status.ARCHIVED
        instance.save(update_fields=["status", "updated_at"])

    @action(detail=True, methods=["get"], url_path="stock")
    def stock(self, request, pk=None):
        return Response(get_product_stock_summary(
            organisation=self.get_organisation(), product=self.get_object(),
        ))


class WarehouseViewSet(OrganisationScopedViewSetMixin, ModelViewSet):
    serializer_class = WarehouseSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {
        "list": VIEW_INVENTORY, "retrieve": VIEW_INVENTORY,
        "create": MANAGE_WAREHOUSES, "update": MANAGE_WAREHOUSES,
        "partial_update": MANAGE_WAREHOUSES, "destroy": MANAGE_WAREHOUSES,
    }

    def get_queryset(self):
        return Warehouse.objects.filter(organisation=self.get_organisation())

    def perform_create(self, serializer):
        serializer.save(organisation=self.get_organisation(), created_by=self.request.user)

    def perform_destroy(self, instance):
        instance.status = Warehouse.Status.ARCHIVED
        instance.is_default = False
        instance.save(update_fields=["status", "is_default", "updated_at"])


class StockMovementViewSet(
    OrganisationScopedViewSetMixin, ListModelMixin, RetrieveModelMixin, GenericViewSet
):
    serializer_class = StockMovementSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_INVENTORY, "retrieve": VIEW_INVENTORY}

    def get_queryset(self):
        return StockMovement.objects.filter(
            organisation=self.get_organisation()
        ).select_related("product", "warehouse", "accounting_journal")


class StockAdjustmentViewSet(OrganisationScopedViewSetMixin, ViewSet):
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"create": ADJUST_STOCK}

    def create(self, request):
        serializer = StockAdjustmentRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        organisation = self.get_organisation()
        product = Product.objects.filter(organisation=organisation, id=data.pop("product_id")).first()
        warehouse = Warehouse.objects.filter(organisation=organisation, id=data.pop("warehouse_id")).first()
        offset = Account.objects.filter(organisation=organisation, id=data.pop("offset_account_id")).first()
        if product is None or warehouse is None or offset is None:
            raise BusinessRuleError("Product, warehouse, or offset account was not found.")
        movement = create_stock_adjustment(
            organisation=organisation, product=product, warehouse=warehouse,
            offset_account=offset, user=request.user, **data,
        )
        return Response(StockMovementSerializer(movement).data, status=status.HTTP_201_CREATED)


class InventoryValuationViewSet(OrganisationScopedViewSetMixin, ViewSet):
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_INVENTORY}

    def list(self, request):
        serializer = InventoryValuationQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        organisation = self.get_organisation()
        product = None
        warehouse = None
        if "product_id" in data:
            product = Product.objects.filter(organisation=organisation, id=data["product_id"]).first()
            if product is None:
                raise BusinessRuleError("Product was not found.")
        if "warehouse_id" in data:
            warehouse = Warehouse.objects.filter(organisation=organisation, id=data["warehouse_id"]).first()
            if warehouse is None:
                raise BusinessRuleError("Warehouse was not found.")
        return Response(get_inventory_valuation(
            organisation=organisation, product=product, warehouse=warehouse,
            as_of_date=data.get("as_of_date"),
        ))


class InventoryTransactionViewSet(
    OrganisationScopedViewSetMixin, ListModelMixin, RetrieveModelMixin, GenericViewSet
):
    serializer_class = InventoryTransactionSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_INVENTORY, "retrieve": VIEW_INVENTORY,
                          "purchase_receipt": ADJUST_STOCK, "sales_issue": ADJUST_STOCK,
                          "transfer": ADJUST_STOCK, "customer_return": ADJUST_STOCK,
                          "supplier_return": ADJUST_STOCK}

    def get_queryset(self):
        return InventoryTransaction.objects.filter(
            organisation=self.get_organisation(),
        ).select_related("product", "warehouse", "destination_warehouse")

    def _objects(self, data):
        organisation = self.get_organisation()
        product = Product.objects.filter(organisation=organisation, id=data.pop("product_id")).first()
        warehouse = Warehouse.objects.filter(organisation=organisation, id=data.pop("warehouse_id")).first()
        if not product or not warehouse:
            raise BusinessRuleError("Product or warehouse was not found.")
        return organisation, product, warehouse

    def _request(self, request):
        serializer = InventoryWorkflowRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data

    def _response(self, transaction):
        return Response(InventoryTransactionSerializer(transaction).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="purchase-receipts")
    def purchase_receipt(self, request):
        data = self._request(request); organisation, product, warehouse = self._objects(data)
        account = Account.objects.filter(organisation=organisation, id=data.pop("account_id", None)).first()
        if not account or "unit_cost" not in data:
            raise BusinessRuleError("GRNI account and unit cost are required.")
        transaction = receive_purchase(organisation=organisation, product=product,
            warehouse=warehouse, receipt_date=data.pop("transaction_date"),
            grni_account=account, user=request.user, **data)
        return self._response(transaction)

    @action(detail=False, methods=["post"], url_path="sales-issues")
    def sales_issue(self, request):
        data = self._request(request); organisation, product, warehouse = self._objects(data)
        invoice = Invoice.objects.filter(organisation=organisation, id=data.pop("source_document_id", None)).first()
        data.pop("unit_cost", None); data.pop("account_id", None)
        if not invoice: raise BusinessRuleError("Approved invoice was not found.")
        return self._response(issue_sale(organisation=organisation, product=product,
            warehouse=warehouse, issue_date=data.pop("transaction_date"), invoice=invoice,
            user=request.user, **data))

    @action(detail=False, methods=["post"])
    def transfer(self, request):
        data = self._request(request); organisation, product, warehouse = self._objects(data)
        destination = Warehouse.objects.filter(organisation=organisation,
            id=data.pop("destination_warehouse_id", None)).first()
        data.pop("unit_cost", None); data.pop("account_id", None)
        if not destination: raise BusinessRuleError("Destination warehouse was not found.")
        return self._response(transfer_stock(organisation=organisation, product=product,
            source_warehouse=warehouse, destination_warehouse=destination,
            transfer_date=data.pop("transaction_date"), user=request.user, **data))

    @action(detail=False, methods=["post"], url_path="customer-returns")
    def customer_return(self, request):
        data = self._request(request); organisation, product, warehouse = self._objects(data)
        invoice = Invoice.objects.filter(organisation=organisation, id=data.pop("source_document_id", None)).first()
        movement = StockMovement.objects.filter(organisation=organisation,
            id=data.pop("original_movement_id", None)).first()
        data.pop("unit_cost", None); data.pop("account_id", None)
        if not invoice or not movement: raise BusinessRuleError("Invoice and original issue are required.")
        return self._response(return_customer_stock(organisation=organisation, product=product,
            warehouse=warehouse, return_date=data.pop("transaction_date"), invoice=invoice,
            original_issue=movement, user=request.user, **data))

    @action(detail=False, methods=["post"], url_path="supplier-returns")
    def supplier_return(self, request):
        data = self._request(request); organisation, product, warehouse = self._objects(data)
        account = Account.objects.filter(organisation=organisation, id=data.pop("account_id", None)).first()
        receipt = StockMovement.objects.filter(
            organisation=organisation, id=data.pop("original_movement_id", None)
        ).first()
        data.pop("unit_cost", None)
        data.pop("source_document_id", None)
        if not account: raise BusinessRuleError("GRNI or payable account is required.")
        return self._response(return_supplier_stock(organisation=organisation, product=product,
            warehouse=warehouse, return_date=data.pop("transaction_date"),
            settlement_account=account, original_receipt=receipt, user=request.user, **data))


class StockCountViewSet(OrganisationScopedViewSetMixin, ModelViewSet):
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_INVENTORY, "retrieve": VIEW_INVENTORY,
                          "create": ADJUST_STOCK, "start": ADJUST_STOCK, "post": ADJUST_STOCK}
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return StockCount.objects.filter(organisation=self.get_organisation()).prefetch_related("lines__product")

    def get_serializer_class(self):
        return StockCountCreateSerializer if self.action == "create" else StockCountSerializer

    def create(self, request):
        serializer = StockCountCreateSerializer(data=request.data); serializer.is_valid(raise_exception=True)
        data = serializer.validated_data; organisation = self.get_organisation()
        warehouse = Warehouse.objects.filter(organisation=organisation, id=data["warehouse_id"]).first()
        account = Account.objects.filter(organisation=organisation, id=data["offset_account_id"]).first()
        products = list(Product.objects.filter(organisation=organisation, id__in=data["product_ids"]))
        if not warehouse or not account or len(products) != len(set(data["product_ids"])):
            raise BusinessRuleError("Warehouse, account, or one or more products were not found.")
        obj = create_stock_count(organisation=organisation, warehouse=warehouse,
            count_date=data["count_date"], reference=data["reference"], offset_account=account,
            products=products, user=request.user)
        return Response(StockCountSerializer(obj).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        return Response(StockCountSerializer(start_stock_count(stock_count=self.get_object(), user=request.user)).data)

    @action(detail=True, methods=["post"])
    def post(self, request, pk=None):
        serializer = StockCountPostSerializer(data=request.data); serializer.is_valid(raise_exception=True)
        post_stock_count(stock_count=self.get_object(), counts=serializer.validated_data["counts"], user=request.user)
        return Response(StockCountSerializer(self.get_object()).data)


class InventoryReportViewSet(OrganisationScopedViewSetMixin, ViewSet):
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"valuation": VIEW_INVENTORY, "stock_on_hand": VIEW_INVENTORY,
                          "movements": VIEW_INVENTORY, "negative": VIEW_INVENTORY,
                          "reorder": VIEW_INVENTORY, "slow_moving": VIEW_INVENTORY,
                          "fast_moving": VIEW_INVENTORY}

    @action(detail=False, methods=["get"])
    def valuation(self, request): return Response(get_inventory_valuation(organisation=self.get_organisation()))
    @action(detail=False, methods=["get"], url_path="stock-on-hand")
    def stock_on_hand(self, request): return Response(stock_on_hand(organisation=self.get_organisation()))
    @action(detail=False, methods=["get"])
    def movements(self, request): return Response(movement_history(organisation=self.get_organisation()))
    @action(detail=False, methods=["get"], url_path="negative-stock")
    def negative(self, request): return Response(negative_stock(organisation=self.get_organisation()))
    @action(detail=False, methods=["get"])
    def reorder(self, request): return Response(reorder_report(organisation=self.get_organisation()))
    @action(detail=False, methods=["get"], url_path="slow-moving")
    def slow_moving(self, request): return Response(movement_velocity(organisation=self.get_organisation(), slow=True))
    @action(detail=False, methods=["get"], url_path="fast-moving")
    def fast_moving(self, request): return Response(movement_velocity(organisation=self.get_organisation(), slow=False))
