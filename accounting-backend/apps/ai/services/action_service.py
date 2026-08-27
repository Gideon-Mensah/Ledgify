"""Keep AI actions as proposals until an authorised user explicitly executes them."""

from datetime import date
from decimal import Decimal,InvalidOperation
from django.db import transaction
from django.utils import timezone
from common.exceptions import BusinessRuleError
from apps.accounting.models import Account
from apps.accounting.services.journals import create_journal_entry
from apps.ai.models import AIActionAudit,AISettings
from apps.organisations.permissions import CREATE_JOURNAL
from apps.organisations.services import require_organisation_permission
BLOCKED_ACTIONS={"post_journal","payment","refund","reconcile","close_period","file_tax","pay_payroll","post_depreciation","dispose_asset","fx_revaluation","post_elimination","complete_production","change_permissions"}
def propose_journal(*,organisation,user,conversation,requested_action,payload):
 settings,_=AISettings.objects.get_or_create(organisation=organisation)
 if not settings.ai_enabled or not settings.allow_draft_actions:raise BusinessRuleError("AI draft actions are disabled for this organisation.")
 lines=[];debit=credit=Decimal("0");seen=set()
 for item in payload.get("lines",[]):
  account=Account.objects.filter(organisation=organisation,id=item.get("account_id"),status="active").first()
  if not account:raise BusinessRuleError("A proposed account is invalid, inactive, or belongs to another organisation.")
  try:d=Decimal(str(item.get("debit",0)));c=Decimal(str(item.get("credit",0)))
  except InvalidOperation as exc:raise BusinessRuleError("Proposed journal amounts are invalid.") from exc
  if d<0 or c<0 or bool(d)==bool(c):raise BusinessRuleError("Each proposal line requires one positive debit or credit.")
  signature=(str(account.id),d,c,str(item.get("description","")))
  if signature in seen:raise BusinessRuleError("The proposal contains a duplicate journal line.")
  seen.add(signature);debit+=d;credit+=c;lines.append({"account_id":str(account.id),"account":{"id":str(account.id),"code":account.code,"name":account.name},"debit":str(d),"credit":str(c),"description":str(item.get("description",""))})
 if len(lines)<2 or debit!=credit:raise BusinessRuleError("Proposed journal must contain at least two balanced lines.")
 proposed={"action_type":"draft_manual_journal","summary":payload.get("description","Draft journal"),"payload":{"date":str(payload.get("date") or timezone.localdate()),"description":payload.get("description","AI-assisted draft journal"),"reference":payload.get("reference","AI draft"),"lines":lines},"warnings":["This creates a draft only; posting requires the normal journal workflow."],"requires_confirmation":True}
 return AIActionAudit.objects.create(organisation=organisation,user=user,conversation=conversation,action_type="draft_manual_journal",requested_action=requested_action,proposed_payload=proposed)
@transaction.atomic
def execute_action(*,action,user):
 row=AIActionAudit.objects.select_for_update().select_related("organisation").get(pk=action.pk)
 if row.user_id!=user.id:raise BusinessRuleError("Only the proposing user can execute this AI action.")
 if row.status not in {"proposed","approved"}:raise BusinessRuleError("This AI action is no longer executable.")
 if row.action_type!="draft_manual_journal" or row.action_type in BLOCKED_ACTIONS:raise BusinessRuleError("This AI action is blocked from execution.")
 require_organisation_permission(organisation=row.organisation,user=user,permission=CREATE_JOURNAL);payload=row.proposed_payload["payload"];accounts={str(x.id):x for x in Account.objects.filter(organisation=row.organisation,id__in=[line["account_id"] for line in payload["lines"]],status="active")}
 if len(accounts)!=len({line["account_id"] for line in payload["lines"]}):raise BusinessRuleError("The proposal is stale because an account is no longer available.")
 journal=create_journal_entry(organisation=row.organisation,date=date.fromisoformat(payload["date"]),description=payload["description"],reference=payload.get("reference",""),user=user,lines=[{**line,"account":accounts[line["account_id"]]} for line in payload["lines"]]);row.status="executed";row.executed_payload={"journal_id":str(journal.id),"status":journal.status};row.result={"message":"Draft journal created through the normal journal service."};row.executed_at=timezone.now();row.save(update_fields=["status","executed_payload","result","executed_at"]);return row
