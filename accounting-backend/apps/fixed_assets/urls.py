from rest_framework.routers import DefaultRouter
from .views import AssetViewSet,CategoryViewSet,DepreciationViewSet,ReportViewSet
router=DefaultRouter();router.register("fixed-assets",AssetViewSet,basename="fixed-asset");router.register("fixed-asset-categories",CategoryViewSet,basename="fixed-asset-category");router.register("fixed-asset-depreciation",DepreciationViewSet,basename="fixed-asset-depreciation");router.register("fixed-asset-reports",ReportViewSet,basename="fixed-asset-report")
urlpatterns=router.urls
