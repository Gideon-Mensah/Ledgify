from django.urls import path

from .views import LogoutView, CurrentUserView, PasswordResetConfirmView, PasswordResetRequestView


urlpatterns = [
    path("auth/logout/", LogoutView.as_view(), name="logout"),
    path("auth/me/", CurrentUserView.as_view(), name="current-user"),
    path("auth/password-reset/request/", PasswordResetRequestView.as_view(), name="password-reset-request"),
    path("auth/password-reset/confirm/", PasswordResetConfirmView.as_view(), name="password-reset-confirm"),
]

from .identity_views import RegistrationOptionsView, RegistrationView, ResendVerificationView, VerifyEmailView, ChangeEmailView
urlpatterns += [
    path("auth/registration/options/", RegistrationOptionsView.as_view()),
    path("auth/register/", RegistrationView.as_view()),
    path("auth/verification/resend/", ResendVerificationView.as_view()),
    path("auth/verification/confirm/", VerifyEmailView.as_view()),
    path("auth/email-change/", ChangeEmailView.as_view()),
]
