from django.db.models import Sum
from apps.payroll.models import PayrollRun
def payroll_context(*,organisation):return list(PayrollRun.objects.filter(organisation=organisation).values("id","status","pay_period_start","pay_period_end").annotate(total_gross=Sum("payslips__gross_pay"),total_net=Sum("payslips__net_pay")))
