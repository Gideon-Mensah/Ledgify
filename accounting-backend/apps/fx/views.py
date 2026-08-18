"""Organisation FX endpoints delegated to dated-rate and revaluation services."""

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.viewsets import ModelViewSet,ReadOnlyModelViewSet,ViewSet
from django.db.models import Sum
from common.exceptions import BusinessRuleError
from common.permissions import OrganisationActionPermission
from common.views import OrganisationScopedViewSetMixin
from apps.accounting.models import Account,JournalEntry
from apps.organisations.permissions import MANAGE_ACCOUNTS,VIEW_ACCOUNTING
from apps.fx.models import Currency,ExchangeRate,FXRevaluation
from apps.fx.serializers import *
from apps.fx.services import revalue_bank_accounts,revalue_payables,revalue_receivables,reverse_fx_revaluation

class CurrencyViewSet(ReadOnlyModelViewSet):
    queryset=Currency.objects.filter(status="active");serializer_class=CurrencySerializer;permission_classes=[IsAuthenticated]
class ExchangeRateViewSet(OrganisationScopedViewSetMixin,ModelViewSet):
    serializer_class=ExchangeRateSerializer;permission_classes=[IsAuthenticated,OrganisationActionPermission];http_method_names=["get","post","head","options"]
    action_permissions={"list":VIEW_ACCOUNTING,"retrieve":VIEW_ACCOUNTING,"create":MANAGE_ACCOUNTS}
    def get_queryset(self):return ExchangeRate.objects.filter(organisation=self.get_organisation()).select_related("base_currency","target_currency")
    def perform_create(self,serializer):serializer.save(organisation=self.get_organisation())
class FXRevaluationViewSet(OrganisationScopedViewSetMixin,ReadOnlyModelViewSet):
    serializer_class=FXRevaluationSerializer;permission_classes=[IsAuthenticated,OrganisationActionPermission];action_permissions={"list":VIEW_ACCOUNTING,"retrieve":VIEW_ACCOUNTING,"run":MANAGE_ACCOUNTS,"reverse":MANAGE_ACCOUNTS}
    def get_queryset(self):return FXRevaluation.objects.filter(organisation=self.get_organisation()).select_related("journal","foreign_currency")
    @action(detail=False,methods=["post"])
    def run(self,request):
        query=RevaluationSerializer(data=request.data);query.is_valid(raise_exception=True);data=query.validated_data;org=self.get_organisation();kind=data.pop("revaluation_type")
        accounts=[]
        for key in ("control_account_id","gain_account_id","loss_account_id"):
            account=Account.objects.filter(organisation=org,id=data.pop(key)).first()
            if not account:raise BusinessRuleError("A revaluation account was not found.")
            accounts.append(account)
        service={"receivables":revalue_receivables,"payables":revalue_payables,"bank":revalue_bank_accounts}[kind]
        result=service(organisation=org,control_account=accounts[0],gain_account=accounts[1],loss_account=accounts[2],user=request.user,**data)
        return Response(self.get_serializer(result).data,status=201)
    @action(detail=True,methods=["post"])
    def reverse(self,request,pk=None):
        query=ReversalSerializer(data=request.data);query.is_valid(raise_exception=True)
        result=reverse_fx_revaluation(revaluation=self.get_object(),user=request.user,**query.validated_data)
        return Response(self.get_serializer(result).data)
class FXReportViewSet(OrganisationScopedViewSetMixin,ViewSet):
    permission_classes=[IsAuthenticated,OrganisationActionPermission];action_permissions={"realised":VIEW_ACCOUNTING,"unrealised":VIEW_ACCOUNTING,"exposure":VIEW_ACCOUNTING}
    @action(detail=False,methods=["get"])
    def realised(self,request):
        from apps.sales.models import CustomerPayment;from apps.purchases.models import SupplierPayment
        return Response({"customer_payments":list(CustomerPayment.objects.filter(organisation=self.get_organisation()).exclude(realised_fx_gain_loss=0).values("id","payment_date","currency","realised_fx_gain_loss")),"supplier_payments":list(SupplierPayment.objects.filter(organisation=self.get_organisation()).exclude(realised_fx_gain_loss=0).values("id","payment_date","currency","realised_fx_gain_loss"))})
    @action(detail=False,methods=["get"])
    def unrealised(self,request):return Response(FXRevaluationSerializer(FXRevaluation.objects.filter(organisation=self.get_organisation()),many=True).data)
    @action(detail=False,methods=["get"])
    def exposure(self,request):
        from apps.sales.models import Invoice;from apps.purchases.models import Bill
        base=self.get_organisation().base_currency
        return Response({"base_currency":base,"receivables":list(Invoice.objects.filter(organisation=self.get_organisation()).exclude(currency=base).values("currency").annotate(amount=Sum("total"))),"payables":list(Bill.objects.filter(organisation=self.get_organisation()).exclude(currency=base).values("currency").annotate(amount=Sum("total")))})
