"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import include, path
from rest_framework_simplejwt.views import TokenObtainPairView
from apps.accounts.views import PasswordAwareTokenRefreshView
from common.health import health,ready
from common.throttles import LoginRateThrottle
class ThrottledTokenObtainPairView(TokenObtainPairView):throttle_classes=[LoginRateThrottle]


urlpatterns = [
    path("health/", health),
    path("ready/", ready),
    path(
        "admin/",
        admin.site.urls,
    ),

    path(
        "api/v1/",
        include("apps.sales.urls"),
    ),
    
    path(
        "api/v1/auth/token/",
        ThrottledTokenObtainPairView.as_view(),
        name="token_obtain_pair",
    ),

    path(
        "api/v1/auth/token/refresh/",
        PasswordAwareTokenRefreshView.as_view(),
        name="token_refresh",
    ),

    path(
        "api/v1/",
        include("apps.accounts.urls"),
    ),
    
    path(
        "api/v1/",
        include("apps.organisations.urls"),
    ),
    
    path(
        "api/v1/",
        include("apps.contacts.urls"),
    ),
    
    path(
        "api/v1/",
        include("apps.accounting.urls"),
    ),
    path(
        "api/v1/",
        include("apps.purchases.urls"),
    ),
    path(
        "api/v1/",
        include("apps.banking.urls"),
    ),
    path(
        "api/v1/",
        include("apps.finance.urls"),
    ),
    path(
        "api/v1/",
        include("apps.inventory.urls"),
    ),
    path("api/v1/", include("apps.fixed_assets.urls")),
    path("api/v1/", include("apps.tax.urls")),
    path("api/v1/", include("apps.payroll.urls")),
    path("api/v1/", include("apps.fx.urls")),
    path("api/v1/", include("apps.consolidation.urls")),
    path("api/v1/", include("apps.manufacturing.urls")),
    path("api/v1/", include("apps.ai.urls")),
]
