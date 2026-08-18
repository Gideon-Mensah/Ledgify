from rest_framework.routers import DefaultRouter
from apps.payroll.views import EmployeeViewSet,PayrollComponentViewSet,PayrollReportViewSet,PayrollRunViewSet,PayslipViewSet
router=DefaultRouter();router.register("employees",EmployeeViewSet,basename="employee");router.register("payroll-components",PayrollComponentViewSet,basename="payroll-component");router.register("payroll-runs",PayrollRunViewSet,basename="payroll-run");router.register("payslips",PayslipViewSet,basename="payslip");router.register("payroll-reports",PayrollReportViewSet,basename="payroll-report");urlpatterns=router.urls
