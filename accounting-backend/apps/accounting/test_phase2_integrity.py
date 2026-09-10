"""Independent regressions for period and posted-ledger boundaries."""
from datetime import date
from django.contrib.auth import get_user_model
from django.test import TestCase
from common.exceptions import BusinessRuleError
from apps.organisations.models import Organisation, OrganisationMember
from .models import Account, AccountingPeriod, JournalEntry
from .services.journals import create_journal_entry, post_journal_entry, reverse_journal_entry
from .services.periods.period_service import validate_period_open


class AccountingIntegrityTests(TestCase):
    def setUp(self):
        self.user=get_user_model().objects.create_user(username='phase2',email='phase2@example.invalid',password='test-only')
        self.org=Organisation.objects.create(name='Accounting accuracy fixture',base_currency='GHS',created_by=self.user)
        OrganisationMember.objects.create(organisation=self.org,user=self.user,role='owner')
        self.bank=Account.objects.create(organisation=self.org,code='1000',name='Bank',account_type='asset',account_class='bank',currency='GHS',created_by=self.user)
        self.equity=Account.objects.create(organisation=self.org,code='3000',name='Capital',account_type='equity',account_class='equity',currency='GHS',created_by=self.user)
        self.period=AccountingPeriod.objects.create(organisation=self.org,name='January',start_date=date(2026,1,1),end_date=date(2026,1,31))

    def journal(self, source='manual'):
        journal=create_journal_entry(organisation=self.org,date=date(2026,1,15),description='Immutable capital',user=self.user,source_type=source,lines=[{'account':self.bank,'debit':'100.00','credit':'0.00'},{'account':self.equity,'debit':'0.00','credit':'100.00'}])
        return post_journal_entry(journal,self.user)

    def test_missing_period_is_not_open(self):
        with self.assertRaises(BusinessRuleError):validate_period_open(self.org,date(2026,2,1))

    def test_overlapping_period_cannot_be_saved(self):
        with self.assertRaises(BusinessRuleError):
            AccountingPeriod.objects.create(organisation=self.org,name='Overlapping',start_date=date(2026,1,31),end_date=date(2026,2,28))

    def test_posted_header_cannot_be_edited(self):
        journal=self.journal();journal.description='Changed historical report'
        with self.assertRaises(BusinessRuleError):journal.save()

    def test_bulk_update_cannot_edit_posted_header(self):
        journal=self.journal()
        with self.assertRaises(BusinessRuleError):JournalEntry.objects.filter(pk=journal.pk).update(date=date(2026,1,16))

    def test_generic_source_reversal_is_blocked(self):
        journal=self.journal(JournalEntry.SourceType.INVOICE)
        with self.assertRaises(BusinessRuleError):reverse_journal_entry(journal,self.user,date(2026,1,20))
