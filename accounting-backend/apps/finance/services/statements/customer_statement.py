from .historical import historical_statement


def customer_statement(*,organisation,customer,start_date=None,end_date=None):
    return historical_statement(organisation=organisation,contact=customer,start_date=start_date,end_date=end_date)
