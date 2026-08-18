"""Organisation payroll endpoints with separate processing and approval permissions."""

from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet,ReadOnlyModelViewSet,ViewSet
from common.exceptions import BusinessRuleError
from common.permissions import OrganisationActionPermission
from common.views import OrganisationScopedViewSetMixin
from apps.accounting.models import Account
from apps.organisations.permissions import APPROVE_PAYROLL,MANAGE_EMPLOYEES,PAY_PAYROLL,PROCESS_PAYROLL,VIEW_PAYROLL
from apps.payroll.models import Employee,EmployeePayrollComponent,PayrollComponent,PayrollRun,Payslip
from apps.payroll.serializers import *
from apps.payroll.services import *

class EmployeeViewSet(OrganisationScopedViewSetMixin,ModelViewSet):
    serializer_class=EmployeeSerializer;permission_classes=[IsAuthenticated,OrganisationActionPermission]
    action_permissions={"list":VIEW_PAYROLL,"retrieve":VIEW_PAYROLL,"create":MANAGE_EMPLOYEES,"update":MANAGE_EMPLOYEES,"partial_update":MANAGE_EMPLOYEES,"destroy":MANAGE_EMPLOYEES,"assign_component":MANAGE_EMPLOYEES}
    def get_queryset(self):return Employee.objects.filter(organisation=self.get_organisation()).prefetch_related("pay_components__component")
    def perform_create(self,serializer):serializer.save(organisation=self.get_organisation())
    @action(detail=True,methods=["post"],url_path="components")
    def assign_component(self,request,pk=None):
        query=AssignComponentSerializer(data=request.data);query.is_valid(raise_exception=True);data=query.validated_data
        component=PayrollComponent.objects.filter(organisation=self.get_organisation(),id=data.pop("component_id")).first()
        if not component:raise BusinessRuleError("Payroll component was not found in this organisation.")
        assignment,_=EmployeePayrollComponent.objects.update_or_create(employee=self.get_object(),component=component,defaults=data)
        return Response(EmployeePayrollComponentSerializer(assignment).data)

class PayrollComponentViewSet(OrganisationScopedViewSetMixin,ModelViewSet):
    serializer_class=PayrollComponentSerializer;permission_classes=[IsAuthenticated,OrganisationActionPermission]
    action_permissions={"list":VIEW_PAYROLL,"retrieve":VIEW_PAYROLL,"create":MANAGE_EMPLOYEES,"update":MANAGE_EMPLOYEES,"partial_update":MANAGE_EMPLOYEES,"destroy":MANAGE_EMPLOYEES}
    def get_queryset(self):return PayrollComponent.objects.filter(organisation=self.get_organisation()).select_related("default_account","liability_account")
    def _save(self,serializer):
        for account in (serializer.validated_data["default_account"],serializer.validated_data.get("liability_account")):
            if account and account.organisation_id!=self.get_organisation().id:raise BusinessRuleError("Payroll account belongs to another organisation.")
        serializer.save(organisation=self.get_organisation())
    def perform_create(self,serializer):self._save(serializer)
    def perform_update(self,serializer):
        values=serializer.validated_data
        for account in (values.get("default_account"),values.get("liability_account")):
            if account and account.organisation_id!=self.get_organisation().id:raise BusinessRuleError("Payroll account belongs to another organisation.")
        serializer.save()

