"""Map, translate, combine, and eliminate group balances for supported consolidations."""

from collections import defaultdict
from decimal import Decimal
from django.db import transaction
from django.db import models
from django.db.models import Sum
from django.utils import timezone
from common.exceptions import BusinessRuleError
from common.ledger_integrity import lock_ledger
from apps.accounting.models import JournalLine, LEDGER_EFFECTIVE_JOURNAL_STATUSES
from apps.fx.services import convert_amount,get_effective_rate
from .models import *
from .security import require_group
def mutable_period(period):
 period=ConsolidationPeriod.objects.select_for_update().get(pk=period.pk)
 if period.status=="finalised":raise BusinessRuleError("Reopen the finalised consolidation period with an authorised reason before changing it.")
 return period

@transaction.atomic
def prepare_consolidation(*,group,period,user):
 require_group(group,user,period)
 period=mutable_period(period)
 version=(period.snapshots.aggregate(v=models.Max("version"))["v"] or 0)+1
 members=group.members.filter(status="active",effective_from__lte=period.end_date).filter(models.Q(effective_to=None)|models.Q(effective_to__gte=period.start_date))
 from apps.fx.services.exchange_rate_service import get_period_average_rate
 members=list(members.order_by("organisation_id"))
 for member in members:lock_ledger(member.organisation_id)
 for member in members:
  if member.consolidation_method!="full" or member.ownership_percentage!=100:raise BusinessRuleError("Only FULL method and 100% ownership are supported.")
  ledger=JournalLine.objects.filter(journal_entry__organisation=member.organisation,journal_entry__status__in=LEDGER_EFFECTIVE_JOURNAL_STATUSES,journal_entry__date__lte=period.end_date)
  nominal=models.Q(account__account_type__in=("revenue","expense"))
  balances=list(ledger.filter(~nominal|models.Q(journal_entry__date__gte=period.start_date)).values("account_id","account__account_type").annotate(debit=Sum("debit"),credit=Sum("credit")))
  prior=list(ledger.filter(nominal,journal_entry__date__lt=period.start_date).values("account_id","account__account_type").annotate(debit=Sum("debit"),credit=Sum("credit")))
  mappings={x.source_account_id:x for x in group.mappings.select_related("consolidation_account").filter(organisation=member.organisation,effective_from__lte=period.end_date).filter(models.Q(effective_to=None)|models.Q(effective_to__gte=period.end_date))}
  if any(row["account_id"] not in mappings and row["debit"]!=row["credit"] for row in balances+prior):raise BusinessRuleError("Map all material source accounts before preparing consolidation.")
  retained=None
  if sum((row["credit"]-row["debit"] for row in prior),Decimal("0")):
   retained=group.accounts.filter(account_type="equity",account_class="retained_earnings",status="active").first()
   if not retained:raise BusinessRuleError("A group retained-earnings account is required for prior-period nominal balances.")
  closing=get_effective_rate(organisation=member.organisation,base_currency=member.organisation.base_currency,target_currency=group.reporting_currency_id,date=period.end_date)
  average=None
  if any(row["account__account_type"] in ("revenue","expense") and row["debit"]!=row["credit"] for row in balances):
   average=get_period_average_rate(organisation=member.organisation,base_currency=member.organisation.base_currency,target_currency=group.reporting_currency_id,start_date=period.start_date,end_date=period.end_date)
  snapshot=ConsolidationSnapshot.objects.create(group=group,period=period,organisation=member.organisation,source_currency=member.organisation.base_currency,reporting_currency=group.reporting_currency_id,version=version,translation_metadata={"policy_version":2,"policy":"calendar-day effective-rate average for period nominal activity; closing for balance sheet and prior retained earnings"})
  source_difference=translated_difference=Decimal("0")
  for row,is_prior in [(row,False) for row in balances]+[(row,True) for row in prior]:
   net=row["debit"]-row["credit"]
   source_difference+=net
   if not net:continue
   if is_prior and not retained:continue
   target=retained if is_prior else mappings[row["account_id"]].consolidation_account
   if not is_prior and target.account_type!=row["account__account_type"]:raise BusinessRuleError("Source and mapped account types must agree.")
   method="average" if not is_prior and row["account__account_type"] in ("revenue","expense") else "closing"
   rate=average if method=="average" else closing
   debit=max(net,Decimal("0"));credit=max(-net,Decimal("0"))
   td=convert_amount(amount=debit,rate=rate);tc=convert_amount(amount=credit,rate=rate);translated_difference+=td-tc
   ConsolidationSnapshotLine.objects.create(snapshot=snapshot,source_account_id=row["account_id"],consolidation_account=target,source_debit=debit,source_credit=credit,translated_debit=td,translated_credit=tc,exchange_rate=rate,translation_method=method)
  if source_difference:raise BusinessRuleError("The source trial balance is not balanced; translation cannot conceal a source error.")
  if translated_difference and (not group.cta_account_id or group.cta_account.account_type!="equity" or group.cta_account.status!="active"):
   raise BusinessRuleError("Configure an active group equity CTA account for the translation difference.")
  snapshot.translation_metadata["translation_difference"]=str(translated_difference)
  snapshot.translation_metadata["cta_account_id"]=str(group.cta_account_id) if translated_difference else None
  snapshot.save(update_fields=["translation_metadata"])
 period.status="prepared";period.prepared_at=timezone.now();period.prepared_by=user;period.save();ConsolidationHistory.objects.create(group=group,period=period,event="PREPARED",user=user,metadata={"version":version});return period

