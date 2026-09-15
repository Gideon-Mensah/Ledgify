"""Explicit synthetic fixture creation for local tax browser verification only."""
import os,sys,json
from types import SimpleNamespace
sys.path.insert(0,os.path.abspath('accounting-backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings')
import django
django.setup()
from django.conf import settings
from apps.organisations.models import Organisation
connection=settings.DATABASES['default']
if connection['NAME']!='ledgify_tax' or connection.get('HOST')!='127.0.0.1':
    raise SystemExit('Refusing to seed: use only a disposable ledgify_tax database on 127.0.0.1.')
if Organisation.objects.exists():
    raise SystemExit('Refusing to seed a nonempty database. Preserve existing data and use a new disposable cluster.')
from apps.tax.test_jurisdictions import JurisdictionIntegrationTests
from apps.tax.configuration import create_profile,review_profile,activate_profile
from apps.organisations.models import Organisation,OrganisationMember
from apps.organisations.serializers import OrganisationSerializer
from apps.sales.services.invoices import approve_invoice
from rest_framework_simplejwt.tokens import RefreshToken
from datetime import date
f=JurisdictionIntegrationTests();f.setUp()
f.customer.email='synthetic@example.invalid';f.customer.save(update_fields=['email'])
invoice=approve_invoice(invoice=f.invoice(),user=f.user)
fixtures=[{'organisation':OrganisationSerializer(f.org,context={'request':SimpleNamespace(user=f.user)}).data,'customer':str(f.customer.pk),'revenue':str(f.revenue.pk),'bank':str(f.bank.pk),'code':str(f.sales.pk),'invoice':str(invoice.pk)}]
for name,country,currency,structure in [('Bristol tax browser','GB','GBP','CUSTOM_INTERNATIONAL'),('Accra no tax browser','GH','GHS','NO_TAX')]:
    org=Organisation.objects.create(name=name,country_code=country,base_currency=currency,created_by=f.user)
    OrganisationMember.objects.create(organisation=org,user=f.user,role='owner')
    p=create_profile(organisation=org,user=f.user,structure=structure,jurisdiction=country,effective_from=date(2026,1,1),registration={'vat_registered':False},mappings={},reason='Synthetic browser setup',separate_approval=False)
    p=review_profile(organisation=org,user=f.user,profile=p);activate_profile(organisation=org,user=f.user,profile=p,confirmed=True)
    org.refresh_from_db();fixtures.append({'organisation':OrganisationSerializer(org,context={'request':SimpleNamespace(user=f.user)}).data})
token=RefreshToken.for_user(f.user);token['auth_version']=f.user.auth_version
path='/tmp/ledgify-tax-browser-fixture.json'
with open(path,'w') as file:json.dump({'accessToken':str(token.access_token),'refreshToken':str(token),'fixtures':fixtures},file,default=str)
os.chmod(path,0o600)
print('Created three synthetic organisations and a posted common-base tax invoice. Private browser tokens saved without displaying them.')
