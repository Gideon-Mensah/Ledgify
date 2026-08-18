from rest_framework.routers import DefaultRouter

from .views import (
    BillViewSet,
    SupplierPaymentViewSet,
    SupplierCreditViewSet,
    SupplierRefundViewSet,
    PurchaseOrderViewSet,
)


router = DefaultRouter()
router.register("purchase-orders", PurchaseOrderViewSet, basename="purchase-order")

router.register(
    "bills",
    BillViewSet,
    basename="bill",
)

router.register(
    "supplier-refunds",
    SupplierRefundViewSet,
    basename="supplier-refund",
)

router.register(
    "supplier-credits",
    SupplierCreditViewSet,
    basename="supplier-credit",
)

router.register(
    "supplier-payments",
    SupplierPaymentViewSet,
    basename="supplier-payment",
)

urlpatterns = router.urls
