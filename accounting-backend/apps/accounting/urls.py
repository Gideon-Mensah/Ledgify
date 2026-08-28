from rest_framework.routers import DefaultRouter

from .views import (
    AccountViewSet,
    AccountingPeriodViewSet,
    AccountingReportViewSet,
    FinancialYearViewSet,
    JournalEntryViewSet,
    OpeningBalanceViewSet,
)


router = DefaultRouter()

router.register(
    "accounting-periods",
    AccountingPeriodViewSet,
    basename="accounting-period",
)
router.register("opening-balances",OpeningBalanceViewSet,basename="opening-balance")

router.register(
    "accounts",
    AccountViewSet,
    basename="account",
)

router.register(
    "journals",
    JournalEntryViewSet,
    basename="journal",
)

router.register(
    "financial-years",
    FinancialYearViewSet,
    basename="financial-year",
)

router.register(
    "reports",
    AccountingReportViewSet,
    basename="accounting-report",
)

urlpatterns = router.urls
