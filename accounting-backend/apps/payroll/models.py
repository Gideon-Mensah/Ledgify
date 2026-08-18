"""Employees, pay components, runs, and payslips for accounting payroll workflows."""

import uuid
from decimal import Decimal
from django.conf import settings
from django.db import models


class Employee(models.Model):
    class Status(models.TextChoices):
        ACTIVE="active","Active"; INACTIVE="inactive","Inactive"; TERMINATED="terminated","Terminated"
    class Frequency(models.TextChoices):
        WEEKLY="weekly","Weekly"; BIWEEKLY="biweekly","Biweekly"; MONTHLY="monthly","Monthly"; OTHER="other","Other"
    class PaymentMethod(models.TextChoices):
        BANK="bank","Bank transfer"; CASH="cash","Cash"; OTHER="other","Other"
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
    organisation=models.ForeignKey("organisations.Organisation",on_delete=models.CASCADE,related_name="employees")
    employee_number=models.CharField(max_length=50);first_name=models.CharField(max_length=100);last_name=models.CharField(max_length=100)
    email=models.EmailField(blank=True);phone=models.CharField(max_length=50,blank=True);department=models.CharField(max_length=100,blank=True);job_title=models.CharField(max_length=100,blank=True)
    hire_date=models.DateField();termination_date=models.DateField(null=True,blank=True);employment_status=models.CharField(max_length=20,choices=Status.choices,default=Status.ACTIVE)
    pay_frequency=models.CharField(max_length=20,choices=Frequency.choices,default=Frequency.MONTHLY);payment_method=models.CharField(max_length=20,choices=PaymentMethod.choices,default=PaymentMethod.BANK)
    bank_account_details=models.JSONField(default=dict,blank=True);currency=models.CharField(max_length=3);created_at=models.DateTimeField(auto_now_add=True);updated_at=models.DateTimeField(auto_now=True)
    class Meta:
        ordering=["employee_number"];constraints=[models.UniqueConstraint(fields=["organisation","employee_number"],name="unique_employee_number_per_org")]
    def clean(self):
        from django.core.exceptions import ValidationError
        if self.termination_date and self.termination_date < self.hire_date: raise ValidationError("Termination date cannot precede hire date.")
    def save(self,*args,**kwargs):self.currency=self.currency.upper();self.full_clean();return super().save(*args,**kwargs)
    @property
    def full_name(self):return f"{self.first_name} {self.last_name}".strip()


class PayrollComponent(models.Model):
    class Type(models.TextChoices): EARNING="earning","Earning"; DEDUCTION="deduction","Deduction"; EMPLOYER_COST="employer_cost","Employer cost"
    class Method(models.TextChoices): FIXED="fixed","Fixed amount"; QUANTITY_RATE="quantity_rate","Quantity × rate"; ADAPTER="adapter","Jurisdiction adapter"
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False);organisation=models.ForeignKey("organisations.Organisation",on_delete=models.CASCADE,related_name="payroll_components")
    name=models.CharField(max_length=100);component_type=models.CharField(max_length=20,choices=Type.choices);calculation_method=models.CharField(max_length=30,choices=Method.choices,default=Method.FIXED)
    default_account=models.ForeignKey("accounting.Account",on_delete=models.PROTECT,related_name="payroll_components")
    liability_account=models.ForeignKey("accounting.Account",on_delete=models.PROTECT,related_name="payroll_liability_components",null=True,blank=True)
    taxable=models.BooleanField(default=False);pensionable=models.BooleanField(default=False);active=models.BooleanField(default=True);created_at=models.DateTimeField(auto_now_add=True);updated_at=models.DateTimeField(auto_now=True)
    class Meta: constraints=[models.UniqueConstraint(fields=["organisation","name"],name="unique_payroll_component_per_org")]


