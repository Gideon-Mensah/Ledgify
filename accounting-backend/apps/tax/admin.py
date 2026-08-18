from django.contrib import admin
from apps.tax.models import TaxPeriod, TaxRate, TaxTransaction

admin.site.register(TaxRate)
admin.site.register(TaxPeriod)
admin.site.register(TaxTransaction)
