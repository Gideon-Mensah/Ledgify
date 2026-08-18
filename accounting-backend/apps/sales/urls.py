from rest_framework.routers import DefaultRouter

from .views import (
    CustomerPaymentViewSet,
    CustomerCreditNoteViewSet,
    CustomerRefundViewSet,
    BadDebtWriteOffViewSet,
    InvoiceViewSet,
    QuoteViewSet, SalesOrderViewSet,
)


router = DefaultRouter()
router.register("quotes", QuoteViewSet, basename="quote")
router.register("sales-orders", SalesOrderViewSet, basename="sales-order")

router.register(
    "invoices",
    InvoiceViewSet,
    basename="invoice",
)

router.register(
    "customer-refunds",
    CustomerRefundViewSet,
    basename="customer-refund",
)

router.register(
    "bad-debt-write-offs",
    BadDebtWriteOffViewSet,
    basename="bad-debt-write-off",
)

router.register(
    "customer-credit-notes",
    CustomerCreditNoteViewSet,
    basename="customer-credit-note",
)

router.register(
    "customer-payments",
    CustomerPaymentViewSet,
    basename="customer-payment",
)

urlpatterns = router.urls
