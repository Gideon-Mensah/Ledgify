from datetime import date
from decimal import Decimal
from django.contrib.auth import get_user_model
from django.test import TestCase
from apps.accounting.models import Account
from apps.organisations.models import Organisation,OrganisationMember
from apps.payroll.models import Employee,EmployeePayrollComponent,PayrollComponent,PayrollRun,Payslip
from apps.payroll.services import approve_pay_run,calculate_pay_run,pay_pay_run,payroll_liability,payroll_summary,post_pay_run

class PayrollWorkflowTests(TestCase):
    def setUp(self):
        self.user=get_user_model().objects.create_user(username="payroll-owner",email="payroll@example.com",password="x",first_name="Pay",last_name="Roll")
        self.org=Organisation.objects.create(name="Payroll Test",created_by=self.user);OrganisationMember.objects.create(organisation=self.org,user=self.user,role="owner")
        self.salary=self.account("6000","Salary expense","expense","operating_expense");self.tax=self.account("2200","Deduction liability","liability","current_liability");self.payable=self.account("2210","Payroll payable","liability","current_liability");self.bank=self.account("1000","Bank","asset","bank")
        self.employee=Employee.objects.create(organisation=self.org,employee_number="E001",first_name="Ada",last_name="Mensah",hire_date=date(2026,1,1),currency="USD")
        earning=PayrollComponent.objects.create(organisation=self.org,name="Salary",component_type="earning",default_account=self.salary)
        deduction=PayrollComponent.objects.create(organisation=self.org,name="Configured deduction",component_type="deduction",default_account=self.tax,liability_account=self.tax)
        EmployeePayrollComponent.objects.create(employee=self.employee,component=earning,amount=Decimal("1000"));EmployeePayrollComponent.objects.create(employee=self.employee,component=deduction,amount=Decimal("100"))
    def account(self,code,name,account_type,account_class):return Account.objects.create(organisation=self.org,created_by=self.user,code=code,name=name,account_type=account_type,account_class=account_class,currency="USD")
    def test_complete_payroll_journal_payment_and_reports(self):
        run=PayrollRun.objects.create(organisation=self.org,pay_period_start=date(2026,8,1),pay_period_end=date(2026,8,31),payment_date=date(2026,8,31),payroll_liability_account=self.payable,created_by=self.user)
        calculate_pay_run(pay_run=run);slip=run.payslips.get();self.assertEqual((slip.gross_pay,slip.deductions,slip.net_pay),(Decimal("1000.00"),Decimal("100.00"),Decimal("900.00")))
        approve_pay_run(pay_run=run,user=self.user);post_pay_run(pay_run=run,user=self.user);run.refresh_from_db();self.assertEqual(run.status,"posted")
        journal=run.payslips.get().journal;self.assertEqual(sum(x.debit for x in journal.lines.all()),Decimal("1000.00"));self.assertEqual(sum(x.credit for x in journal.lines.all()),Decimal("1000.00"))
        pay_pay_run(pay_run=run,bank_account=self.bank,payment_date=date(2026,8,31),amount=Decimal("400"),user=self.user);self.assertEqual(Payslip.objects.get().payment_status,"partially_paid")
        pay_pay_run(pay_run=run,bank_account=self.bank,payment_date=date(2026,9,1),amount=Decimal("500"),user=self.user);run.refresh_from_db();self.assertEqual(run.status,"paid")
        self.assertEqual(payroll_summary(organisation=self.org)["net"],Decimal("900.00"));self.assertEqual(payroll_liability(organisation=self.org)["outstanding"],Decimal("0.00"))
