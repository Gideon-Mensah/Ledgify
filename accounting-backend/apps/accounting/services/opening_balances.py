"""Validate, post, and reverse organisation opening balances."""
from decimal import Decimal,InvalidOperation
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from common.exceptions import BusinessRuleError
from apps.organisations.permissions import APPROVE_OPENING_BALANCES,MANAGE_OPENING_BALANCES
from apps.organisations.services import require_organisation_permission
from apps.accounting.models import Account,JournalEntry,OpeningBalance,OpeningBalanceLine
from apps.accounting.services.journals import create_journal_entry,post_journal_entry,reverse_journal_entry

ZERO=Decimal("0.00")
def totals(record):
 values=record.lines.aggregate(debit=Sum("debit"),credit=Sum("credit"));debit=values["debit"] or ZERO;credit=values["credit"] or ZERO
 return {"debit":debit,"credit":credit,"difference":debit-credit,"balanced":debit==credit and debit>ZERO,"accounts":record.lines.exclude(debit=0,credit=0).count()}

@transaction.atomic
def save_draft(*,record,organisation,user,data):
 require_organisation_permission(organisation=organisation,user=user,permission=MANAGE_OPENING_BALANCES)
 if record and (record.organisation_id!=organisation.id or record.status!=OpeningBalance.Status.DRAFT):raise BusinessRuleError("Only an organisation draft opening balance can be edited.")
 if record is None:record=OpeningBalance.objects.create(organisation=organisation,opening_date=data["opening_date"],reference=data.get("reference",""),description=data.get("description",""),created_by=user,updated_by=user)
 else:
  record.opening_date=data["opening_date"];record.reference=data.get("reference","");record.description=data.get("description","");record.updated_by=user;record.save(update_fields=["opening_date","reference","description","updated_by","updated_at"]);record.lines.all().delete()
 seen=set()
 for index,item in enumerate(data.get("lines",[]),1):
  account=Account.objects.filter(id=item.get("account_id"),organisation=organisation,status=Account.Status.ACTIVE).first()
  if not account:raise BusinessRuleError(f"Opening balance row {index} uses an invalid, inactive, or foreign account.")
  if account.id in seen:raise BusinessRuleError(f"Account {account.code} appears more than once.")
  seen.add(account.id)
  try:debit=Decimal(str(item.get("debit") or 0)).quantize(Decimal("0.01"));credit=Decimal(str(item.get("credit") or 0)).quantize(Decimal("0.01"))
  except (InvalidOperation,ValueError):raise BusinessRuleError(f"Opening balance row {index} has an invalid amount.")
  if debit<ZERO or credit<ZERO or (debit>ZERO and credit>ZERO):raise BusinessRuleError(f"Account {account.code} requires one non-negative debit or credit amount.")
  if debit==ZERO and credit==ZERO:continue
  OpeningBalanceLine.objects.create(opening_balance=record,account=account,debit=debit,credit=credit,unusual_side_confirmed=bool(item.get("unusual_side_confirmed")))
 return record

def submit(record,user):
 require_organisation_permission(organisation=record.organisation,user=user,permission=MANAGE_OPENING_BALANCES)
 if record.status!=OpeningBalance.Status.DRAFT:raise BusinessRuleError("Only a draft opening balance can be submitted.")
 summary=totals(record)
 if not summary["balanced"]:raise BusinessRuleError("Opening balances must have equal, positive debits and credits before submission.")
 record.status=OpeningBalance.Status.SUBMITTED;record.updated_by=user;record.save(update_fields=["status","updated_by","updated_at"]);return record

@transaction.atomic
def post(record,user):
 record=OpeningBalance.objects.select_for_update().select_related("organisation").prefetch_related("lines__account").get(pk=record.pk)
 require_organisation_permission(organisation=record.organisation,user=user,permission=APPROVE_OPENING_BALANCES)
 if record.status!=OpeningBalance.Status.SUBMITTED:raise BusinessRuleError("Only a submitted opening balance can be posted.")
 if record.organisation.require_separate_approver and record.created_by_id==user.id:raise BusinessRuleError("You cannot approve an opening balance you created.")
 if OpeningBalance.objects.filter(organisation=record.organisation,opening_date=record.opening_date,status=OpeningBalance.Status.POSTED).exclude(pk=record.pk).exists():raise BusinessRuleError("A posted opening balance already exists for this date. Reverse it before posting a correction.")
 summary=totals(record)
 if not summary["balanced"]:raise BusinessRuleError("Opening balances are not balanced.")
 journal=create_journal_entry(organisation=record.organisation,date=record.opening_date,reference=record.reference,description=record.description or "Opening balances",source_type=JournalEntry.SourceType.OPENING_BALANCE,source_id=record.id,user=user,lines=[{"account":line.account,"debit":line.debit,"credit":line.credit,"description":"Opening balance"} for line in record.lines.all()])
 journal=post_journal_entry(journal,user,check_permissions=False);record.journal=journal;record.status=OpeningBalance.Status.POSTED;record.posted_by=user;record.posted_at=timezone.now();record.updated_by=user;record.save(update_fields=["journal","status","posted_by","posted_at","updated_by","updated_at"]);return record

@transaction.atomic
def reverse(record,user,reversal_date):
 require_organisation_permission(organisation=record.organisation,user=user,permission=APPROVE_OPENING_BALANCES)
 if record.status!=OpeningBalance.Status.POSTED or not record.journal_id:raise BusinessRuleError("Only a posted opening balance can be reversed.")
 reversal=reverse_journal_entry(record.journal,user,reversal_date,check_permissions=False);record.reversal_journal=reversal;record.status=OpeningBalance.Status.REVERSED;record.updated_by=user;record.save(update_fields=["reversal_journal","status","updated_by","updated_at"]);return record
