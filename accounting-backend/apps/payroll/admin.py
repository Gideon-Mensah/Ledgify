from django.contrib import admin
from apps.payroll.models import *
@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
 list_display=("employee_number","full_name","organisation","employment_status");exclude=("bank_account_details",);readonly_fields=("created_at","updated_at")
for model in (PayrollComponent,EmployeePayrollComponent,PayrollRun,Payslip,PayslipLine,PayrollPayment):admin.site.register(model)
