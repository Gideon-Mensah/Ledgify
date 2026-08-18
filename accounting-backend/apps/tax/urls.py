from rest_framework.routers import DefaultRouter
from apps.tax.views import TaxPeriodViewSet, TaxRateViewSet, TaxReportViewSet, TaxTransactionViewSet

router = DefaultRouter()
router.register("tax-rates", TaxRateViewSet, basename="tax-rate")
router.register("tax-periods", TaxPeriodViewSet, basename="tax-period")
router.register("tax-transactions", TaxTransactionViewSet, basename="tax-transaction")
router.register("tax/reports", TaxReportViewSet, basename="tax-report")
urlpatterns = router.urls
