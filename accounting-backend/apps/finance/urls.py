from rest_framework.routers import DefaultRouter

from .views import FinanceReportViewSet


router = DefaultRouter()

router.register(
    "finance",
    FinanceReportViewSet,
    basename="finance-report",
)

urlpatterns = router.urls
