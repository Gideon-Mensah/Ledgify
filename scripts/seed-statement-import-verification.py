"""Run via manage.py shell on the disposable ledgify_statement_browser database only.
Creates fresh synthetic identities per run. Writes local browser fixtures, never production data.
"""
from django.conf import settings
from uuid import uuid4
import os
if settings.DATABASES['default']['NAME'] != 'ledgify_statement_browser' or settings.DATABASES['default']['HOST'] not in {'localhost','127.0.0.1'}:
    raise RuntimeError('Only the local ledgify_statement_browser verification database is allowed.')
import json
from pathlib import Path
from datetime import date
from django.contrib.auth import get_user_model
from apps.accounts.serializers import SessionTokenObtainPairSerializer
from common.accounting_test_fixtures import calendar_periods
from apps.organisations.models import Organisation,OrganisationMember
from apps.accounting.models import Account
from apps.banking.models import BankAccount
from apps.banking.test_statement_import import workbook
from apps.banking.services.imports.statement_schema import schema
out=Path(os.environ.get('STATEMENT_FIXTURES','/tmp/ledgify-statement-browser'));out.mkdir(parents=True,exist_ok=True)
identity='browser-statement-'+uuid4().hex[:12]
user=get_user_model().objects.create_user(username=identity,email=f'{identity}@example.test',password='synthetic-disposable-only')
get_user_model().objects.filter(pk=user.pk).update(is_email_verified=True)
orgs=[];banks=[]
for currency in ['GHS','GBP']:
    org=Organisation.objects.create(name=f'Synthetic import review {currency}',base_currency=currency,created_by=user)
    OrganisationMember.objects.create(organisation=org,user=user,role='owner');calendar_periods(org)
    orgs.append({'id':str(org.id),'name':org.name,'base_currency':currency,'role':'owner'})
    for index in range(2):
        ledger=Account.objects.create(organisation=org,code=f'11{index}0',name=f'{currency} bank ledger {index}',account_type='asset',account_class='bank',currency=currency,created_by=user)
        bank=BankAccount.objects.create(organisation=org,ledger_account=ledger,name=f'{currency} Current Account {index+1}',bank_name='Synthetic bank',currency=currency,created_by=user)
        banks.append({'id':str(bank.id),'organisation':str(org.id),'currency':currency,'name':bank.name})
refresh=SessionTokenObtainPairSerializer.get_token(user)
(out/'fixture.json').touch(mode=0o600, exist_ok=True)
os.chmod(out/'fixture.json',0o600)
(out/'fixture.json').write_text(json.dumps({'accessToken':str(refresh.access_token),'refreshToken':str(refresh),'user':{'id':str(user.id),'email':user.email,'is_email_verified':True},'organisations':orgs,'selectedOrganisation':orgs[0],'banks':banks,'schema':schema()}))
(out/'statement.csv').write_text('Posting Date,Narrative,Payment Reference,Credit,Debit,Balance,CCY,Transaction ID\n2026-09-22,Opening Balance,,,,32500,,\n23/09/2026,Accra Business Solutions Ltd,ABS-PO-001,5000,,37500,,X1\n23/09/2026,Accra Business Solutions Ltd,ABS-PO-001,5000,,37500,,X1\n09/10/2026,Ambiguous date,DATE,12,,,,X2\n2026-09-23,Wrong currency,FX,5,,,USD,X3\n2026-09-23,Bad amount,BAD,NaN,,,,X4\n2026-09-23,Closing Balance,,,,37500,,\n')
(out/'amount.csv').write_text('Date,Description,Amount\n2026-09-23,Receipt,10.21\n2026-09-23,Fee,-0.21\n')
(out/'large.csv').write_text('Date,Description,Credit\n'+''.join(f'2026-09-23,Receipt {i},5.00\n' for i in range(205)))
(out/'statement.xlsx').write_bytes(workbook([['Date','Description','Amount','Transaction Type'],['2026-09-23','Receipt','123.45','CR']]))
print('Synthetic browser fixtures ready; credentials stored locally, not printed.')
