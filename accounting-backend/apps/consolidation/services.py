"""Map, translate, combine, and eliminate group balances for supported consolidations."""

from collections import defaultdict
from decimal import Decimal
from django.db import transaction
from django.db import models
from django.db.models import Sum
from django.utils import timezone
from common.exceptions import BusinessRuleError
from apps.accounting.models import JournalLine, LEDGER_EFFECTIVE_JOURNAL_STATUSES
from apps.fx.services import convert_amount,get_effective_rate
from .models import *
@transaction.atomic
def prepare_consolidation(*,group,period,user):
 if period.group_id!=group.id or period.status=="finalised":raise BusinessRuleError("Invalid or finalised consolidation period.")
 version=(period.snapshots.aggregate(v=models.Max("version"))["v"] or 0)+1
 members=group.members.filter(status="active",effective_from__lte=period.end_date).filter(models.Q(effective_to=None)|models.Q(effective_to__gte=period.start_date))
 for member in members:
  if member.consolidation_method!="full" or member.ownership_percentage!=100:raise BusinessRuleError("Production consolidation currently requires FULL method and 100% ownership.")
  balances=JournalLine.objects.filter(journal_entry__organisation=member.organisation,journal_entry__status__in=LEDGER_EFFECTIVE_JOURNAL_STATUSES,journal_entry__date__lte=period.end_date).values("account_id","account__account_type").annotate(debit=Sum("debit"),credit=Sum("credit"))
  mappings={x.source_account_id:x for x in group.mappings.filter(organisation=member.organisation,effective_from__lte=period.end_date).filter(models.Q(effective_to=None)|models.Q(effective_to__gte=period.end_date))}
  missing=[x["account_id"] for x in balances if x["account_id"] not in mappings and x["debit"]!=x["credit"]]
  if missing:raise BusinessRuleError(f"Unmapped material accounts: {', '.join(map(str,missing))}")
  snapshot=ConsolidationSnapshot.objects.create(group=group,period=period,organisation=member.organisation,source_currency=member.organisation.base_currency,reporting_currency=group.reporting_currency_id,version=version,translation_metadata={"policy":"income/expense average; balance sheet closing"})
  closing=get_effective_rate(organisation=member.organisation,base_currency=member.organisation.base_currency,target_currency=group.reporting_currency_id,date=period.end_date)
  for row in balances:
   if row["account_id"] not in mappings:continue
   method="average" if row["account__account_type"] in {"revenue","expense"} else "closing";rate=closing
   ConsolidationSnapshotLine.objects.create(snapshot=snapshot,source_account_id=row["account_id"],consolidation_account=mappings[row["account_id"]].consolidation_account,source_debit=row["debit"],source_credit=row["credit"],translated_debit=convert_amount(amount=row["debit"],rate=rate),translated_credit=convert_amount(amount=row["credit"],rate=rate),exchange_rate=rate,translation_method=method)
 period.status="prepared";period.prepared_at=timezone.now();period.prepared_by=user;period.save();ConsolidationHistory.objects.create(group=group,period=period,event="PREPARED",user=user,metadata={"version":version});return period
def consolidated_trial_balance(*,group,period):
 totals=defaultdict(lambda:[None,Decimal("0"),Decimal("0")])
 latest={x.organisation_id:x for x in period.snapshots.order_by("organisation_id","-version")}
 for snap in latest.values():
  for line in snap.lines.select_related("consolidation_account"):t=totals[line.consolidation_account_id];t[0]=line.consolidation_account;t[1]+=line.translated_debit;t[2]+=line.translated_credit
 for line in EliminationJournalLine.objects.filter(journal__period=period,journal__status="posted").select_related("consolidation_account"):t=totals[line.consolidation_account_id];t[0]=line.consolidation_account;t[1]+=line.debit;t[2]+=line.credit
 rows=[{"account":{"id":str(v[0].id),"code":v[0].code,"name":v[0].name,"account_type":v[0].account_type,"account_class":v[0].account_class},"debit":v[1],"credit":v[2]} for v in totals.values()];d=sum(x["debit"] for x in rows);c=sum(x["credit"] for x in rows);return {"rows":rows,"total_debit":d,"total_credit":c,"difference":d-c,"balanced":d==c}
def consolidated_profit_loss(*,group,period):
 rows=consolidated_trial_balance(group=group,period=period)["rows"];income=sum(x["credit"]-x["debit"] for x in rows if x["account"]["account_type"]=="revenue");expenses=sum(x["debit"]-x["credit"] for x in rows if x["account"]["account_type"]=="expense");return {"income":income,"expenses":expenses,"net_profit":income-expenses}
def consolidated_balance_sheet(*,group,period):
 rows=consolidated_trial_balance(group=group,period=period)["rows"];total=lambda kind:sum(x["debit"]-x["credit"] if kind=="asset" else x["credit"]-x["debit"] for x in rows if x["account"]["account_type"]==kind);a=total("asset");l=total("liability");e=total("equity")+consolidated_profit_loss(group=group,period=period)["net_profit"];return {"assets":a,"liabilities":l,"equity":e,"difference":a-l-e,"balanced":a==l+e}

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
 row=EliminationJournal.objects.select_for_update().prefetch_related("lines__consolidation_account").get(pk=journal.pk)
 if row.status!="draft":raise BusinessRuleError("Only draft elimination journals can be posted.")
 lines=[{"consolidation_account":x.consolidation_account,"debit":x.debit,"credit":x.credit} for x in row.lines.all()]
 validate_elimination_lines(group=row.group,lines=lines)
 row.status="posted";row.posted_by=user;row.posted_at=timezone.now();row.save(update_fields=["status","posted_by","posted_at"]);return row

@transaction.atomic
def reverse_elimination(*,journal,user,date=None):
 row=EliminationJournal.objects.select_for_update().prefetch_related("lines").get(pk=journal.pk)
 if row.status!="posted" or hasattr(row,"reversal_entry"):raise BusinessRuleError("Only an unreversed posted elimination can be reversed.")
 reversal=EliminationJournal.objects.create(group=row.group,period=row.period,entry_number=f"REV-{row.entry_number}",date=date or timezone.localdate(),description=f"Reversal of {row.entry_number}",reference=row.reference,status="posted",created_by=user,posted_by=user,posted_at=timezone.now(),reversal_of=row)
 EliminationJournalLine.objects.bulk_create([EliminationJournalLine(journal=reversal,consolidation_account=x.consolidation_account,debit=x.credit,credit=x.debit,organisation=x.organisation,counterparty_organisation=x.counterparty_organisation,description=f"Reversal: {x.description}") for x in row.lines.all()])
 row.status="reversed";row.reversed_by=user;row.reversed_at=timezone.now();row.save(update_fields=["status","reversed_by","reversed_at"]);return reversal
