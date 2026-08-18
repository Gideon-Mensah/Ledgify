"""Answer with approved context and keep accounting changes outside AI text generation."""

from apps.ai.models import AIMessage
from .context_service import get_ai_context
from .intent_service import classify_intent
from .provider import get_provider,provider_status

def _deterministic_answer(context):
 intent=context["intent"];data=context["data"]
 if intent=="financial_explanation":
  if "net_profit" in data:return f"Net profit for the selected period is {data['net_profit']}. Revenue is {data.get('total_income',0)} and expenses are {data.get('total_expenses',0)}."
  if "assets" in data:return f"The Balance Sheet reports assets of {data.get('total_assets',data.get('assets'))}, liabilities of {data.get('total_liabilities',data.get('liabilities'))}, and equity of {data.get('total_equity',data.get('equity'))}."
 if intent=="customer_analysis":return f"Outstanding receivables total {data.get('total_outstanding',0)} across {len(data.get('customers',[]))} customer balances."
 if intent=="supplier_analysis":return f"Outstanding payables total {data.get('total_outstanding',0)} across {len(data.get('suppliers',[]))} supplier balances."
 if intent=="inventory_analysis":return f"There are {len(data.get('reorder',[]))} products at or below reorder level."
 if intent=="manufacturing_analysis":return f"Manufacturing data shows {len(data.get('shortages',[]))} material shortage items."
 if intent=="navigation_help":return "Use the supplied Ledgify route in the source references."
 return "I can analyse financial reports, receivables, payables, inventory, manufacturing, and Ledgify navigation. Please make the period or subject more specific."
def ask_assistant(*,conversation,question,parameters=None):
 AIMessage.objects.create(conversation=conversation,role="user",content=question);intent=classify_intent(question);context=get_ai_context(organisation=conversation.organisation,user=conversation.user,intent=intent,parameters={**(parameters or {}),"question":question});provider=get_provider();answer=provider.generate(messages=list(conversation.messages.values("role","content")),context=context) or _deterministic_answer(context);metadata={"intent":intent,"sources":context["citations"],"confidence":"high" if context["citations"] else "limited","limitations":context["limitations"],"data_as_of":context["data_as_of"],"provider":provider_status()};message=AIMessage.objects.create(conversation=conversation,role="assistant",content=str(answer)[:10000],metadata=metadata);return message
