"""Resolve dated organisation exchange rates for consistent base-currency accounting."""

from decimal import Decimal,ROUND_HALF_UP
from common.exceptions import BusinessRuleError
from apps.fx.models import ExchangeRate

def get_effective_rate(*,organisation,base_currency,target_currency,date):
    from common.currencies import require_currency_code
    base=require_currency_code(base_currency);target=require_currency_code(target_currency)
    if base==target:return Decimal("1")
    direct=ExchangeRate.objects.filter(organisation=organisation,base_currency_id=base,target_currency_id=target,effective_date__lte=date).order_by("-effective_date","-created_at").first()
    if direct:return direct.rate
    inverse=ExchangeRate.objects.filter(organisation=organisation,base_currency_id=target,target_currency_id=base,effective_date__lte=date).order_by("-effective_date","-created_at").first()
    if inverse:return Decimal("1")/inverse.rate
    raise BusinessRuleError(f"No exchange rate exists for {base}/{target} on or before {date}.")
get_rate=get_effective_rate
def convert_amount(*,amount,rate,decimal_places=2):
    quantum=Decimal("1").scaleb(-decimal_places);return (Decimal(str(amount))*Decimal(str(rate))).quantize(quantum,rounding=ROUND_HALF_UP)


def get_period_average_rate(*,organisation,base_currency,target_currency,start_date,end_date):
    """Calendar-day weighted mean of effective dated rates; require start coverage."""
    from datetime import timedelta
    if end_date<start_date:raise BusinessRuleError('Invalid translation period.')
    days=(end_date-start_date).days+1
    total=Decimal('0')
    for offset in range(days):
        total+=get_effective_rate(organisation=organisation,base_currency=base_currency,
                                 target_currency=target_currency,date=start_date+timedelta(days=offset))
    return (total/Decimal(days)).quantize(Decimal('0.0000000001'),rounding=ROUND_HALF_UP)
