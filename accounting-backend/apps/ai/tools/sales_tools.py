from apps.finance.services import aged_receivables
def receivable_context(*,organisation,as_of_date=None):return aged_receivables(organisation=organisation,as_of_date=as_of_date)
