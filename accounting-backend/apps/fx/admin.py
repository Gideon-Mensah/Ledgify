from django.contrib import admin
from apps.fx.models import Currency,ExchangeRate,FXRevaluation
admin.site.register(Currency);admin.site.register(ExchangeRate);admin.site.register(FXRevaluation)
