"""Move payroll through calculation, approval, posting, and payment workflows safely."""

from collections import defaultdict
from decimal import Decimal
from django.db import transaction
from django.utils import timezone
from common.exceptions import BusinessRuleError
from apps.accounting.models import Account,JournalEntry
from apps.accounting.services.journals import create_journal_entry,post_journal_entry
from apps.payroll.models import PayrollComponent,PayrollPayment,PayrollRun,Payslip


@transaction.atomic
def approve_pay_run(*,pay_run,user):
    run=PayrollRun.objects.select_for_update().get(pk=pay_run.pk)
    if run.status!=PayrollRun.Status.CALCULATED:raise BusinessRuleError("Only calculated payroll can be approved.")
    if run.organisation.require_separate_approver and run.created_by_id==user.id:raise BusinessRuleError("You cannot approve a payroll run you created.")
    run.status=PayrollRun.Status.APPROVED;run.approved_by=user;run.save(update_fields=["status","approved_by","updated_at"]);return run


@transaction.atomic
def post_pay_run(*,pay_run,user):
    run=PayrollRun.objects.select_for_update().select_related("organisation","payroll_liability_account").prefetch_related("payslips__lines__account","payslips__lines__liability_account").get(pk=pay_run.pk)
    if run.status!=PayrollRun.Status.APPROVED:raise BusinessRuleError("Only approved payroll can be posted.")
    totals=defaultdict(lambda:[None,Decimal("0.00"),Decimal("0.00")]);net=Decimal("0.00")
    for slip in run.payslips.all():
        net+=slip.net_pay
        for line in slip.lines.all():
            if line.component_type==PayrollComponent.Type.EARNING:account=line.account;totals[account.id]=[account,totals[account.id][1]+line.amount,totals[account.id][2]]
            elif line.component_type==PayrollComponent.Type.DEDUCTION:
                account=line.liability_account or line.account;totals[account.id]=[account,totals[account.id][1],totals[account.id][2]+line.amount]
            else:
                expense=line.account;liability=line.liability_account
                if not liability:raise BusinessRuleError(f"Employer component {line.component_name} requires a liability account.")
                totals[expense.id]=[expense,totals[expense.id][1]+line.amount,totals[expense.id][2]];totals[liability.id]=[liability,totals[liability.id][1],totals[liability.id][2]+line.amount]
    account=run.payroll_liability_account;totals[account.id]=[account,totals[account.id][1],totals[account.id][2]+net]
    lines=[{"account":item[0],"description":f"Payroll {run.pay_period_end}","debit":item[1],"credit":item[2]} for item in totals.values() if item[1] or item[2]]
    journal=create_journal_entry(organisation=run.organisation,date=run.payment_date,description=f"Payroll {run.pay_period_start} to {run.pay_period_end}",lines=lines,user=user,reference=f"PAY-{run.pay_period_end}",source_type=JournalEntry.SourceType.PAYROLL,source_id=run.id)
    post_journal_entry(journal_entry=journal,user=user);run.payslips.update(journal=journal);run.status=PayrollRun.Status.POSTED;run.processed_at=timezone.now();run.save(update_fields=["status","processed_at","updated_at"]);return run


@transaction.atomic
def pay_pay_run(*,pay_run,bank_account,payment_date,amount,user):
    run=PayrollRun.objects.select_for_update().select_related("organisation","payroll_liability_account").get(pk=pay_run.pk)
    if run.status not in {PayrollRun.Status.POSTED,PayrollRun.Status.PAID}:raise BusinessRuleError("Only posted payroll can be paid.")
    if bank_account.organisation_id!=run.organisation_id or bank_account.account_class!=Account.AccountClass.BANK:raise BusinessRuleError("A valid organisation bank account is required.")
    amount=Decimal(str(amount));outstanding=sum((x.net_pay-x.amount_paid for x in run.payslips.all()),Decimal("0.00"))
    if amount<=0 or amount>outstanding:raise BusinessRuleError("Payment must be positive and cannot exceed payroll outstanding.")
    journal=create_journal_entry(organisation=run.organisation,date=payment_date,description=f"Payroll payment {run.pay_period_end}",lines=[{"account":run.payroll_liability_account,"debit":amount,"credit":0},{"account":bank_account,"debit":0,"credit":amount}],user=user,reference=f"PAYMENT-{run.pay_period_end}",source_type=JournalEntry.SourceType.PAYROLL_PAYMENT,source_id=run.id)
    post_journal_entry(journal_entry=journal,user=user);payment=PayrollPayment.objects.create(pay_run=run,payment_date=payment_date,amount=amount,bank_account=bank_account,journal=journal,created_by=user)
    remaining=amount
    for slip in run.payslips.order_by("employee__employee_number"):
        allocation=min(remaining,slip.net_pay-slip.amount_paid);slip.amount_paid+=allocation;remaining-=allocation
        slip.payment_status=Payslip.PaymentStatus.PAID if slip.amount_paid==slip.net_pay else Payslip.PaymentStatus.PARTIAL
        slip.save(update_fields=["amount_paid","payment_status"])
        if not remaining:break
    if not run.payslips.exclude(payment_status=Payslip.PaymentStatus.PAID).exists():run.status=PayrollRun.Status.PAID;run.save(update_fields=["status","updated_at"])
    return payment
