"""Validate payroll inputs while protecting calculated and posted pay values."""

from decimal import Decimal
from rest_framework import serializers
from apps.payroll.models import Employee,EmployeePayrollComponent,PayrollComponent,PayrollPayment,PayrollRun,Payslip,PayslipLine

class EmployeePayrollComponentSerializer(serializers.ModelSerializer):
    class Meta:model=EmployeePayrollComponent;fields="__all__";read_only_fields=["id","employee"]
class EmployeeSerializer(serializers.ModelSerializer):
    full_name=serializers.CharField(read_only=True);pay_components=EmployeePayrollComponentSerializer(many=True,read_only=True)
    class Meta:model=Employee;exclude=["organisation"];read_only_fields=["id","created_at","updated_at"]
class PayrollComponentSerializer(serializers.ModelSerializer):
    class Meta:model=PayrollComponent;exclude=["organisation"];read_only_fields=["id","created_at","updated_at"]
class PayslipLineSerializer(serializers.ModelSerializer):
    class Meta:model=PayslipLine;fields="__all__";read_only_fields=fields
class PayslipSerializer(serializers.ModelSerializer):
    employee_name=serializers.CharField(source="employee.full_name",read_only=True);lines=PayslipLineSerializer(many=True,read_only=True)
    class Meta:model=Payslip;fields="__all__";read_only_fields=fields
class PayrollRunSerializer(serializers.ModelSerializer):
    payslips=PayslipSerializer(many=True,read_only=True)
    class Meta:model=PayrollRun;exclude=["organisation","created_by"];read_only_fields=["id","status","approved_by","processed_at","created_at","updated_at"]
    def validate(self,attrs):
        if attrs.get("pay_period_end") and attrs.get("pay_period_start") and attrs["pay_period_end"]<attrs["pay_period_start"]:raise serializers.ValidationError("Pay period end cannot precede start.")
        return attrs
class AssignComponentSerializer(serializers.Serializer):
    component_id=serializers.UUIDField();amount=serializers.DecimalField(max_digits=18,decimal_places=2,min_value=0,default=0);quantity=serializers.DecimalField(max_digits=18,decimal_places=4,min_value=0,default=1);rate=serializers.DecimalField(max_digits=18,decimal_places=4,min_value=0,default=0);active=serializers.BooleanField(default=True)
class PayrollPaymentSerializer(serializers.ModelSerializer):
    class Meta:model=PayrollPayment;fields="__all__";read_only_fields=fields
class PayRunPaymentSerializer(serializers.Serializer):
    bank_account_id=serializers.UUIDField();payment_date=serializers.DateField();amount=serializers.DecimalField(max_digits=18,decimal_places=2,min_value=Decimal("0.01"))
class PayrollReportQuerySerializer(serializers.Serializer):
    start_date=serializers.DateField(required=False);end_date=serializers.DateField(required=False);year=serializers.IntegerField(required=False,min_value=1900,max_value=9999)
