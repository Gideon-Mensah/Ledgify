from rest_framework.routers import DefaultRouter

from .views import (
    AccountViewSet,
    AccountingPeriodViewSet,
    AccountingReportViewSet,
    FinancialYearViewSet,
    JournalEntryViewSet,
)


router = DefaultRouter()

router.register(
    "accounting-periods",
    AccountingPeriodViewSet,
    basename="accounting-period",
)

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
