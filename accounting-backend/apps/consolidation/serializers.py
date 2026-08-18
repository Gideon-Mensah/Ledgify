"""Validate group relationships without allowing cross-organisation mapping leakage."""

from rest_framework import serializers
from django.db.models import Q
from .models import *
class GroupSerializer(serializers.ModelSerializer):
 class Meta:model=ConsolidationGroup;exclude=["created_by"];read_only_fields=["id","parent_organisation","created_at","updated_at"]
class MemberSerializer(serializers.ModelSerializer):
 class Meta:model=ConsolidationGroupMember;fields="__all__";read_only_fields=["id","created_at"]
 def validate(self,data):
  method=data.get("consolidation_method",getattr(self.instance,"consolidation_method","full"));ownership=data.get("ownership_percentage",getattr(self.instance,"ownership_percentage",100));start=data.get("effective_from",getattr(self.instance,"effective_from",None));end=data.get("effective_to",getattr(self.instance,"effective_to",None))
  if method!="full" or ownership!=100:raise serializers.ValidationError("Only FULL consolidation with 100% ownership is supported.")
  if start and end and end<start:raise serializers.ValidationError("Effective-to must be on or after effective-from.")
  return data
class AccountSerializer(serializers.ModelSerializer):
 class Meta:model=ConsolidationAccount;fields="__all__"
class MappingSerializer(serializers.ModelSerializer):
 class Meta:model=ConsolidationAccountMapping;fields="__all__"
 def validate(self,data):
  group=data.get("group",getattr(self.instance,"group",None));organisation=data.get("organisation",getattr(self.instance,"organisation",None));source=data.get("source_account",getattr(self.instance,"source_account",None));target=data.get("consolidation_account",getattr(self.instance,"consolidation_account",None));start=data.get("effective_from",getattr(self.instance,"effective_from",None));end=data.get("effective_to",getattr(self.instance,"effective_to",None))
  if not group.members.filter(organisation=organisation,status="active").exists():raise serializers.ValidationError("Source organisation is not an active group member.")
  if source.organisation_id!=organisation.id:raise serializers.ValidationError("Source account belongs to another organisation.")
  if target.group_id!=group.id:raise serializers.ValidationError("Group account belongs to another consolidation group.")
  conflicts=ConsolidationAccountMapping.objects.filter(group=group,source_account=source).exclude(pk=getattr(self.instance,"pk",None)).filter(Q(effective_to=None)|Q(effective_to__gte=start))
  if end:conflicts=conflicts.filter(effective_from__lte=end)
  if conflicts.exists():raise serializers.ValidationError("An overlapping mapping already exists for this source account.")
  return data
class PeriodSerializer(serializers.ModelSerializer):
 class Meta:model=ConsolidationPeriod;fields="__all__";read_only_fields=["status","prepared_at","prepared_by","finalised_at","finalised_by"]
class EliminationLineSerializer(serializers.ModelSerializer):
 class Meta:model=EliminationJournalLine;exclude=["journal"]
class EliminationSerializer(serializers.ModelSerializer):
 lines=EliminationLineSerializer(many=True,required=False)
 class Meta:model=EliminationJournal;exclude=["created_by","posted_by","posted_at"]
