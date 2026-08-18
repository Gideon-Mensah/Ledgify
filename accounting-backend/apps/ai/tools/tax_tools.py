from django.db.models import Sum
from apps.tax.models import TaxTransaction
def tax_context(*,organisation):return list(TaxTransaction.objects.filter(organisation=organisation).values("direction").annotate(tax_amount=Sum("tax_amount")))
