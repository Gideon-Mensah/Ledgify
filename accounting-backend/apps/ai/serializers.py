"""Validate AI questions and proposals without accepting direct accounting mutations."""

from rest_framework import serializers
from .models import AIActionAudit,AIConversation,AIMessage,AISettings,FinancialAnomaly
from .services.knowledge_service import safe_page_context
class MessageSerializer(serializers.ModelSerializer):
 class Meta:model=AIMessage;fields="__all__";read_only_fields=fields
class ConversationSerializer(serializers.ModelSerializer):
 messages=MessageSerializer(many=True,read_only=True)
 class Meta:model=AIConversation;exclude=["organisation","user"];read_only_fields=["id","created_at","updated_at"]
class ChatSerializer(serializers.Serializer):
 conversation_id=serializers.UUIDField(required=False);question=serializers.CharField(max_length=4000,trim_whitespace=True);parameters=serializers.JSONField(required=False,default=dict);page_context=serializers.JSONField(required=False,default=dict)
 def validate_page_context(self,value):return safe_page_context(value)
class JournalProposalSerializer(serializers.Serializer):
 conversation_id=serializers.UUIDField(required=False);requested_action=serializers.CharField(max_length=1000);date=serializers.DateField(required=False);description=serializers.CharField(max_length=255);reference=serializers.CharField(required=False,allow_blank=True);lines=serializers.ListField(child=serializers.DictField(),min_length=2)
class ActionSerializer(serializers.ModelSerializer):
 class Meta:model=AIActionAudit;fields="__all__";read_only_fields=fields
class AnomalySerializer(serializers.ModelSerializer):
 class Meta:model=FinancialAnomaly;fields="__all__";read_only_fields=fields
class ReviewSerializer(serializers.Serializer):status=serializers.ChoiceField(choices=["reviewed","dismissed","resolved"])
class AISettingsSerializer(serializers.ModelSerializer):
 class Meta:model=AISettings;exclude=["organisation"]
