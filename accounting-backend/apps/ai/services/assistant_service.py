"""Answer with approved context and keep accounting changes outside AI text generation."""

from apps.ai.models import AIMessage
from .context_service import get_ai_context
from .intent_service import classify_intent
from .provider import ProviderUnavailable,get_provider,provider_status

def _deterministic_answer(context):
 intent=context["intent"];data=context["data"]
 if intent=="financial_explanation":
  if "net_profit" in data:return f"Net profit for the selected period is {data['net_profit']}. Revenue is {data.get('total_income',0)} and expenses are {data.get('total_expenses',0)}."
  if "assets" in data:return f"The Balance Sheet reports assets of {data.get('total_assets',data.get('assets'))}, liabilities of {data.get('total_liabilities',data.get('liabilities'))}, and equity of {data.get('total_equity',data.get('equity'))}."
 if intent=="customer_analysis":return f"Outstanding receivables total {data.get('total_outstanding',0)} across {len(data.get('customers',[]))} customer balances."
 if intent=="supplier_analysis":return f"Outstanding payables total {data.get('total_outstanding',0)} across {len(data.get('suppliers',[]))} supplier balances."
 if intent=="inventory_analysis":return f"There are {len(data.get('reorder',[]))} products at or below reorder level."
 if intent=="manufacturing_analysis":return f"Manufacturing data shows {len(data.get('shortages',[]))} material shortage items."
 if intent=="draft_journal":return "I can help prepare a manual-journal draft, but I have not created one. Please confirm the transaction date, amount and currency, the specific active bank account, and whether the credit is Owner’s Capital, Share Capital, or a Director’s Loan. After those are resolved, choose Create draft and review the balanced debit and credit lines. An authorised person must use the normal journal workflow to post it."
 if context.get("knowledge"):
  doc=context["knowledge"][0];return f"{doc['content']}\n\nOpen: {doc['title']} ({doc['route']})"
 if intent=="navigation_help":return "I could not find a confident match in the implemented Ledgify help index. Name the screen or task you are using."
 return "I can analyse financial reports, receivables, payables, inventory, manufacturing, and Ledgify navigation. Please make the period or subject more specific."
def ask_assistant(*,conversation,question,parameters=None,page_context=None):
 AIMessage.objects.create(conversation=conversation,role="user",content=question);intent=classify_intent(question);context=get_ai_context(organisation=conversation.organisation,user=conversation.user,intent=intent,parameters={**(parameters or {}),"question":question},page_context=page_context);provider=get_provider();provider_error=None
 try:answer=provider.generate(messages=list(conversation.messages.values("role","content")),context=context,user_id=conversation.user_id)
 except ProviderUnavailable as exc:provider_error=exc;answer=None
 answer=answer or _deterministic_answer(context);metadata={"intent":intent,"sources":context["citations"],"confidence":"high" if context["citations"] else "limited","limitations":context["limitations"]+(["Live AI generation was unavailable; this answer uses Ledgify's local knowledge."] if provider_error else []),"data_as_of":context["data_as_of"],"page_context":context["page_context"],"provider":provider_status(provider_error)};message=AIMessage.objects.create(conversation=conversation,role="assistant",content=str(answer)[:10000],metadata=metadata);return message
