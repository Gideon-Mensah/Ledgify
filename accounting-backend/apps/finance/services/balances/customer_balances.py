"""Historical customer balances using the same cutoff policy as aging."""
from django.utils import timezone
from apps.finance.services.aging.historical import historical_aging


def customer_balance_summary(*, organisation, customer=None, as_of_date=None):
    return historical_aging(organisation=organisation, as_of_date=as_of_date or timezone.localdate(),
                            payable=False, contact=customer)
