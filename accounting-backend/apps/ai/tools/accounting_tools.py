"""Expose organisation-scoped financial statements to the AI as read-only context."""

from apps.accounting.services.reports import balance_sheet,cash_flow,profit_loss,trial_balance
def financial_report(*,organisation,intent,parameters):
 start=parameters.get("start_date");end=parameters.get("end_date");as_of=parameters.get("as_of_date") or end
 if intent=="cash_flow_analysis":return "cash_flow",cash_flow(organisation=organisation,start_date=start,end_date=end)
 if "balance" in parameters.get("question","").lower():return "balance_sheet",balance_sheet(organisation=organisation,as_of_date=as_of)
 return "profit_loss",profit_loss(organisation=organisation,start_date=start,end_date=end)
def trial_balance_tool(*,organisation,as_of_date=None):return trial_balance(organisation=organisation,as_of_date=as_of_date)
