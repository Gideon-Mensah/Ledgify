"""Collect minimal organisation-scoped facts for the AI without exposing raw databases."""

import json
from django.core.serializers.json import DjangoJSONEncoder
from django.utils import timezone
from apps.ai.tools.accounting_tools import financial_report
from apps.ai.tools.inventory_tools import inventory_context
from apps.ai.tools.manufacturing_tools import manufacturing_context
from apps.ai.tools.purchase_tools import payable_context
from apps.ai.tools.sales_tools import receivable_context
from apps.ai.tools.ratio_tools import get_financial_ratio_analysis

def safe_json(value):return json.loads(json.dumps(value,cls=DjangoJSONEncoder))
def get_ai_context(*,organisation,user,intent,parameters):
 params={**parameters,"question":parameters.get("question","")};as_of=params.get("as_of_date") or timezone.localdate();citations=[]
 if intent=="performance_analysis":
  data=get_financial_ratio_analysis(organisation=organisation,start_date=params.get("start_date"),end_date=params.get("end_date"));citations=[{"source_type":"financial_ratio_analysis","period":{"start_date":params.get("start_date"),"end_date":params.get("end_date") or str(as_of)}}]
 elif intent in {"financial_explanation","cash_flow_analysis"}:
  source,data=financial_report(organisation=organisation,intent=intent,parameters=params);citations=[{"source_type":source,"period":{"start_date":params.get("start_date"),"end_date":params.get("end_date") or str(as_of)}}]
 elif intent=="customer_analysis":data=receivable_context(organisation=organisation,as_of_date=as_of);citations=[{"source_type":"aged_receivables","period":{"as_of_date":str(as_of)}}]
 elif intent=="supplier_analysis":data=payable_context(organisation=organisation,as_of_date=as_of);citations=[{"source_type":"aged_payables","period":{"as_of_date":str(as_of)}}]
 elif intent=="inventory_analysis":data=inventory_context(organisation=organisation);citations=[{"source_type":"inventory_reports","period":{"as_of_date":str(as_of)}}]
 elif intent=="manufacturing_analysis":data=manufacturing_context(organisation=organisation);citations=[{"source_type":"manufacturing_reports","period":{"as_of_date":str(as_of)}}]
 else:data={"routes":{"supplier":"/purchases/suppliers/new","reconcile":"/banking/reconciliation","manufacturing_wip":"/manufacturing/reports","journals":"/accounting/journals","reports":"/reports"}}
 payload={"intent":intent,"data":safe_json(data),"citations":citations,"data_as_of":str(as_of),"limitations":["Insights describe available accounting data and are not legal, tax, or investment advice."]}
 encoded=json.dumps(payload);return json.loads(encoded[:getattr(__import__("django.conf",fromlist=["settings"]).settings,"AI_MAX_CONTEXT_CHARS",50000)]) if len(encoded)<=getattr(__import__("django.conf",fromlist=["settings"]).settings,"AI_MAX_CONTEXT_CHARS",50000) else {**payload,"data":{},"limitations":payload["limitations"]+["Context exceeded the configured safe size and was omitted."]}
