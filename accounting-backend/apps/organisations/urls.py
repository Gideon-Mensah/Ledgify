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

from django.urls import path
from .invitation_views import InvitationsView, InvitationActionView, InvitationAcceptanceView
urlpatterns += [
    path("organisation-invitations/", InvitationsView.as_view()),
    path("organisation-invitations/<uuid:invitation_id>/<str:operation>/", InvitationActionView.as_view()),
    path("invitation-acceptance/", InvitationAcceptanceView.as_view()),
]

from .onboarding_views import OnboardingView, SetupChecklistView
urlpatterns += [path("onboarding/", OnboardingView.as_view()), path("organisation-setup/", SetupChecklistView.as_view())]
