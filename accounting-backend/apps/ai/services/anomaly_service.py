"""Detect deterministic financial exceptions for review without changing records."""

from decimal import Decimal
from django.db.models import Avg,Count
from apps.ai.models import FinancialAnomaly
from apps.purchases.models import Bill
from apps.accounting.models import JournalEntry, LEDGER_EFFECTIVE_JOURNAL_STATUSES
def detect_anomalies(*,organisation):
 created=[];bills=Bill.objects.filter(organisation=organisation).exclude(status="void")
 for row in bills.values("supplier_id","supplier_reference","total").annotate(count=Count("id")).filter(count__gt=1):
  anomaly,_=FinancialAnomaly.objects.get_or_create(organisation=organisation,anomaly_type="duplicate_bill",source_type="supplier",source_id=str(row["supplier_id"]),status="open",defaults={"severity":"high","score":Decimal("85"),"summary":"Potential duplicate supplier bills","details":{"supplier_reference":row["supplier_reference"],"amount":str(row["total"]),"count":row["count"],"reasons":["same supplier","same reference","same amount"]}});created.append(anomaly)
 average=JournalEntry.objects.filter(organisation=organisation,status__in=LEDGER_EFFECTIVE_JOURNAL_STATUSES).annotate(value=__import__("django.db.models",fromlist=["Sum"]).Sum("lines__debit")).aggregate(avg=Avg("value"))["avg"] or 0
 if average:
  for journal in JournalEntry.objects.filter(organisation=organisation,status__in=LEDGER_EFFECTIVE_JOURNAL_STATUSES,source_type="manual").annotate(value=__import__("django.db.models",fromlist=["Sum"]).Sum("lines__debit")).filter(value__gte=average*3):
   anomaly,_=FinancialAnomaly.objects.get_or_create(organisation=organisation,anomaly_type="large_manual_journal",source_type="journal",source_id=str(journal.id),defaults={"severity":"medium","status":"open","score":Decimal("70"),"summary":f"Large manual journal {journal.entry_number}","details":{"amount":str(journal.value),"comparison":"at least 3x posted-journal average"}});created.append(anomaly)
 return created
