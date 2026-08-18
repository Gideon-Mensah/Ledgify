"""Calculate employee earnings, deductions, employer costs, and net pay with Decimal."""

from decimal import Decimal, ROUND_HALF_UP
from django.db import transaction
from common.exceptions import BusinessRuleError
from apps.payroll.models import Employee, PayrollComponent, PayrollRun, Payslip, PayslipLine

MONEY=Decimal("0.01")
def money(value):return Decimal(str(value)).quantize(MONEY,rounding=ROUND_HALF_UP)


@transaction.atomic
def calculate_pay_run(*,pay_run):
    run=PayrollRun.objects.select_for_update().get(pk=pay_run.pk)
    if run.status not in {PayrollRun.Status.DRAFT,PayrollRun.Status.CALCULATED}:raise BusinessRuleError("Only draft or calculated payroll can be recalculated.")
    run.payslips.all().delete()
    employees=Employee.objects.filter(organisation=run.organisation,employment_status=Employee.Status.ACTIVE,hire_date__lte=run.pay_period_end).exclude(termination_date__lt=run.pay_period_start).prefetch_related("pay_components__component")
    for employee in employees:
        slip=Payslip.objects.create(pay_run=run,employee=employee);gross=deductions=employer=Decimal("0.00")
        for assignment in employee.pay_components.all():
            component=assignment.component
            if not assignment.active or not component.active:continue
            if component.calculation_method==PayrollComponent.Method.ADAPTER:amount=Decimal("0.00")
            elif component.calculation_method==PayrollComponent.Method.QUANTITY_RATE:amount=money(assignment.quantity*assignment.rate)
            else:amount=money(assignment.amount)
            if amount<0:raise BusinessRuleError("Payroll component amounts cannot be negative.")
            PayslipLine.objects.create(payslip=slip,component=component,component_name=component.name,component_type=component.component_type,amount=amount,account=component.default_account,liability_account=component.liability_account,taxable=component.taxable,pensionable=component.pensionable)
            if component.component_type==PayrollComponent.Type.EARNING:gross+=amount
            elif component.component_type==PayrollComponent.Type.DEDUCTION:deductions+=amount
            else:employer+=amount
        if deductions>gross:raise BusinessRuleError(f"Deductions exceed gross pay for {employee.full_name}.")
        slip.gross_pay=money(gross);slip.deductions=money(deductions);slip.employer_costs=money(employer);slip.net_pay=money(gross-deductions);slip.save(update_fields=["gross_pay","deductions","employer_costs","net_pay"])
    if not run.payslips.exists():raise BusinessRuleError("No eligible active employees were found.")
    run.status=PayrollRun.Status.CALCULATED;run.save(update_fields=["status","updated_at"]);return run
