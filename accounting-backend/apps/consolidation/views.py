"""Expose supported consolidation reports and controlled elimination workflows."""

from rest_framework.permissions import IsAuthenticated
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet,ViewSet
from common.permissions import OrganisationActionPermission
from common.exceptions import BusinessRuleError
from common.views import OrganisationScopedViewSetMixin
from apps.organisations.permissions import *
from .models import *
from .serializers import *
from .services import *
class ParentScope(OrganisationScopedViewSetMixin):
 def groups(self):return ConsolidationGroup.objects.filter(parent_organisation=self.get_organisation())
class GroupViewSet(ParentScope,ModelViewSet):
 serializer_class=GroupSerializer;permission_classes=[IsAuthenticated,OrganisationActionPermission];action_permissions={"list":VIEW_CONSOLIDATION,"retrieve":VIEW_CONSOLIDATION,"create":MANAGE_CONSOLIDATION,"update":MANAGE_CONSOLIDATION,"partial_update":MANAGE_CONSOLIDATION,"destroy":MANAGE_CONSOLIDATION}
 def get_queryset(self):return self.groups()
 def perform_create(self,s):s.save(parent_organisation=self.get_organisation(),created_by=self.request.user)
class MemberViewSet(ParentScope,ModelViewSet):
 serializer_class=MemberSerializer;permission_classes=[IsAuthenticated,OrganisationActionPermission];action_permissions={"list":VIEW_CONSOLIDATION,"retrieve":VIEW_CONSOLIDATION,"create":MANAGE_CONSOLIDATION,"update":MANAGE_CONSOLIDATION,"partial_update":MANAGE_CONSOLIDATION,"destroy":MANAGE_CONSOLIDATION}
 def get_queryset(self):return ConsolidationGroupMember.objects.filter(group__in=self.groups()).select_related("group","organisation")
 def perform_create(self,s):
  if not self.groups().filter(pk=s.validated_data["group"].pk).exists():raise BusinessRuleError("Consolidation group belongs to another organisation.")
  s.save()
class AccountViewSet(ParentScope,ModelViewSet):
 serializer_class=AccountSerializer;permission_classes=[IsAuthenticated,OrganisationActionPermission];action_permissions={"list":VIEW_CONSOLIDATION,"retrieve":VIEW_CONSOLIDATION,"create":MANAGE_CONSOLIDATION,"update":MANAGE_CONSOLIDATION,"partial_update":MANAGE_CONSOLIDATION,"destroy":MANAGE_CONSOLIDATION}
 def get_queryset(self):return ConsolidationAccount.objects.filter(group__in=self.groups())
 def perform_create(self,s):
  if not self.groups().filter(pk=s.validated_data["group"].pk).exists():raise BusinessRuleError("Consolidation group belongs to another organisation.")
  s.save()
class MappingViewSet(ParentScope,ModelViewSet):
 serializer_class=MappingSerializer;permission_classes=[IsAuthenticated,OrganisationActionPermission];action_permissions={"list":VIEW_CONSOLIDATION,"retrieve":VIEW_CONSOLIDATION,"create":MANAGE_CONSOLIDATION,"update":MANAGE_CONSOLIDATION,"partial_update":MANAGE_CONSOLIDATION,"destroy":MANAGE_CONSOLIDATION,"unmapped":VIEW_CONSOLIDATION}
 def get_queryset(self):return ConsolidationAccountMapping.objects.filter(group__in=self.groups()).select_related("organisation","source_account","consolidation_account")
 @action(detail=False,methods=["get"])
 def unmapped(self,r):
  group=self.groups().get(pk=r.query_params["group"]);mapped=group.mappings.values_list("source_account_id",flat=True);ids=group.members.filter(status="active").values_list("organisation_id",flat=True)
  return Response(list(__import__("apps.accounting.models",fromlist=["Account"]).Account.objects.filter(organisation_id__in=ids,status="active").exclude(id__in=mapped).values("id","organisation_id","code","name")))
