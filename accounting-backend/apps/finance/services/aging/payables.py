from .historical import historical_aging


def aged_payables(*, organisation, as_of_date, supplier=None):
    return historical_aging(organisation=organisation, as_of_date=as_of_date, payable=True, contact=supplier)
