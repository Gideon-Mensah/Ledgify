from rest_framework.routers import DefaultRouter
from apps.fx.views import CurrencyViewSet,ExchangeRateViewSet,FXReportViewSet,FXRevaluationViewSet
router=DefaultRouter();router.register("currencies",CurrencyViewSet);router.register("exchange-rates",ExchangeRateViewSet,basename="exchange-rate");router.register("fx-revaluations",FXRevaluationViewSet,basename="fx-revaluation");router.register("fx-reports",FXReportViewSet,basename="fx-report");urlpatterns=router.urls
