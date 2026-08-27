"""General Journal server-pagination and isolation regressions."""
from datetime import date,timedelta
from decimal import Decimal
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounting.models import Account,JournalEntry,JournalLine
from apps.organisations.models import Organisation,OrganisationMember

class GeneralJournalPaginationTests(TestCase):
 def setUp(self):
  self.user=get_user_model().objects.create_user(username="journal-pages",password="test");self.org=Organisation.objects.create(name="Paged Org",created_by=self.user);OrganisationMember.objects.create(organisation=self.org,user=self.user,role="owner");self.foreign=Organisation.objects.create(name="Foreign Org",created_by=self.user);OrganisationMember.objects.create(organisation=self.foreign,user=self.user,role="owner");self.client=APIClient();self.client.force_authenticate(self.user)
  self.bank=Account.objects.create(organisation=self.org,created_by=self.user,code="1000",name="Bank",account_type="asset",account_class="bank");self.capital=Account.objects.create(organisation=self.org,created_by=self.user,code="3000",name="Capital",account_type="equity",account_class="equity")
  for index in range(27):
   journal=JournalEntry.objects.create(organisation=self.org,entry_number=f"JRN-{index:03}",date=date(2026,1,1)+timedelta(days=index),description=f"Entry {index}",status="draft",created_by=self.user)
   JournalLine.objects.create(journal_entry=journal,account=self.bank,debit=Decimal("10.00"),credit=0);JournalLine.objects.create(journal_entry=journal,account=self.capital,debit=0,credit=Decimal("10.00"));JournalEntry.objects.filter(pk=journal.pk).update(status="posted")
  JournalEntry.objects.create(organisation=self.foreign,entry_number="FOREIGN",date=date(2026,1,1),description="Never disclose",status="posted",created_by=self.user)
 def get(self,organisation=None,**params):return self.client.get("/api/v1/journals/register/",params,HTTP_X_ORGANISATION_ID=str((organisation or self.org).id))
 def test_first_middle_last_pages_are_stable_complete_journals(self):
  first=self.get();self.assertEqual(first.status_code,200);self.assertEqual(first.json()["count"],27);self.assertEqual(len(first.json()["results"]),25);self.assertEqual(first.json()["results"][0]["entry_number"],"JRN-000");self.assertEqual(len(first.json()["results"][0]["lines"]),2)
  last=self.get(page=2);self.assertEqual([row["entry_number"] for row in last.json()["results"]],["JRN-025","JRN-026"]);self.assertEqual(first.json()["totals"],last.json()["totals"]);self.assertEqual(first.json()["totals"],{"debit":270.0,"credit":270.0})
 def test_page_sizes_invalid_pages_filters_and_isolation(self):
  self.assertEqual(len(self.get(page_size=10,page=2).json()["results"]),10);self.assertEqual(len(self.get(page_size="invalid").json()["results"]),25);self.assertEqual(len(self.get(page_size=500).json()["results"]),27);self.assertEqual(self.get(page=99).status_code,404)
  filtered=self.get(start_date="2026-01-10",end_date="2026-01-12",search="Entry");self.assertEqual(filtered.json()["count"],3)
  foreign=self.get(organisation=self.foreign);self.assertEqual(foreign.json()["count"],1);self.assertEqual(foreign.json()["results"][0]["entry_number"],"FOREIGN")
