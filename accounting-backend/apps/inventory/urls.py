from rest_framework.routers import DefaultRouter

from .views import (
    InventoryReportViewSet, InventoryTransactionViewSet, InventoryValuationViewSet,
    ProductViewSet, StockAdjustmentViewSet, StockCountViewSet, StockMovementViewSet,
    WarehouseViewSet,
)

router = DefaultRouter()
router.register("products", ProductViewSet, basename="product")
router.register("warehouses", WarehouseViewSet, basename="warehouse")
router.register("stock-movements", StockMovementViewSet, basename="stock-movement")
router.register("stock-adjustments", StockAdjustmentViewSet, basename="stock-adjustment")
router.register("inventory/valuation", InventoryValuationViewSet, basename="inventory-valuation")
router.register("inventory-transactions", InventoryTransactionViewSet, basename="inventory-transaction")
router.register("stock-counts", StockCountViewSet, basename="stock-count")
router.register("inventory/reports", InventoryReportViewSet, basename="inventory-report")
urlpatterns = router.urls
