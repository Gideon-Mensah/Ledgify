from decimal import Decimal
from django.core.management.base import BaseCommand,CommandError
from django.db.models import Sum
from apps.accounting.models import Account,JournalLine,LEDGER_EFFECTIVE_JOURNAL_STATUSES
from apps.accounting.services.reports import balance_sheet,trial_balance
from apps.finance.services import customer_balance_summary,supplier_balance_summary
from apps.fixed_assets.models import FixedAsset
from apps.inventory.models import Product
from apps.inventory.services.valuation import get_inventory_valuation
from apps.manufacturing.models import ProductionOrder
from apps.manufacturing.services import get_current_wip
from apps.organisations.models import Organisation
from apps.payroll.models import Payslip,PayrollRun
from apps.tax.services.report_service import tax_liability
ZERO=Decimal("0")
def gl(organisation,account_ids,credit=False):
 value=JournalLine.objects.filter(journal_entry__organisation=organisation,journal_entry__status__in=LEDGER_EFFECTIVE_JOURNAL_STATUSES,account_id__in=account_ids).aggregate(d=Sum("debit"),c=Sum("credit"));debit=value["d"] or ZERO;credits=value["c"] or ZERO;return credits-debit if credit else debit-credits
class Command(BaseCommand):
 help="Read-only deployment accounting reconciliation and statement balance check."
 def record_check(self,label,difference,failures):
  if difference==ZERO:self.stdout.write(f"  PASS {label}: difference=0")
  else:self.stdout.write(self.style.ERROR(f"  FAIL {label}: difference={difference}"));failures.append(label)
 def handle(self,*args,**options):
  failures=[]
  for organisation in Organisation.objects.filter(is_active=True):
   self.stdout.write(organisation.name);tb=trial_balance(organisation=organisation);bs=balance_sheet(organisation=organisation);self.record_check("Trial Balance",tb["difference"],failures);self.record_check("Balance Sheet",bs["difference"],failures)
   ar_ids=Account.objects.filter(organisation=organisation,account_class="receivable").values_list("id",flat=True);self.record_check("AR vs GL",gl(organisation,ar_ids)-customer_balance_summary(organisation=organisation)["total_outstanding"],failures)
   ap_ids=Account.objects.filter(organisation=organisation,account_class="payable").values_list("id",flat=True);self.record_check("AP vs GL",gl(organisation,ap_ids,credit=True)-supplier_balance_summary(organisation=organisation)["total_outstanding"],failures)
   inventory_ids=Product.objects.filter(organisation=organisation,inventory_asset_account__isnull=False).values_list("inventory_asset_account_id",flat=True).distinct();self.record_check("Inventory vs GL",gl(organisation,inventory_ids)-get_inventory_valuation(organisation=organisation)["value"],failures)
   tax=tax_liability(organisation=organisation);self.record_check("Tax vs GL",tax["reconciliation_difference"],failures)
   assets=FixedAsset.objects.filter(organisation=organisation).exclude(status="draft");asset_ids=assets.values_list("asset_account_id",flat=True);accum_ids=assets.values_list("accumulated_depreciation_account_id",flat=True);self.record_check("Fixed Assets vs GL",(gl(organisation,asset_ids)-gl(organisation,accum_ids,credit=True))-sum((item.net_book_value for item in assets),ZERO),failures)
   runs=PayrollRun.objects.filter(organisation=organisation);payroll_ids=runs.values_list("payroll_liability_account_id",flat=True);payroll_due=Payslip.objects.filter(pay_run__organisation=organisation).aggregate(net=Sum("net_pay"),paid=Sum("amount_paid"));self.record_check("Payroll vs GL",gl(organisation,payroll_ids,credit=True)-((payroll_due["net"] or ZERO)-(payroll_due["paid"] or ZERO)),failures)
   orders=ProductionOrder.objects.filter(organisation=organisation).exclude(status__in=["closed","cancelled"]);wip_ids=orders.values_list("wip_account_id",flat=True);wip=sum((get_current_wip(organisation=organisation,production_order=order) for order in orders),ZERO);self.record_check("WIP vs GL",gl(organisation,wip_ids)-wip,failures)
  if failures:raise CommandError("Accounting health failures: "+", ".join(failures))
  self.stdout.write(self.style.SUCCESS("Accounting health check passed."))
