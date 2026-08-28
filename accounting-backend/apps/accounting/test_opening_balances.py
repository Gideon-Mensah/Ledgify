from datetime import date
from decimal import Decimal
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounting.models import Account,OpeningBalance,JournalEntry
from apps.accounting.services.reports import cash_flow,trial_balance,balance_sheet
from apps.organisations.models import Organisation,OrganisationMember

class OpeningBalanceWorkflowTests(TestCase):
 def setUp(self):
  self.user=get_user_model().objects.create_user(username="opening-owner",password="test");self.org=Organisation.objects.create(name="Opening Org",base_currency="GBP",created_by=self.user);OrganisationMember.objects.create(organisation=self.org,user=self.user,role="owner");self.client=APIClient();self.client.force_authenticate(self.user);self.headers={"HTTP_X_ORGANISATION_ID":str(self.org.id)}
  def account(code,name,kind,klass):return Account.objects.create(organisation=self.org,created_by=self.user,code=code,name=name,account_type=kind,account_class=klass,status="active")
  self.bank=account("1000","Bank","asset","bank");self.ar=account("1100","Receivables","asset","receivable");self.equipment=account("1500","Equipment","asset","fixed_asset");self.ap=account("2000","Payables","liability","payable");self.loan=account("2500","Loan","liability","long_term_liability");self.capital=account("3000","Owner Capital","equity","equity")
 def payload(self,balanced=True):
  lines=[(self.bank,"100000","0"),(self.ar,"20000","0"),(self.equipment,"80000","0"),(self.ap,"0","30000"),(self.loan,"0","50000"),(self.capital,"0","120000" if balanced else "110000")]
  return {"opening_date":"2026-01-31","reference":"CONVERSION","description":"Verified conversion balances","lines":[{"account_id":str(a.id),"debit":d,"credit":c} for a,d,c in lines]}
 def test_draft_submission_posting_reports_cash_and_idempotency(self):
  response=self.client.post("/api/v1/opening-balances/",self.payload(),format="json",**self.headers);self.assertEqual(response.status_code,201,response.content);record=response.json();self.assertEqual(record["totals"]["debit"],200000.0);self.assertEqual(record["totals"]["credit"],200000.0);self.assertEqual(JournalEntry.objects.count(),0)
  submitted=self.client.post(f"/api/v1/opening-balances/{record['id']}/submit/",{},format="json",**self.headers);self.assertEqual(submitted.status_code,200,submitted.content)
  posted=self.client.post(f"/api/v1/opening-balances/{record['id']}/post/",{},format="json",**self.headers);self.assertEqual(posted.status_code,200,posted.content);self.assertEqual(posted.json()["journal"]["status"],"posted");self.assertEqual(posted.json()["journal"]["source_type"],"opening_balance")
  self.assertEqual(self.client.post(f"/api/v1/opening-balances/{record['id']}/post/",{},format="json",**self.headers).status_code,400)
  tb=trial_balance(organisation=self.org,as_of_date=date(2026,1,31));self.assertEqual(tb["difference"],Decimal("0.00"));bs=balance_sheet(organisation=self.org,as_of_date=date(2026,1,31));self.assertTrue(bs["balanced"])
  flow=cash_flow(organisation=self.org,start_date=date(2026,2,1),end_date=date(2026,2,28));self.assertEqual(flow["opening_cash"],Decimal("100000.00"));self.assertEqual(flow["total_financing"],Decimal("0.00"))
 def test_unbalanced_cannot_submit_and_foreign_account_is_rejected(self):
  response=self.client.post("/api/v1/opening-balances/",self.payload(False),format="json",**self.headers);self.assertEqual(response.status_code,201);self.assertEqual(self.client.post(f"/api/v1/opening-balances/{response.json()['id']}/submit/",{},format="json",**self.headers).status_code,400)
  foreign=Organisation.objects.create(name="Foreign",created_by=self.user);foreign_account=Account.objects.create(organisation=foreign,created_by=self.user,code="X",name="Foreign",account_type="asset",account_class="bank");payload=self.payload();payload["lines"][0]["account_id"]=str(foreign_account.id);self.assertEqual(self.client.post("/api/v1/opening-balances/",payload,format="json",**self.headers).status_code,400)
