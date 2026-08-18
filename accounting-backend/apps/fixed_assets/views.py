"""Expose asset lifecycle actions through the fixed-asset accounting service."""

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet, ViewSet

from common.exceptions import BusinessRuleError
from common.permissions import OrganisationActionPermission
from common.views import OrganisationScopedViewSetMixin
from apps.accounting.models import Account
from apps.fixed_assets.models import DepreciationSchedule, FixedAsset, FixedAssetCategory
from apps.fixed_assets.serializers import *
from apps.fixed_assets.services import *
from apps.organisations.permissions import MANAGE_FIXED_ASSETS, RUN_DEPRECIATION, VIEW_FIXED_ASSETS


class CategoryViewSet(OrganisationScopedViewSetMixin,ModelViewSet):
    serializer_class=FixedAssetCategorySerializer;permission_classes=[IsAuthenticated,OrganisationActionPermission]
    action_permissions={"list":VIEW_FIXED_ASSETS,"retrieve":VIEW_FIXED_ASSETS,"create":MANAGE_FIXED_ASSETS,"update":MANAGE_FIXED_ASSETS,"partial_update":MANAGE_FIXED_ASSETS,"destroy":MANAGE_FIXED_ASSETS}
    def get_queryset(self):return FixedAssetCategory.objects.filter(organisation=self.get_organisation())
    def _validate_accounts(self,values):
        for key in ("default_asset_account","default_accumulated_depreciation_account","default_depreciation_expense_account"):
            account=values.get(key)
            if account and account.organisation_id!=self.get_organisation().id:raise BusinessRuleError("Fixed asset category account belongs to another organisation.")
    def perform_create(self,serializer):self._validate_accounts(serializer.validated_data);serializer.save(organisation=self.get_organisation(),created_by=self.request.user)
    def perform_update(self,serializer):self._validate_accounts(serializer.validated_data);serializer.save()


class AssetViewSet(OrganisationScopedViewSetMixin,ModelViewSet):
    serializer_class=FixedAssetSerializer;permission_classes=[IsAuthenticated,OrganisationActionPermission]
    action_permissions={"list":VIEW_FIXED_ASSETS,"retrieve":VIEW_FIXED_ASSETS,"create":MANAGE_FIXED_ASSETS,"update":MANAGE_FIXED_ASSETS,"partial_update":MANAGE_FIXED_ASSETS,"destroy":MANAGE_FIXED_ASSETS,"activate":MANAGE_FIXED_ASSETS,"dispose":MANAGE_FIXED_ASSETS}
    def get_queryset(self):return FixedAsset.objects.filter(organisation=self.get_organisation()).select_related("asset_category","asset_account","accumulated_depreciation_account","depreciation_expense_account").prefetch_related("depreciation_schedules")
    def perform_create(self,serializer):
        values=serializer.validated_data;org=self.get_organisation()
        for obj in (values["asset_category"],values["asset_account"],values["accumulated_depreciation_account"],values["depreciation_expense_account"]):
            if obj.organisation_id!=org.id:raise BusinessRuleError("Fixed asset relationship belongs to another organisation.")
        serializer.save(organisation=org,created_by=self.request.user)
    def perform_update(self,serializer):
        if self.get_object().status!=FixedAsset.Status.DRAFT:raise BusinessRuleError("Only draft fixed assets can be edited.")
        values=serializer.validated_data;org=self.get_organisation()
        for key in ("asset_category","asset_account","accumulated_depreciation_account","depreciation_expense_account"):
            obj=values.get(key)
            if obj and obj.organisation_id!=org.id:raise BusinessRuleError("Fixed asset relationship belongs to another organisation.")
        serializer.save()
    @action(detail=True,methods=["post"])
    def activate(self,request,pk=None):
        query=ActivateAssetSerializer(data=request.data);query.is_valid(raise_exception=True);account=Account.objects.filter(organisation=self.get_organisation(),id=query.validated_data["offset_account_id"]).first()
        if not account:raise BusinessRuleError("Offset account was not found.")
        return Response(self.get_serializer(activate_asset(organisation=self.get_organisation(),asset=self.get_object(),offset_account=account,user=request.user)).data)
    @action(detail=True,methods=["post"])
    def dispose(self,request,pk=None):
        query=DisposeAssetSerializer(data=request.data);query.is_valid(raise_exception=True);data=query.validated_data;org=self.get_organisation()
        accounts=[Account.objects.filter(organisation=org,id=data.pop(key)).first() for key in ("proceeds_account_id","gain_account_id","loss_account_id")]
        if not all(accounts):raise BusinessRuleError("One or more disposal accounts were not found.")
        result=dispose_asset(organisation=org,asset=self.get_object(),proceeds_account=accounts[0],gain_account=accounts[1],loss_account=accounts[2],user=request.user,**data)
        return Response(FixedAssetDisposalSerializer(result).data,status=status.HTTP_201_CREATED)


class DepreciationViewSet(OrganisationScopedViewSetMixin,ViewSet):
    permission_classes=[IsAuthenticated,OrganisationActionPermission];action_permissions={"list":VIEW_FIXED_ASSETS,"run":RUN_DEPRECIATION}
    def list(self,request):return Response(DepreciationScheduleSerializer(depreciation_report(organisation=self.get_organisation()),many=True).data)
    @action(detail=False,methods=["post"])
    def run(self,request):
        query=RunDepreciationSerializer(data=request.data);query.is_valid(raise_exception=True);data=query.validated_data;asset=FixedAsset.objects.filter(organisation=self.get_organisation(),id=data.get("asset_id")).first() if data.get("asset_id") else None
        rows=run_depreciation(organisation=self.get_organisation(),period=data["period"],asset=asset,user=request.user)
        return Response(DepreciationScheduleSerializer(rows,many=True).data,status=status.HTTP_201_CREATED)


class ReportViewSet(OrganisationScopedViewSetMixin,ViewSet):
    permission_classes=[IsAuthenticated,OrganisationActionPermission];action_permissions={"register":VIEW_FIXED_ASSETS,"schedules":VIEW_FIXED_ASSETS,"movements":VIEW_FIXED_ASSETS,"disposals":VIEW_FIXED_ASSETS}
    @action(detail=False,methods=["get"])
    def register(self,request):return Response(fixed_asset_register(organisation=self.get_organisation()))
    @action(detail=False,methods=["get"])
    def schedules(self,request):return Response(DepreciationScheduleSerializer(depreciation_report(organisation=self.get_organisation()),many=True).data)
    @action(detail=False,methods=["get"])
    def movements(self,request):return Response([{"id":str(x.id),"date":x.date,"reference":x.reference,"description":x.description,"source_type":x.source_type} for x in asset_movements(organisation=self.get_organisation())])
    @action(detail=False,methods=["get"])
    def disposals(self,request):return Response(FixedAssetDisposalSerializer(disposal_report(organisation=self.get_organisation()),many=True).data)