class PayrollRunViewSet(OrganisationScopedViewSetMixin,ModelViewSet):
    serializer_class=PayrollRunSerializer;permission_classes=[IsAuthenticated,OrganisationActionPermission]
    action_permissions={"list":VIEW_PAYROLL,"retrieve":VIEW_PAYROLL,"create":PROCESS_PAYROLL,"update":PROCESS_PAYROLL,"partial_update":PROCESS_PAYROLL,"destroy":PROCESS_PAYROLL,"calculate":PROCESS_PAYROLL,"approve":APPROVE_PAYROLL,"post":PROCESS_PAYROLL,"pay":PAY_PAYROLL}
    def get_queryset(self):return PayrollRun.objects.filter(organisation=self.get_organisation()).select_related("payroll_liability_account").prefetch_related("payslips__employee","payslips__lines")
    def perform_create(self,serializer):
        if serializer.validated_data["payroll_liability_account"].organisation_id!=self.get_organisation().id:raise BusinessRuleError("Payroll liability account belongs to another organisation.")
        serializer.save(organisation=self.get_organisation(),created_by=self.request.user)
    def perform_update(self,serializer):
        if self.get_object().status!=PayrollRun.Status.DRAFT:raise BusinessRuleError("Only draft payroll runs can be edited.")
        account=serializer.validated_data.get("payroll_liability_account")
        if account and account.organisation_id!=self.get_organisation().id:raise BusinessRuleError("Payroll liability account belongs to another organisation.")
        serializer.save()
    @action(detail=True,methods=["post"])
    def calculate(self,request,pk=None):return Response(self.get_serializer(calculate_pay_run(pay_run=self.get_object())).data)
    @action(detail=True,methods=["post"])
    def approve(self,request,pk=None):return Response(self.get_serializer(approve_pay_run(pay_run=self.get_object(),user=request.user)).data)
    @action(detail=True,methods=["post"])
    def post(self,request,pk=None):return Response(self.get_serializer(post_pay_run(pay_run=self.get_object(),user=request.user)).data)
    @action(detail=True,methods=["post"])
    def pay(self,request,pk=None):
        query=PayRunPaymentSerializer(data=request.data);query.is_valid(raise_exception=True);data=query.validated_data
        bank=Account.objects.filter(organisation=self.get_organisation(),id=data.pop("bank_account_id")).first()
        if not bank:raise BusinessRuleError("Bank account was not found.")
        return Response(PayrollPaymentSerializer(pay_pay_run(pay_run=self.get_object(),bank_account=bank,user=request.user,**data)).data)

class PayslipViewSet(OrganisationScopedViewSetMixin,ReadOnlyModelViewSet):
    serializer_class=PayslipSerializer;permission_classes=[IsAuthenticated,OrganisationActionPermission];action_permissions={"list":VIEW_PAYROLL,"retrieve":VIEW_PAYROLL}
    def get_queryset(self):return Payslip.objects.filter(pay_run__organisation=self.get_organisation()).select_related("employee","journal").prefetch_related("lines")

class PayrollReportViewSet(OrganisationScopedViewSetMixin,ViewSet):
    permission_classes=[IsAuthenticated,OrganisationActionPermission];action_permissions={"summary":VIEW_PAYROLL,"earnings":VIEW_PAYROLL,"liability":VIEW_PAYROLL,"year_to_date":VIEW_PAYROLL,"journals":VIEW_PAYROLL}
    def query(self,request):q=PayrollReportQuerySerializer(data=request.query_params);q.is_valid(raise_exception=True);return q.validated_data
    @action(detail=False,methods=["get"])
    def summary(self,request):return Response(payroll_summary(organisation=self.get_organisation(),**{k:v for k,v in self.query(request).items() if k!="year"}))
    @action(detail=False,methods=["get"])
    def earnings(self,request):return Response(employee_earnings(organisation=self.get_organisation(),**{k:v for k,v in self.query(request).items() if k!="year"}))
    @action(detail=False,methods=["get"])
    def liability(self,request):return Response(payroll_liability(organisation=self.get_organisation(),**{k:v for k,v in self.query(request).items() if k!="year"}))
    @action(detail=False,methods=["get"],url_path="year-to-date")
    def year_to_date(self,request):return Response(year_to_date_summary(organisation=self.get_organisation(),year=self.query(request).get("year",__import__("datetime").date.today().year)))
    @action(detail=False,methods=["get"])
    def journals(self,request):return Response([{"run_id":str(x.id),"period_end":x.pay_period_end,"journals":[str(v) for v in x.payslips.exclude(journal=None).values_list("journal_id",flat=True).distinct()]} for x in self.get_runs()])
    def get_runs(self):return PayrollRun.objects.filter(organisation=self.get_organisation(),status__in=[PayrollRun.Status.POSTED,PayrollRun.Status.PAID])