class EmployeePayrollComponent(models.Model):
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False);employee=models.ForeignKey(Employee,on_delete=models.CASCADE,related_name="pay_components");component=models.ForeignKey(PayrollComponent,on_delete=models.PROTECT,related_name="employee_assignments")
    amount=models.DecimalField(max_digits=18,decimal_places=2,default=Decimal("0"));quantity=models.DecimalField(max_digits=18,decimal_places=4,default=Decimal("1"));rate=models.DecimalField(max_digits=18,decimal_places=4,default=Decimal("0"));active=models.BooleanField(default=True)
    class Meta: constraints=[models.UniqueConstraint(fields=["employee","component"],name="unique_employee_payroll_component")]


class PayrollRun(models.Model):
    class Status(models.TextChoices): DRAFT="draft","Draft";CALCULATED="calculated","Calculated";APPROVED="approved","Approved";POSTED="posted","Posted";PAID="paid","Paid"
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False);organisation=models.ForeignKey("organisations.Organisation",on_delete=models.CASCADE,related_name="payroll_runs")
    pay_period_start=models.DateField();pay_period_end=models.DateField();payment_date=models.DateField();status=models.CharField(max_length=20,choices=Status.choices,default=Status.DRAFT)
    payroll_liability_account=models.ForeignKey("accounting.Account",on_delete=models.PROTECT,related_name="payroll_runs")
    created_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT,related_name="payroll_runs_created");approved_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT,null=True,blank=True,related_name="payroll_runs_approved");processed_at=models.DateTimeField(null=True,blank=True);created_at=models.DateTimeField(auto_now_add=True);updated_at=models.DateTimeField(auto_now=True)
    class Meta: ordering=["-pay_period_end"];constraints=[models.UniqueConstraint(fields=["organisation","pay_period_start","pay_period_end"],name="unique_payroll_run_period")]


class Payslip(models.Model):
    class PaymentStatus(models.TextChoices): PENDING="pending","Pending";PARTIAL="partially_paid","Partially paid";PAID="paid","Paid"
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False);pay_run=models.ForeignKey(PayrollRun,on_delete=models.PROTECT,related_name="payslips");employee=models.ForeignKey(Employee,on_delete=models.PROTECT,related_name="payslips")
    gross_pay=models.DecimalField(max_digits=18,decimal_places=2,default=0);deductions=models.DecimalField(max_digits=18,decimal_places=2,default=0);employer_costs=models.DecimalField(max_digits=18,decimal_places=2,default=0);net_pay=models.DecimalField(max_digits=18,decimal_places=2,default=0);amount_paid=models.DecimalField(max_digits=18,decimal_places=2,default=0)
    journal=models.ForeignKey("accounting.JournalEntry",on_delete=models.PROTECT,null=True,blank=True,related_name="payroll_payslips");payment_status=models.CharField(max_length=20,choices=PaymentStatus.choices,default=PaymentStatus.PENDING);created_at=models.DateTimeField(auto_now_add=True)
    class Meta: constraints=[models.UniqueConstraint(fields=["pay_run","employee"],name="unique_employee_payslip_per_run")]


class PayslipLine(models.Model):
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False);payslip=models.ForeignKey(Payslip,on_delete=models.PROTECT,related_name="lines");component=models.ForeignKey(PayrollComponent,on_delete=models.PROTECT,related_name="payslip_lines")
    component_name=models.CharField(max_length=100);component_type=models.CharField(max_length=20);amount=models.DecimalField(max_digits=18,decimal_places=2);account=models.ForeignKey("accounting.Account",on_delete=models.PROTECT,related_name="payslip_lines");liability_account=models.ForeignKey("accounting.Account",on_delete=models.PROTECT,null=True,blank=True,related_name="payslip_liability_lines")
    taxable=models.BooleanField(default=False);pensionable=models.BooleanField(default=False)


class PayrollPayment(models.Model):
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False);pay_run=models.ForeignKey(PayrollRun,on_delete=models.PROTECT,related_name="payments");payment_date=models.DateField();amount=models.DecimalField(max_digits=18,decimal_places=2);bank_account=models.ForeignKey("accounting.Account",on_delete=models.PROTECT,related_name="payroll_payments");journal=models.OneToOneField("accounting.JournalEntry",on_delete=models.PROTECT,related_name="payroll_payment");created_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT,related_name="payroll_payments_created");created_at=models.DateTimeField(auto_now_add=True)