class EliminationViewSet(ParentScope,ModelViewSet):
 serializer_class=EliminationSerializer;permission_classes=[IsAuthenticated,OrganisationActionPermission];action_permissions={"list":VIEW_CONSOLIDATION,"retrieve":VIEW_CONSOLIDATION,"create":MANAGE_CONSOLIDATION,"update":MANAGE_CONSOLIDATION,"partial_update":MANAGE_CONSOLIDATION,"destroy":MANAGE_CONSOLIDATION,"post":RUN_CONSOLIDATION,"reverse":RUN_CONSOLIDATION}
 def get_queryset(self):return EliminationJournal.objects.filter(group__in=self.groups()).prefetch_related("lines")
 def _save_lines(self,journal,lines):
  if journal.status!="draft":raise BusinessRuleError("Posted elimination journals are immutable.")
  parsed=[]
  for line in lines:
   account=ConsolidationAccount.objects.filter(group=journal.group,pk=line.get("consolidation_account")).first()
   parsed.append({**line,"consolidation_account":account})
  validate_elimination_lines(group=journal.group,lines=parsed);journal.lines.all().delete();EliminationJournalLine.objects.bulk_create([EliminationJournalLine(journal=journal,**line) for line in parsed])
 def perform_create(self,s):
  group=s.validated_data["group"];period=s.validated_data["period"];lines=s.validated_data.pop("lines",[])
  if not self.groups().filter(pk=group.pk).exists() or period.group_id!=group.id:raise BusinessRuleError("Invalid consolidation group or period.")
  journal=s.save(created_by=self.request.user);self._save_lines(journal,lines)
 def perform_update(self,s):
  if s.instance.status!="draft":raise BusinessRuleError("Posted elimination journals are immutable.")
  lines=s.validated_data.pop("lines",None);journal=s.save()
  if lines is not None:self._save_lines(journal,lines)
 def perform_destroy(self,obj):
  if obj.status!="draft":raise BusinessRuleError("Posted elimination journals are immutable.")
  obj.delete()
 @action(detail=True,methods=["post"])
 def post(self,r,pk=None):return Response(self.get_serializer(post_elimination(journal=self.get_object(),user=r.user)).data)
 @action(detail=True,methods=["post"])
 def reverse(self,r,pk=None):return Response(self.get_serializer(reverse_elimination(journal=self.get_object(),user=r.user,date=r.data.get("date"))).data,status=201)
class PeriodViewSet(ParentScope,ModelViewSet):
 serializer_class=PeriodSerializer;permission_classes=[IsAuthenticated,OrganisationActionPermission];action_permissions={"list":VIEW_CONSOLIDATION,"retrieve":VIEW_CONSOLIDATION,"create":MANAGE_CONSOLIDATION,"prepare":RUN_CONSOLIDATION,"finalise":FINALISE_CONSOLIDATION,"reopen":FINALISE_CONSOLIDATION}
 def get_queryset(self):return ConsolidationPeriod.objects.filter(group__in=self.groups())
 def perform_create(self,s):
  if not self.groups().filter(pk=s.validated_data["group"].pk).exists():raise BusinessRuleError("Consolidation group belongs to another organisation.")
  s.save()
 @action(detail=True,methods=["post"])
 def prepare(self,r,pk=None):return Response(self.get_serializer(prepare_consolidation(group=self.get_object().group,period=self.get_object(),user=r.user)).data)
 @action(detail=True,methods=["post"])
 def finalise(self,r,pk=None):
  p=self.get_object();tb=consolidated_trial_balance(group=p.group,period=p)
  if not tb["balanced"]:from common.exceptions import BusinessRuleError;raise BusinessRuleError("Consolidated trial balance is not balanced.")
  p.status="finalised";p.finalised_at=__import__("django").utils.timezone.now();p.finalised_by=r.user;p.save();ConsolidationHistory.objects.create(group=p.group,period=p,event="FINALISED",user=r.user);return Response(self.get_serializer(p).data)
class ReportViewSet(ParentScope,ViewSet):
 permission_classes=[IsAuthenticated,OrganisationActionPermission];action_permissions={"trial_balance":VIEW_CONSOLIDATION,"profit_loss":VIEW_CONSOLIDATION,"balance_sheet":VIEW_CONSOLIDATION}
 def period(self,r):return ConsolidationPeriod.objects.get(id=r.query_params["period"],group__in=self.groups())
 @action(detail=False,methods=["get"],url_path="trial-balance")
 def trial_balance(self,r):p=self.period(r);return Response(consolidated_trial_balance(group=p.group,period=p))
 @action(detail=False,methods=["get"],url_path="profit-loss")
 def profit_loss(self,r):p=self.period(r);return Response(consolidated_profit_loss(group=p.group,period=p))
 @action(detail=False,methods=["get"],url_path="balance-sheet")
 def balance_sheet(self,r):p=self.period(r);return Response(consolidated_balance_sheet(group=p.group,period=p))
