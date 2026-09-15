"""Read-only compatibility audit; never backfills or recalculates posted history."""
import json
from datetime import date
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q
from apps.organisations.models import Organisation
from apps.tax.models import TaxRate, TaxAccountMapping, TaxApplicabilityRule, DocumentTaxSnapshot, TaxCode
from apps.tax.returns import vat_workpaper


class Command(BaseCommand):
    help='Read-only tax migration audit. Exit nonzero with --strict when review is needed.'
    def add_arguments(self,parser):
        parser.add_argument('--organisation');parser.add_argument('--strict',action='store_true')
    def handle(self,*args,**options):
        organisations=Organisation.objects.all()
        if options['organisation']:organisations=organisations.filter(pk=options['organisation'])
        results=[]
        from apps.sales.models import Invoice,CustomerCreditNote
        from apps.purchases.models import Bill,SupplierCredit
        for org in organisations:
            findings=[]
            if not org.tax_structure_type:findings.append({'code':'MISSING_STRUCTURE','count':1})
            rates=TaxRate.objects.filter(organisation=org)
            for rate in rates:
                for field in ['input_tax_account','output_tax_account']:
                    account=getattr(rate,field)
                    needed=field=='output_tax_account' and rate.scope in {'SALES','BOTH'} or field=='input_tax_account' and rate.scope in {'PURCHASES','BOTH'} and rate.recoverable
                    if needed and rate.rate and (not account or account.organisation_id!=org.id):findings.append({'code':'MISSING_OR_FOREIGN_CONTROL','rate':str(rate.pk),'field':field})
                if org.country_code=='GH' and rate.status=='ACTIVE' and not TaxAccountMapping.objects.filter(legacy_rate=rate).exists():
                    if rate.rate not in [0,15,2.5]:findings.append({'code':'GHANA_LEGACY_RATE_REVIEW','rate':str(rate.pk),'rate_percent':str(rate.rate)})
                    if 'flat' in (rate.name+' '+rate.code).lower() and (not rate.effective_to or rate.effective_to>=date(2026,1,1)):
                        findings.append({'code':'FLAT_RATE_AFTER_2025','rate':str(rate.pk)})
                if rate.code.startswith('GHS-') and TaxCode.objects.filter(organisation=org,code=rate.code,statutory=True).exists():
                    findings.append({'code':'LEGACY_STATUTORY_CODE_CONFLICT','rate':str(rate.pk)})
            missing=0
            for kind,model in [('invoice',Invoice),('bill',Bill),('customer_credit',CustomerCreditNote),('supplier_credit',SupplierCredit)]:
                missing+=model.objects.filter(organisation=org,accounting_journal__isnull=False).exclude(id__in=DocumentTaxSnapshot.objects.filter(organisation=org,source_type=kind).values('source_id')).count()
            if missing:findings.append({'code':'POSTED_DOCUMENTS_WITHOUT_SNAPSHOT','count':missing})
            windows=list(TaxApplicabilityRule.objects.filter(organisation=org).order_by('code_id','start'))
            for previous,current in zip(windows,windows[1:]):
                if previous.code_id==current.code_id and (not previous.end or previous.end>=current.start):findings.append({'code':'OVERLAPPING_VERSIONS','version':str(current.version_id)})
            try:
                report=vat_workpaper(org,date(1900,1,1),date(9999,12,31))
                if report['difference']:findings.append({'code':'REGISTER_LEDGER_DIFFERENCE','difference':str(report['difference'])})
            except Exception as error:
                findings.append({'code':'RECONCILIATION_REVIEW_REQUIRED','error_type':type(error).__name__})
            results.append({'organisation':str(org.pk),'findings':findings})
        self.stdout.write(json.dumps({'read_only':True,'organisations':results},indent=2))
        if options['strict'] and any(row['findings'] for row in results):raise CommandError('Tax migration review required; no records were changed.')