def consolidated_trial_balance(*,group,period,user):
 require_group(group,user,period)
 totals=defaultdict(lambda:[None,Decimal("0"),Decimal("0")])
 latest={}
 for snapshot in period.snapshots.filter(group=group,translation_metadata__policy_version=2).order_by("organisation_id","-version","-created_at"):
  latest.setdefault(snapshot.organisation_id,snapshot)
 if set(period.snapshots.values_list("organisation_id",flat=True)) != set(latest):raise BusinessRuleError("Prepare new snapshots under the corrected translation policy before reporting.")
 for snap in latest.values():
  for line in snap.lines.select_related("consolidation_account"):t=totals[line.consolidation_account_id];t[0]=line.consolidation_account;t[1]+=line.translated_debit;t[2]+=line.translated_credit
  difference=Decimal(snap.translation_metadata.get("translation_difference","0"))
  if difference:
   account=group.accounts.get(pk=snap.translation_metadata["cta_account_id"])
   t=totals[account.id];t[0]=account;t[1]+=max(-difference,Decimal("0"));t[2]+=max(difference,Decimal("0"))
 for line in EliminationJournalLine.objects.filter(journal__group=group,journal__period=period,journal__date__gte=period.start_date,journal__date__lte=period.end_date,journal__status__in=LEDGER_EFFECTIVE_JOURNAL_STATUSES).select_related("consolidation_account"):t=totals[line.consolidation_account_id];t[0]=line.consolidation_account;t[1]+=line.debit;t[2]+=line.credit
 rows=[{"account":{"id":str(v[0].id),"code":v[0].code,"name":v[0].name,"account_type":v[0].account_type,"account_class":v[0].account_class},"debit":v[1],"credit":v[2]} for v in totals.values()];d=sum(x["debit"] for x in rows);c=sum(x["credit"] for x in rows);return {"rows":rows,"total_debit":d,"total_credit":c,"difference":d-c,"balanced":d==c}
def consolidated_profit_loss(*,group,period,user):
 require_group(group,user,period)
 rows=consolidated_trial_balance(group=group,period=period,user=user)["rows"];income=sum(x["credit"]-x["debit"] for x in rows if x["account"]["account_type"]=="revenue");expenses=sum(x["debit"]-x["credit"] for x in rows if x["account"]["account_type"]=="expense");return {"income":income,"expenses":expenses,"net_profit":income-expenses}
def consolidated_balance_sheet(*,group,period,user):
 require_group(group,user,period)
 rows=consolidated_trial_balance(group=group,period=period,user=user)["rows"];total=lambda kind:sum(x["debit"]-x["credit"] if kind=="asset" else x["credit"]-x["debit"] for x in rows if x["account"]["account_type"]==kind);a=total("asset");l=total("liability");e=total("equity")+consolidated_profit_loss(group=group,period=period,user=user)["net_profit"];return {"assets":a,"liabilities":l,"equity":e,"difference":a-l-e,"balanced":a==l+e}

