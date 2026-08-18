"""Report payroll runs and liabilities from calculated and posted payroll records."""

from decimal import Decimal
from django.db.models import Sum
from apps.payroll.models import PayrollRun,Payslip,PayslipLine

def _slips(organisation,start_date=None,end_date=None):
    qs=Payslip.objects.filter(pay_run__organisation=organisation,pay_run__status__in=[PayrollRun.Status.POSTED,PayrollRun.Status.PAID])
    if start_date:qs=qs.filter(pay_run__payment_date__gte=start_date)
    if end_date:qs=qs.filter(pay_run__payment_date__lte=end_date)
    return qs
def payroll_summary(*,organisation,start_date=None,end_date=None):
    values=_slips(organisation,start_date,end_date).aggregate(gross=Sum("gross_pay"),deductions=Sum("deductions"),employer_costs=Sum("employer_costs"),net=Sum("net_pay"),paid=Sum("amount_paid"))
    return {key:value or Decimal("0.00") for key,value in values.items()}
def employee_earnings(*,organisation,start_date=None,end_date=None):
    return list(_slips(organisation,start_date,end_date).values("employee_id","employee__employee_number","employee__first_name","employee__last_name").annotate(gross_pay=Sum("gross_pay"),deductions=Sum("deductions"),net_pay=Sum("net_pay")))
def payroll_liability(*,organisation,start_date=None,end_date=None):
    data=payroll_summary(organisation=organisation,start_date=start_date,end_date=end_date);data["outstanding"]=data["net"]-data["paid"];return data
def year_to_date_summary(*,organisation,year):
    return employee_earnings(organisation=organisation,start_date=f"{year}-01-01",end_date=f"{year}-12-31")
