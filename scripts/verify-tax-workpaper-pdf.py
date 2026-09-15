import os,sys,json
from pathlib import Path
sys.path.insert(0,os.path.abspath('accounting-backend'));os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings')
import django
django.setup()
from django.conf import settings
from django.db import transaction
assert settings.DATABASES['default']['NAME']=='ledgify_checkpoint'
from apps.tax.models import TaxReturnDraft
from apps.tax.returns import export_workpaper
from apps.sales.models import Invoice
fixture=json.loads(Path(os.environ.get('DOCUMENT_FIXTURE_FILE','/tmp/ledgify-checkpoint/doc-fixture.json')).read_text())
org=Invoice.objects.get(pk=fixture['fixtures'][0]['invoice']).organisation
with transaction.atomic():
 result=TaxReturnDraft.objects.filter(organisation=org,status__in=['REVIEWED','APPROVED','EXPORTED','FILED','PAID']).first()
 assert result
 exported=export_workpaper(organisation=org,user=org.created_by,tax_return=result,format='pdf')
 (Path(os.environ.get('DOCUMENT_ARTIFACT_DIR','/tmp/ledgify-report-final'))/'reviewed-tax-workpaper.pdf').write_bytes(exported[0])
 print('Reviewed tax PDF generated; database changes rolled back')
 transaction.set_rollback(True)
