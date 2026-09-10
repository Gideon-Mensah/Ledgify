from .historical import historical_aging


def aged_receivables(*, organisation, as_of_date, customer=None):
    return historical_aging(organisation=organisation, as_of_date=as_of_date, contact=customer)
