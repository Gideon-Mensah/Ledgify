from datetime import date
from decimal import Decimal
from django.db import connection, transaction, IntegrityError
from django.test import TestCase
from rest_framework.test import APIClient
from apps.organisations.models import Organisation, OrganisationMember
from . import test_phase2_history as fixtures
from .models import Account, AccountClassificationEvent, JournalEntry, JournalLine, OpeningBalanceLine
from .services import opening_balances
from .services.reports.trial_balance_service import trial_balance
from .services.reports.balance_sheet_service import balance_sheet
from .services.reports.profit_loss_service import profit_loss
from .services.reports.cash_flow_service import CashFlowReport


class AccountClassificationTests(TestCase):
    def setUp(self):
        fixtures.HistoricalControlTests.setUp(self)
        self.client = APIClient(); self.client.force_authenticate(self.user)
        self.client.credentials(HTTP_X_ORGANISATION_ID=str(self.org.pk))

    def account(self, code='1200', kind='asset', klass='current_asset'):
        return Account.objects.create(organisation=self.org,code=code,name='Trade Debtors',account_type=kind,account_class=klass,currency='GHS',created_by=self.user)

    def patch(self, account, **data):
        return self.client.patch(f'/api/v1/accounts/{account.pk}/', data, format='json')

    def change(self, account, **data):
        return self.patch(account, classification_confirmed=True, classification_reason='Correct classification', **data)

    def opening(self, account):
        record = opening_balances.save_draft(record=None,organisation=self.org,user=self.user,data={'opening_date':date(2026,1,1),'lines':[{'account_id':account.pk,'debit':'14800','credit':'0'},{'account_id':self.equity.pk,'debit':'0','credit':'14800'}]})
        return opening_balances.post(opening_balances.submit(record,self.user),self.user)

    def history(self):
        return (list(JournalEntry.objects.order_by('id').values()), list(JournalLine.objects.order_by('id').values()), list(OpeningBalanceLine.objects.order_by('id').values()))

    def replace(self, old, target, **extra):
        return self.client.post(f'/api/v1/accounts/{old.pk}/replace-control/', {'replacement_id':str(target.pk),'confirmed':True,'reason':'New control for future documents',**extra}, format='json')

    def test_unused_account_type_change(self):
        a=self.account();r=self.change(a,account_type='expense',account_class='operating_expense');self.assertEqual(r.status_code,200,r.data)
        a.refresh_from_db();self.assertEqual(a.account_type,'expense')

    def test_unused_account_class_change(self):
        a=self.account();self.assertEqual(self.change(a,account_class='fixed_asset').status_code,200)

    def test_invalid_combinations_rejected(self):
        for kind,klass in [('expense','receivable'),('asset','payable'),('revenue','current_asset')]:
            with self.subTest(kind=kind):
                r=self.change(self.account(code=kind),account_type=kind,account_class=klass)
                self.assertEqual(r.status_code,400);self.assertIn('must use',str(r.data))

    def test_used_account_type_changes_rejected(self):
        a=self.account();self.opening(a)
        for kind,klass in [('expense','operating_expense'),('liability','current_liability')]:
            r=self.change(a,account_type=kind,account_class=klass)
            self.assertEqual(r.status_code,400);self.assertIn('accounting activity',str(r.data))

    def test_same_type_correction_preserves_opening_and_history_and_reports(self):
        self.ar.delete();a=self.account();opening=self.opening(a);before=self.history()
        reports=[trial_balance(organisation=self.org),balance_sheet(organisation=self.org),profit_loss(organisation=self.org),CashFlowReport(self.org).run()]
        r=self.change(a,account_class='receivable');self.assertEqual(r.status_code,200,r.data)
        self.assertEqual(before,self.history());opening.refresh_from_db();self.assertEqual(opening.lines.get(account=a).debit,Decimal('14800'))
        after=[trial_balance(organisation=self.org),balance_sheet(organisation=self.org),profit_loss(organisation=self.org),CashFlowReport(self.org).run()]
        # Class labels intentionally change; all numeric totals and report hierarchy stay intact.
        for prior,current in zip(reports,after):
            for key,value in prior.items():
                if isinstance(value,(Decimal,bool,int)):self.assertEqual(current[key],value,key)
        self.assertTrue(after[0]['balanced']);self.assertTrue(after[1]['balanced']);self.assertEqual(after[2],reports[2]);self.assertEqual(after[3],reports[3])
        self.assertTrue(any(row['account']['code']=='1200' for row in after[1]['assets']))
        event=AccountClassificationEvent.objects.get(account=a);self.assertEqual(event.before['account_class'],'current_asset');self.assertEqual(event.after['account_class'],'receivable')

    def test_confirmation_and_reason_required(self):
        a=self.account()
        for values in [{},{'classification_confirmed':True},{'classification_reason':'Reason'}]:
            self.assertEqual(self.patch(a,account_class='fixed_asset',**values).status_code,400)

    def test_duplicate_control_rejected(self):
        r=self.change(self.account(),account_class='receivable');self.assertEqual(r.status_code,400);self.assertIn('already exists',str(r.data))

    def test_duplicate_control_create_rejected(self):
        r=self.client.post('/api/v1/accounts/',{'code':'9999','name':'Duplicate','account_type':'asset','account_class':'receivable','currency':'GHS'},format='json')
        self.assertEqual(r.status_code,400)

    def test_system_and_unflagged_controls_protected(self):
        for a in [self.ar,self.ap]:
            self.assertEqual(self.change(a,account_class='current_asset').status_code,400)
            self.assertEqual(self.patch(a,status='inactive').status_code,400)
            self.assertEqual(self.client.delete(f'/api/v1/accounts/{a.pk}/').status_code,400)
        a=self.account();a.is_system_account=True;a.save()
        self.assertEqual(self.change(a,account_class='fixed_asset').status_code,400)

    def test_used_cash_flow_and_currency_changes_rejected(self):
        a=self.account();self.opening(a)
        for values in [{'account_class':'bank'},{'account_class':'fixed_asset'},{'cash_flow_category':'investing'},{'currency':'GBP'}]:
            self.assertEqual(self.change(a,**values).status_code,400)

    def test_draft_references_count_as_used(self):
        from .services.journals import create_journal_entry
        a=self.account();create_journal_entry(organisation=self.org,date=date(2026,1,1),user=self.user,description='Draft',lines=[{'account':a,'debit':'10','credit':'0'},{'account':self.equity,'credit':'10','debit':'0'}])
        self.assertEqual(self.change(a,account_type='expense',account_class='operating_expense').status_code,400)
        self.assertEqual(self.client.delete(f'/api/v1/accounts/{a.pk}/').status_code,400)

    def test_ar_replacement_retains_history_and_new_invoice_uses_new_control(self):
        old_invoice=fixtures.HistoricalControlTests.invoice(self);before=self.history();target=self.account()
        r=self.replace(self.ar,target);self.assertEqual(r.status_code,200,r.data);self.assertEqual(before,self.history())
        self.ar.refresh_from_db();self.assertEqual(self.ar.account_class,'receivable');self.assertEqual(self.ar.status,'active');self.assertFalse(self.ar.is_current_control)
        future=fixtures.HistoricalControlTests.invoice(self,number='FUTURE');self.assertTrue(future.accounting_journal.lines.filter(account=target,debit=120).exists())
        self.assertTrue(old_invoice.accounting_journal.lines.filter(account=self.ar,debit=120).exists())
        self.assertTrue(trial_balance(organisation=self.org)['balanced'])

    def test_ap_replacement_and_bill_discovery(self):
        old=fixtures.HistoricalControlTests.bill(self);target=self.account('2100','liability','current_liability');before=self.history()
        r=self.replace(self.ap,target);self.assertEqual(r.status_code,200,r.data);self.assertEqual(before,self.history())
        from apps.purchases.services.bills import create_bill,approve_bill
        future=create_bill(organisation=self.org,supplier=self.supplier,bill_number='FUTURE',issue_date=date(2026,1,20),due_date=date(2026,1,31),currency='GHS',user=self.user,lines=[{'description':'Expense','quantity':1,'unit_price':'90','expense_account':self.expense}])
        approve_bill(bill=future,user=self.user);future.refresh_from_db()
        self.assertTrue(future.accounting_journal.lines.filter(account=target,credit=90).exists());self.assertTrue(old.accounting_journal.lines.filter(account=self.ap).exists())

    def test_replacement_does_not_break_old_document_reversal(self):
        invoice=fixtures.HistoricalControlTests.invoice(self);self.assertEqual(self.replace(self.ar,self.account()).status_code,200)
        from apps.finance.services.corrections.reverse_document import reverse_document
        reverse_document(organisation=self.org,document=invoice,user=self.user,reversal_date=date(2026,1,20),reason='Correction')
        self.assertTrue(trial_balance(organisation=self.org)['balanced'])

    def test_replacement_validation(self):
        a=self.account();self.opening(a)
        for target,extra in [(a,{}),(self.ar,{}),(self.account('1299'),{'confirmed':False})]:self.assertEqual(self.replace(self.ar,target,**extra).status_code,400)

    def test_cross_organisation_and_permission_protection(self):
        other=Organisation.objects.create(name='Other',base_currency='GHS',created_by=self.user)
        foreign=Account.objects.create(organisation=other,code='1200',name='Other',account_type='asset',account_class='current_asset',currency='GHS',created_by=self.user)
        self.assertEqual(self.replace(self.ar,foreign).status_code,400);self.assertEqual(self.change(foreign,account_class='receivable').status_code,404)
        member=OrganisationMember.objects.get(organisation=self.org,user=self.user);member.role='viewer';member.save()
        self.assertEqual(self.replace(self.ar,self.account()).status_code,403)

    def test_abs_po_001_exact_opening_invoice_and_final_balance(self):
        self.ar.delete();a=self.account();opening=self.opening(a);old=list(opening.journal.lines.order_by('id').values())
        self.assertEqual(self.change(a,account_class='receivable').status_code,200)
        from apps.sales.services.invoices import create_invoice,approve_invoice
        self.customer.name='Accra Business Solutions Ltd';self.customer.save()
        invoice=create_invoice(organisation=self.org,customer=self.customer,invoice_number='ABS-PO-001',issue_date=date(2026,1,15),due_date=date(2026,1,31),currency='GHS',user=self.user,lines=[{'description':'Office supplies','quantity':10,'unit_price':'500','revenue_account':self.revenue}])
        approve_invoice(invoice=invoice,user=self.user);invoice.refresh_from_db()
        self.assertEqual(invoice.total,Decimal('5000'));self.assertEqual(invoice.tax_total,0)
        self.assertEqual(set(invoice.accounting_journal.lines.values_list('account__code','debit','credit')),{('1200',Decimal('5000'),Decimal('0')),('4000',Decimal('0'),Decimal('5000'))})
        from django.db.models import Sum
        self.assertEqual(JournalLine.objects.filter(account=a).aggregate(value=Sum('debit'))['value'],Decimal('19800'))
        self.assertEqual(list(opening.journal.lines.order_by('id').values()),old)
        tb=trial_balance(organisation=self.org);self.assertTrue(tb['balanced']);self.assertEqual(tb['total_debit'],Decimal('19800'));self.assertEqual(tb['total_credit'],Decimal('19800'))
        self.assertTrue(balance_sheet(organisation=self.org)['balanced']);self.assertEqual(profit_loss(organisation=self.org)['net_profit'],Decimal('5000'))

    def test_database_still_blocks_unaudited_classification_and_audit_mutation(self):
        if connection.vendor != 'postgresql':self.skipTest('PostgreSQL trigger required')
        a=self.account();self.opening(a)
        with self.assertRaises(IntegrityError),transaction.atomic():Account.objects.filter(pk=a.pk).update(account_class='fixed_asset')
        self.ar.delete();self.assertEqual(self.change(a,account_class='receivable').status_code,200)
        with self.assertRaises(IntegrityError),transaction.atomic():AccountClassificationEvent.objects.filter(account=a).update(reason='Rewrite')

    def test_configured_fx_account_protection(self):
        self.org.fx_gain_account=self.revenue;self.org.save()
        self.assertEqual(self.change(self.revenue,account_class='other_income').status_code,400)
        response=self.client.get(f'/api/v1/accounts/{self.revenue.pk}/')
        self.assertTrue(response.data['classification_policy']['protected'])

    def test_retained_earnings_control_protection(self):
        a=self.account('3999','equity','retained_earnings')
        self.assertEqual(self.change(a,account_class='equity').status_code,400)
        self.assertEqual(self.replace(a,self.equity).status_code,400)

    def test_legacy_invalid_pair_can_update_name_without_automatic_reclassification(self):
        a=self.account('9998','expense','current_asset')
        r=self.patch(a,name='Legacy account clarification')
        self.assertEqual(r.status_code,200,r.data);a.refresh_from_db();self.assertEqual(a.account_type,'expense');self.assertEqual(a.account_class,'current_asset')

    def test_list_policies_are_scoped_and_show_activity(self):
        a=self.account();self.opening(a)
        r=self.client.get('/api/v1/accounts/');self.assertEqual(r.status_code,200)
        row=next(row for row in r.data if row['id']==str(a.pk))
        self.assertFalse(row['classification_policy']['can_change_type']);self.assertTrue(row['classification_policy']['can_change_class'])

    def test_client_cannot_change_current_control_flag(self):
        self.assertEqual(self.patch(self.ar,is_current_control=False).status_code,200)
        self.ar.refresh_from_db();self.assertTrue(self.ar.is_current_control)


from django.test import TransactionTestCase

class AccountControlConcurrencyTests(TransactionTestCase):
    def setUp(self):
        fixtures.HistoricalControlTests.setUp(self)

    def test_two_replacements_cannot_both_win(self):
        if connection.vendor != 'postgresql': self.skipTest('PostgreSQL advisory lock required')
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from django.db import close_old_connections
        from .services.account_classification import replace_control
        from rest_framework.exceptions import ValidationError
        targets=[Account.objects.create(organisation=self.org,code=str(code),name='Replacement',account_type='asset',account_class='current_asset',currency='GHS',created_by=self.user) for code in (1201,1202)]
        barrier=Barrier(2)
        def replace(target):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                replace_control(self.ar,target.pk,self.user,confirmed=True,reason='Concurrent replacement')
                return 'accepted'
            except ValidationError:return 'rejected'
            finally:connection.close()
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(replace,targets))
        self.assertCountEqual(results,['accepted','rejected'])
        self.assertEqual(Account.objects.filter(organisation=self.org,account_class='receivable',is_current_control=True,status='active').count(),1)
        self.assertEqual(AccountClassificationEvent.objects.count(),1)
