from apps.finance.services import aged_payables
def payable_context(*,organisation,as_of_date=None):return aged_payables(organisation=organisation,as_of_date=as_of_date)
