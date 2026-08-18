from django.urls import path

from .views import CurrentUserView


urlpatterns = [
    path("auth/me/", CurrentUserView.as_view(), name="current-user"),
]
