from django.urls import path

from .views import CurrentUserView, PasswordResetConfirmView, PasswordResetRequestView


urlpatterns = [
    path("auth/me/", CurrentUserView.as_view(), name="current-user"),
    path("auth/password-reset/request/", PasswordResetRequestView.as_view(), name="password-reset-request"),
    path("auth/password-reset/confirm/", PasswordResetConfirmView.as_view(), name="password-reset-confirm"),
]
