"""Route user questions to read-only tools or controlled action proposals."""

INTENTS={"profit":"financial_explanation","balance sheet":"financial_explanation","cash":"cash_flow_analysis","owes":"customer_analysis","receivable":"customer_analysis","supplier":"supplier_analysis","bill":"supplier_analysis","stock":"inventory_analysis","inventory":"inventory_analysis","production":"manufacturing_analysis","wip":"manufacturing_analysis","payroll":"payroll_analysis","tax":"tax_analysis","journal":"draft_journal","where":"navigation_help","how do i":"navigation_help","month-end":"month_end"}
def classify_intent(text):
 value=text.lower()
 if "how do i" in value or value.startswith("where "):return "navigation_help"
 for token,intent in INTENTS.items():
  if token in value:return intent
 return "unknown"
