from .historical import historical_statement


def supplier_statement(*,organisation,supplier,start_date=None,end_date=None):
    return historical_statement(organisation=organisation,contact=supplier,start_date=start_date,end_date=end_date,payable=True)
