"""Organisation-scoped AI endpoints with permission, context, and audit safeguards."""

from django.conf import settings
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet,ReadOnlyModelViewSet,ViewSet
from common.exceptions import BusinessRuleError
from common.permissions import OrganisationActionPermission
from common.views import OrganisationScopedViewSetMixin
from apps.organisations.permissions import USE_AI_ASSISTANT,VIEW_AI_INSIGHTS,USE_AI_ACTIONS,APPROVE_AI_ACTIONS,MANAGE_AI_SETTINGS
from .models import AIActionAudit,AIConversation,AISettings,FinancialAnomaly
from .permissions import AIEnabledPermission
from .serializers import *
from .services import ask_assistant,detect_anomalies,execute_action,propose_journal

class AIBase(OrganisationScopedViewSetMixin):permission_classes=[AIEnabledPermission,IsAuthenticated,OrganisationActionPermission]
class ConversationViewSet(AIBase,ModelViewSet):
 serializer_class=ConversationSerializer;action_permissions={"list":USE_AI_ASSISTANT,"retrieve":USE_AI_ASSISTANT,"create":USE_AI_ASSISTANT,"update":USE_AI_ASSISTANT,"partial_update":USE_AI_ASSISTANT}
 http_method_names=["get","post","patch","head","options"]
 def get_queryset(self):return AIConversation.objects.filter(organisation=self.get_organisation(),user=self.request.user).prefetch_related("messages")
 def perform_create(self,s):s.save(organisation=self.get_organisation(),user=self.request.user)
 @action(detail=True,methods=["post"])
 def messages(self,r,pk=None):
  query=ChatSerializer(data={**r.data,"conversation_id":pk});query.is_valid(raise_exception=True);message=ask_assistant(conversation=self.get_object(),question=query.validated_data["question"],parameters=query.validated_data["parameters"],page_context=query.validated_data["page_context"]);return Response(MessageSerializer(message).data,status=201)
class ChatViewSet(AIBase,ViewSet):
 action_permissions={"create":USE_AI_ASSISTANT}
 def create(self,r):
  query=ChatSerializer(data=r.data);query.is_valid(raise_exception=True);org=self.get_organisation();allowed=int(getattr(settings,"AI_REQUESTS_PER_USER_PER_HOUR",60));recent=AIConversation.objects.filter(organisation=org,user=r.user,messages__role="user",messages__created_at__gte=timezone.now()-__import__("datetime").timedelta(hours=1)).count()
  if recent>=allowed:raise BusinessRuleError("AI request limit reached. Try again later.")
  conversation=AIConversation.objects.filter(organisation=org,user=r.user,id=query.validated_data.get("conversation_id")).first() if query.validated_data.get("conversation_id") else AIConversation.objects.create(organisation=org,user=r.user,title=query.validated_data["question"][:80]);message=ask_assistant(conversation=conversation,question=query.validated_data["question"],parameters=query.validated_data["parameters"],page_context=query.validated_data["page_context"]);return Response({"conversation":ConversationSerializer(conversation).data,"message":MessageSerializer(message).data},status=201)
class ActionViewSet(AIBase,ReadOnlyModelViewSet):
 serializer_class=ActionSerializer;action_permissions={"list":USE_AI_ACTIONS,"retrieve":USE_AI_ACTIONS,"propose_journal":USE_AI_ACTIONS,"execute":USE_AI_ACTIONS}
 def get_queryset(self):return AIActionAudit.objects.filter(organisation=self.get_organisation(),user=self.request.user)
 @action(detail=False,methods=["post"],url_path="propose-journal")
 def propose_journal(self,r):
  query=JournalProposalSerializer(data=r.data);query.is_valid(raise_exception=True);data=query.validated_data;conversation=AIConversation.objects.filter(organisation=self.get_organisation(),user=r.user,id=data.pop("conversation_id",None)).first();requested=data.pop("requested_action");row=propose_journal(organisation=self.get_organisation(),user=r.user,conversation=conversation,requested_action=requested,payload=data);return Response(self.get_serializer(row).data,status=201)
 @action(detail=True,methods=["post"])
 def execute(self,r,pk=None):return Response(self.get_serializer(execute_action(action=self.get_object(),user=r.user)).data)
class AnomalyViewSet(AIBase,ReadOnlyModelViewSet):
 serializer_class=AnomalySerializer;action_permissions={"list":VIEW_AI_INSIGHTS,"retrieve":VIEW_AI_INSIGHTS,"detect":VIEW_AI_INSIGHTS,"review":VIEW_AI_INSIGHTS}
 def get_queryset(self):return FinancialAnomaly.objects.filter(organisation=self.get_organisation())
 @action(detail=False,methods=["post"])
 def detect(self,r):detect_anomalies(organisation=self.get_organisation());return Response(self.get_serializer(self.get_queryset(),many=True).data)
 @action(detail=True,methods=["post"])
 def review(self,r,pk=None):query=ReviewSerializer(data=r.data);query.is_valid(raise_exception=True);row=self.get_object();row.status=query.validated_data["status"];row.reviewed_by=r.user;row.reviewed_at=timezone.now();row.save(update_fields=["status","reviewed_by","reviewed_at"]);return Response(self.get_serializer(row).data)
class SettingsViewSet(AIBase,ViewSet):
 action_permissions={"list":MANAGE_AI_SETTINGS,"create":MANAGE_AI_SETTINGS}
 def list(self,r):row,_=AISettings.objects.get_or_create(organisation=self.get_organisation());return Response(AISettingsSerializer(row).data)
 def create(self,r):row,_=AISettings.objects.get_or_create(organisation=self.get_organisation());query=AISettingsSerializer(row,data=r.data,partial=True);query.is_valid(raise_exception=True);query.save();return Response(query.data)
class InsightViewSet(AIBase,ViewSet):
 action_permissions={"list":VIEW_AI_INSIGHTS}
 def list(self,r):return Response({"anomalies":AnomalySerializer(FinancialAnomaly.objects.filter(organisation=self.get_organisation(),status="open"),many=True).data,"suggested_questions":["How is my business performing this month?","Who owes us the most?","What stock needs reordering?","What should I review before month-end?"]})