def validate_elimination_lines(*,group,lines):
 if len(lines)<2:raise BusinessRuleError("An elimination journal requires at least two lines.")
 debit=credit=Decimal("0")
 for line in lines:
  account=line.get("consolidation_account")
  if not account or account.group_id!=group.id:raise BusinessRuleError("Elimination lines must use accounts from this consolidation group.")
  line_debit=Decimal(line.get("debit",0));line_credit=Decimal(line.get("credit",0))
  if line_debit<0 or line_credit<0 or (line_debit and line_credit) or (not line_debit and not line_credit):raise BusinessRuleError("Each elimination line must contain one positive debit or credit.")
  debit+=line_debit;credit+=line_credit
 if debit!=credit:raise BusinessRuleError("Elimination journal debits and credits must balance.")

@transaction.atomic
def post_elimination(*,journal,user):
 require_group(journal.group,user,journal.period)
 period=mutable_period(journal.period)
 row=EliminationJournal.objects.select_for_update().prefetch_related("lines__consolidation_account").get(pk=journal.pk)
 if not period.start_date<=row.date<=period.end_date:raise BusinessRuleError("Elimination date must be within its period.")
 if row.status!="draft":raise BusinessRuleError("Only draft elimination journals can be posted.")
 lines=[{"consolidation_account":x.consolidation_account,"debit":x.debit,"credit":x.credit} for x in row.lines.all()]
 validate_elimination_lines(group=row.group,lines=lines)
 row.status="posted";row.posted_by=user;row.posted_at=timezone.now();row.save(update_fields=["status","posted_by","posted_at"]);return row

@transaction.atomic
def reverse_elimination(*,journal,user,date=None):
 require_group(journal.group,user,journal.period)
 period=mutable_period(journal.period)
 row=EliminationJournal.objects.select_for_update().prefetch_related("lines").get(pk=journal.pk)
 if row.status!="posted" or hasattr(row,"reversal_entry"):raise BusinessRuleError("Only an unreversed posted elimination can be reversed.")
 from rest_framework import serializers
 date=serializers.DateField().run_validation(date or timezone.localdate())
 if date<row.date or not period.start_date<=date<=period.end_date:raise BusinessRuleError("Reverse within the original open period, on or after the elimination date.")
 reversal=EliminationJournal.objects.create(group=row.group,period=row.period,entry_number=f"REV-{row.entry_number}",date=date or timezone.localdate(),description=f"Reversal of {row.entry_number}",reference=row.reference,status="draft",created_by=user,reversal_of=row)
 EliminationJournalLine.objects.bulk_create([EliminationJournalLine(journal=reversal,consolidation_account=x.consolidation_account,debit=x.credit,credit=x.debit,organisation=x.organisation,counterparty_organisation=x.counterparty_organisation,description=f"Reversal: {x.description}") for x in row.lines.all()])
 reversal=post_elimination(journal=reversal,user=user)
 row.status="reversed";row.reversed_by=user;row.reversed_at=timezone.now();row.save(update_fields=["status","reversed_by","reversed_at"]);return reversal


@transaction.atomic
def finalise_period(*,period,user):
 from apps.organisations.permissions import FINALISE_CONSOLIDATION
 from apps.organisations.services import require_organisation_permission
 period=mutable_period(period)
 require_group(period.group,user,period)
 require_organisation_permission(organisation=period.group.parent_organisation,user=user,permission=FINALISE_CONSOLIDATION)
 if period.status!="prepared":raise BusinessRuleError("Prepare the period before finalising it.")
 if not consolidated_trial_balance(group=period.group,period=period,user=user)["balanced"]:raise BusinessRuleError("Consolidated trial balance is not balanced.")
 period.status="finalised";period.finalised_by=user;period.finalised_at=timezone.now();period.save()
 ConsolidationHistory.objects.create(group=period.group,period=period,event="FINALISED",user=user)
 return period

@transaction.atomic
def reopen_period(*,period,user,reason):
 from apps.organisations.permissions import FINALISE_CONSOLIDATION
 from apps.organisations.services import require_organisation_permission
 period=ConsolidationPeriod.objects.select_for_update().get(pk=period.pk)
 require_group(period.group,user,period)
 require_organisation_permission(organisation=period.group.parent_organisation,user=user,permission=FINALISE_CONSOLIDATION)
 if not isinstance(reason,str) or not reason.strip():raise BusinessRuleError("An authorised reopen reason is required.")
 if period.status!="finalised":raise BusinessRuleError("Only a finalised period can be reopened.")
 ConsolidationHistory.objects.create(group=period.group,period=period,event="REOPENED",user=user,reason=reason.strip())
 period.status="open";period.save(update_fields=["status"])
 return period
