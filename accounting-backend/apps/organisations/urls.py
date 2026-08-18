from rest_framework.routers import DefaultRouter

from .views import OrganisationMemberViewSet, OrganisationViewSet


router = DefaultRouter()

router.register(
    "organisation-members",
    OrganisationMemberViewSet,
    basename="organisation-member",
)

router.register(
    "organisations",
    OrganisationViewSet,
    basename="organisation",
)

urlpatterns = router.urls
