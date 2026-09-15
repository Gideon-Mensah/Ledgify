import os,sys,json
sys.path.insert(0,os.path.abspath('accounting-backend'));os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings')
import django
django.setup()
from django.conf import settings
assert settings.DATABASES['default']['NAME']=='ledgify_checkpoint'
from apps.accounting.models import Account
from apps.banking.models import BankAccount
from apps.sales.models import Invoice
from pathlib import Path
fixture=json.loads(Path(os.environ.get('DOCUMENT_FIXTURE_FILE','/tmp/ledgify-checkpoint/doc-fixture.json')).read_text())
org=Invoice.objects.get(pk=fixture['fixtures'][0]['invoice']).organisation
BankAccount.objects.get_or_create(organisation=org,ledger_account=Account.objects.get(organisation=org,code='1000'),defaults={'name':'Synthetic verification bank','currency':'GHS','created_by':org.created_by})
print('Disposable bank fixture ready')
