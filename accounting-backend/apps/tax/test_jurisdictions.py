from copy import deepcopy
from datetime import date
from decimal import Decimal
from django.test import TestCase, SimpleTestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from apps.organisations.models import Organisation, OrganisationMember
from apps.accounting.models import Account, AccountingPeriod
from apps.contacts.models import Contact
from apps.sales.services.invoices import create_invoice, approve_invoice
from apps.purchases.services.bills import create_bill, approve_bill
from apps.tax.models import TaxCode, TaxRateVersion, TaxTransaction, DocumentTaxSnapshot
from apps.tax.engine import calculate_components
from apps.tax.configuration import create_profile, review_profile, activate_profile, draft_version, approve_version, activate_version
from apps.tax.presets import VAT_COMPONENTS
from apps.tax.returns import vat_workpaper


class ComponentCalculationTests(SimpleTestCase):
    def test_ghana_common_base_and_inclusive(self):
        for inclusive,amount in [(False,'1000'),(True,'1200')]:
            r=calculate_components(quantity=1,unit_price=amount,components=VAT_COMPONENTS,inclusive=inclusive)
            self.assertEqual([c['amount'] for c in r['components']],['150.00','25.00','25.00'])
            self.assertEqual(r['net_amount'],Decimal('1000'));self.assertEqual(r['gross_amount'],Decimal('1200'))
    def test_classifications_partial_recovery_and_compound(self):
        for classification in ['ZERO','EXEMPT','OUT_SCOPE']:
            r=calculate_components(quantity=1,unit_price=1000,components=VAT_COMPONENTS,classification=classification)
            self.assertEqual(r['classification'],classification);self.assertEqual(r['tax_amount'],0)
        components=deepcopy(VAT_COMPONENTS);components[0]['recoverable_percent']='50'
        r=calculate_components(quantity=1,unit_price=1000,components=components,scope='PURCHASES')
        self.assertEqual(r['components'][0]['recoverable_amount'],'75.00')
        compound=[{'code':'A','rate':'10'},{'code':'B','rate':'5','depends_on':['A']}]
        self.assertEqual(calculate_components(quantity=1,unit_price=100,components=compound)['gross_amount'],Decimal('115.50'))
    def test_cycles_and_negative_values_rejected(self):
        for components in [[{'code':'A','rate':10,'depends_on':['A']}],[{'code':'A','rate':10,'depends_on':['B']},{'code':'B','rate':5,'depends_on':['A']}],[{'code':'A','rate':-1}]]:
            with self.assertRaises(Exception):calculate_components(quantity=1,unit_price=100,components=components)


class JurisdictionIntegrationTests(TestCase):
    def setUp(self):
        self.user=get_user_model().objects.create_user(username='tax-owner',password='Synthetic-test-only-328!')
        self.org=Organisation.objects.create(name='Accra synthetic',country_code='GH',base_currency='GHS',created_by=self.user)
        OrganisationMember.objects.create(organisation=self.org,user=self.user,role='owner')
        AccountingPeriod.objects.create(organisation=self.org,name='2026',start_date=date(2026,1,1),end_date=date(2027,12,31))
        self.customer=Contact.objects.create(organisation=self.org,name='Customer',is_customer=True,is_supplier=True,currency='GHS',created_by=self.user)
        def account(code,kind,klass):return Account.objects.create(organisation=self.org,code=code,name=code,account_type=kind,account_class=klass,currency='GHS',created_by=self.user)
        self.revenue=account('4000','revenue','sales');self.expense=account('5000','expense','operating_expense')
        self.ar=account('1100','asset','receivable');self.ap=account('2100','liability','payable');self.bank=account('1000','asset','bank')
        self.mappings={}
        for i,c in enumerate(['VAT','NHIL','GETFUND']):
            self.mappings['OUTPUT_'+c]=str(account(str(2200+i),'liability','current_liability').pk)
            self.mappings['INPUT_'+c]=str(account(str(1200+i),'asset','current_asset').pk)
        self.profile=create_profile(organisation=self.org,user=self.user,structure='GHANA_GRA',jurisdiction='GH',effective_from=date(2026,1,1),
            registration={'vat_registered':True,'vat_registration_number':'TEST-VAT','tin':'TEST-TIN','vat_effective_from':'2026-01-01','wht_agent':True,'wht_effective_from':'2026-01-01','vat_wht_agent':True,'vat_wht_effective_from':'2026-01-01'},mappings=self.mappings,reason='Synthetic reviewed migration',separate_approval=False)
        self.profile=review_profile(organisation=self.org,user=self.user,profile=self.profile)
        self.profile=activate_profile(organisation=self.org,user=self.user,profile=self.profile,confirmed=True)
        self.sales=TaxCode.objects.get(organisation=self.org,code='GHS-STD-SALES');self.purchases=TaxCode.objects.get(organisation=self.org,code='GHS-STD-PURCHASE')
        self.client=APIClient();self.client.force_authenticate(self.user);self.client.credentials(HTTP_X_ORGANISATION_ID=str(self.org.pk))
    def invoice(self,number='INV',point=date(2026,2,1),code=None):
        return create_invoice(organisation=self.org,user=self.user,customer=self.customer,invoice_number=number,issue_date=point,due_date=point,currency='GHS',lines=[{'description':'Service','quantity':1,'unit_price':1000,'revenue_account':self.revenue,'tax_code':code or self.sales}])
    def test_sale_and_purchase_post_separate_controls_and_reconcile(self):
        invoice=approve_invoice(invoice=self.invoice(),user=self.user)
        self.assertEqual(invoice.total,Decimal('1200'))
        self.assertEqual(sorted(invoice.accounting_journal.lines.filter(account_id__in=self.mappings.values()).values_list('credit',flat=True)),[Decimal('25'),Decimal('25'),Decimal('150')])
        bill=create_bill(organisation=self.org,user=self.user,supplier=self.customer,bill_number='BILL',issue_date=date(2026,2,2),due_date=date(2026,2,2),currency='GHS',lines=[{'description':'Cost','quantity':1,'unit_price':1000,'expense_account':self.expense,'tax_code':self.purchases}])
        approve_bill(bill=bill,user=self.user)
        report=vat_workpaper(self.org,date(2026,2,1),date(2026,2,28))
        self.assertTrue(report['reconciled'],report);self.assertEqual(report['net_payable'],0)
        self.assertEqual(TaxTransaction.objects.count(),6);self.assertEqual(DocumentTaxSnapshot.objects.count(),2)
    def test_future_version_history_and_stale_draft(self):
        old=approve_invoice(invoice=self.invoice(),user=self.user)
        draft=self.invoice('FUTURE',date(2027,1,1))
        current=self.sales.versions.get();components=deepcopy(current.components);components[0]['rate']='16'
        version=draft_version(organisation=self.org,user=self.user,code=self.sales,effective_from=date(2027,1,1),effective_to=None,classification='STANDARD',components=components,rules={'tax_point':'INVOICE_DATE'},source='https://example.invalid/synthetic-official-change',reason='Synthetic future rate')
        version=approve_version(organisation=self.org,user=self.user,version=version);activate_version(organisation=self.org,user=self.user,version=version,confirmed=True)
        with self.assertRaisesMessage(Exception,'version changed'):approve_invoice(invoice=draft,user=self.user)
        self.assertEqual(self.invoice('NEW',date(2027,1,1)).total,Decimal('1210'))
        old.refresh_from_db();self.assertEqual(old.total,Decimal('1200'));self.assertEqual(old.lines.get().tax_snapshot['components'][0]['rate'],'15')
    def test_api_scoping_and_components(self):
        response=self.client.post('/api/v1/tax/configuration/preview/',{'date':'2026-02-01','tax_code_id':str(self.sales.pk),'quantity':1,'unit_price':'1000'},format='json')
        self.assertEqual(response.status_code,200,response.data);self.assertEqual(response.data['gross_amount'],'1200.00')
        other=Organisation.objects.create(name='Other',country_code='GB',base_currency='GBP',created_by=self.user)
        code=TaxCode.objects.create(organisation=other,created_by=self.user,code='FOREIGN',name='Foreign',jurisdiction='GB')
        response=self.client.post(f'/api/v1/tax/configuration/codes/{code.pk}/versions/',{},format='json')
        self.assertEqual(response.status_code,404)
    def test_no_implicit_tax_and_unverified_withholding(self):
        with self.assertRaisesMessage(Exception,'Select and confirm'):
            create_invoice(organisation=self.org,user=self.user,customer=self.customer,invoice_number='MISSING',issue_date=date(2026,2,1),due_date=date(2026,2,1),currency='GHS',lines=[{'description':'Service','unit_price':100,'quantity':1,'revenue_account':self.revenue}])
        self.assertFalse(TaxRateVersion.objects.filter(code__family='WHT',activated_at__isnull=False).exists())

    def test_reverse_charge_partial_recovery_excludes_supplier_total(self):
        code=TaxCode.objects.create(organisation=self.org,created_by=self.user,code='RC',name='Reviewed reverse charge',jurisdiction='GH',scope='PURCHASES')
        version=draft_version(organisation=self.org,user=self.user,code=code,effective_from=date(2026,1,1),effective_to=None,
            classification='REVERSE_CHARGE',components=[{'code':'RCVAT','rate':'20','recoverable_percent':'50',
                'input_account':self.mappings['INPUT_VAT'],'output_account':self.mappings['OUTPUT_VAT']}],
            rules={'tax_point':'INVOICE_DATE'},source='Synthetic accountant-reviewed treatment',reason='Synthetic reverse-charge test')
        version=approve_version(organisation=self.org,user=self.user,version=version)
        activate_version(organisation=self.org,user=self.user,version=version,confirmed=True)
        bill=create_bill(organisation=self.org,user=self.user,supplier=self.customer,bill_number='RC-BILL',issue_date=date(2026,2,2),due_date=date(2026,2,2),currency='GHS',
            lines=[{'description':'Imported service','quantity':1,'unit_price':1000,'expense_account':self.expense,'tax_code':code}])
        bill=approve_bill(bill=bill,user=self.user)
        self.assertEqual(bill.total,Decimal('1000'));self.assertEqual(bill.tax_total,0)
        journal=bill.accounting_journal
        self.assertEqual(journal.lines.get(account=self.expense).debit,Decimal('1100'))
        self.assertEqual(journal.lines.get(account_id=self.mappings['INPUT_VAT']).debit,Decimal('100'))
        self.assertEqual(journal.lines.get(account_id=self.mappings['OUTPUT_VAT']).credit,Decimal('200'))
        self.assertTrue(vat_workpaper(self.org,date(2026,2,1),date(2026,2,28))['reconciled'])

    def test_legacy_rate_api_cannot_bypass_approved_configuration(self):
        from apps.tax.models import TaxAccountMapping
        rate=TaxAccountMapping.objects.get(version__code=self.sales, component_code='VAT', direction='OUTPUT').legacy_rate
        response=self.client.patch(f'/api/v1/tax-rates/{rate.pk}/',{'rate':'99'},format='json')
        self.assertEqual(response.status_code,400,response.data)
        rate.refresh_from_db();self.assertEqual(rate.rate,Decimal('15'))

    def test_old_unsnapshotted_draft_requires_review_after_migration(self):
        invoice=self.invoice()
        invoice.lines.update(tax_snapshot={})
        with self.assertRaisesMessage(Exception,'recalculate this legacy draft'):
            approve_invoice(invoice=invoice,user=self.user)

    def test_customer_withholding_settles_gross_and_requires_certificate(self):
        from apps.sales.services.payments.create_customer_payment import create_customer_payment
        from apps.tax.returns import withholding_register
        wh_input=Account.objects.create(organisation=self.org,created_by=self.user,code='WH-IN',name='WHT receivable',account_type='asset',account_class='current_asset',currency='GHS')
        wh_output=Account.objects.create(organisation=self.org,created_by=self.user,code='WH-OUT',name='WHT payable',account_type='liability',account_class='current_liability',currency='GHS')
        code=TaxCode.objects.get(organisation=self.org,code='WHT-RES-SERVICES')
        version=draft_version(organisation=self.org,user=self.user,code=code,effective_from=date(2026,1,1),effective_to=None,
            classification='STANDARD',components=[{'code':'WHT','rate':'5','input_account':str(wh_input.pk),'output_account':str(wh_output.pk)}],
            rules={'tax_point':'PAYMENT_DATE','verified':True,'official_code':'SYNTHETIC','residence':'RESIDENT'},source='Synthetic verified fixture, not a statutory preset',reason='Test payment tax')
        version=approve_version(organisation=self.org,user=self.user,version=version);activate_version(organisation=self.org,user=self.user,version=version,confirmed=True)
        invoice=approve_invoice(invoice=self.invoice(),user=self.user)
        item={'tax_code_id':str(code.pk),'eligibility_confirmed':True,'tax_identifier':'TEST-TIN','country':'GH','residence':'RESIDENT','contract_amount':'1200'}
        kwargs=dict(organisation=self.org,user=self.user,customer=self.customer,bank_account=self.bank,payment_date=date(2026,2,3),amount='1200',currency='GHS',invoice=invoice)
        with self.assertRaisesMessage(Exception,'certificate'):create_customer_payment(**kwargs,withholdings=[item])
        item['certificate']='SYNTHETIC-CERT';payment=create_customer_payment(**kwargs,withholdings=[item])
        self.assertEqual(payment.cash_amount,Decimal('1140'));self.assertEqual(payment.amount,Decimal('1200'))
        self.assertEqual(payment.accounting_journal.lines.get(account=self.bank).debit,Decimal('1140'))
        self.assertEqual(payment.accounting_journal.lines.get(account=self.ar).credit,Decimal('1200'))
        invoice.refresh_from_db();self.assertEqual(invoice.amount_due,0)
        self.assertTrue(withholding_register(self.org,date(2026,2,1),date(2026,2,28))['reconciled'])

    def test_return_lock_adjustment_and_payment_preserve_filed_snapshot(self):
        from apps.tax.models import TaxPeriod
        from apps.tax.returns import prepare_return, transition_return
        from apps.tax.operations import post_adjustment, post_payment
        from apps.accounting.services.journals import reverse_journal_entry
        approve_invoice(invoice=self.invoice(),user=self.user)
        feb=TaxPeriod.objects.create(organisation=self.org,start_date=date(2026,2,1),end_date=date(2026,2,28))
        result=prepare_return(organisation=self.org,user=self.user,period=feb)
        result=transition_return(organisation=self.org,user=self.user,tax_return=result,target='REVIEWED',reason='Reconciled')
        result=transition_return(organisation=self.org,user=self.user,tax_return=result,target='APPROVED',reason='Accountant approved')
        checksum=result.checksum
        result=transition_return(organisation=self.org,user=self.user,tax_return=result,target='FILED',reason='Synthetic manual filing',acknowledgement='TEST-ACK')
        with self.assertRaises(Exception):approve_invoice(invoice=self.invoice('LOCKED'),user=self.user)
        march=TaxPeriod.objects.create(organisation=self.org,start_date=date(2026,3,1),end_date=date(2026,3,31))
        adjustment=post_adjustment(organisation=self.org,user=self.user,period=march,point=date(2026,3,2),account_id=self.mappings['OUTPUT_VAT'],counter_account_id=self.expense.pk,amount='10',direction='OUTPUT',component_code='VAT',reason='Correct filed February in March',original_return=result)
        with self.assertRaisesMessage(Exception,'opposite adjustment'):
            reverse_journal_entry(adjustment.journal,self.user,reversal_date=date(2026,3,3))
        post_payment(organisation=self.org,user=self.user,tax_return=result,point=date(2026,3,4),account_id=self.mappings['OUTPUT_VAT'],bank_account_id=self.bank.pk,amount='200',reference='TEST-PAYMENT',allocations=[{'account_id':self.mappings['OUTPUT_'+code],'amount':amount} for code,amount in [('VAT','150'),('NHIL','25'),('GETFUND','25')]])
        report=vat_workpaper(self.org,date(2026,3,1),date(2026,3,31))
        self.assertTrue(report['reconciled'],report);self.assertEqual(report['net_payable'],Decimal('10'))
        result.refresh_from_db();self.assertEqual(result.checksum,checksum);self.assertEqual(result.status,'PAID')

    def test_linked_credit_preserves_original_version_and_rejects_foreign_line(self):
        from apps.sales.services.credit_notes.create_credit_note import create_customer_credit_note
        from apps.sales.services.credit_notes.approve_credit_note import approve_customer_credit_note
        invoice=approve_invoice(invoice=self.invoice(),user=self.user)
        kwargs=dict(organisation=self.org,user=self.user,customer=self.customer,invoice=invoice,credit_note_number='CREDIT',issue_date=date(2027,1,2),currency='GHS')
        line={'description':'Original supply correction','quantity':1,'unit_price':1000,'revenue_account':self.revenue,'source_line_id':invoice.lines.get().pk}
        current=self.sales.versions.get();components=deepcopy(current.components);components[0]['rate']='16'
        version=draft_version(organisation=self.org,user=self.user,code=self.sales,effective_from=date(2027,1,1),effective_to=None,classification='STANDARD',components=components,rules={},source='Synthetic statutory change',reason='Future reviewed rate')
        version=approve_version(organisation=self.org,user=self.user,version=version);activate_version(organisation=self.org,user=self.user,version=version,confirmed=True)
        from uuid import uuid4
        with self.assertRaisesMessage(Exception,'original line'):
            create_customer_credit_note(**kwargs,lines=[{**line,'source_line_id':uuid4()}])
        credit=create_customer_credit_note(**kwargs,lines=[line]);credit=approve_customer_credit_note(credit_note=credit,user=self.user)
        self.assertEqual(credit.total,Decimal('1200'));self.assertEqual(credit.lines.get().tax_snapshot['version_id'],str(current.pk))
        self.assertTrue(vat_workpaper(self.org,date(2027,1,1),date(2027,1,31))['reconciled'])

    def test_debit_note_uses_original_rate_and_existing_invoice_ledger(self):
        original=approve_invoice(invoice=self.invoice(),user=self.user)
        current=self.sales.versions.get();components=deepcopy(current.components);components[0]['rate']='16'
        version=draft_version(organisation=self.org,user=self.user,code=self.sales,effective_from=date(2027,1,1),effective_to=None,classification='STANDARD',components=components,rules={},source='Synthetic future change',reason='Boundary test')
        version=approve_version(organisation=self.org,user=self.user,version=version);activate_version(organisation=self.org,user=self.user,version=version,confirmed=True)
        response=self.client.post('/api/v1/tax/configuration/debit-note/',{'original_document_id':str(original.pk),'document':{
            'customer_id':str(self.customer.pk),'invoice_number':'DEBIT-001','issue_date':'2027-01-02','due_date':'2027-01-02','currency':'GHS',
            'lines':[{'description':'Additional original supply','quantity':'1','unit_price':'100','revenue_account_id':str(self.revenue.pk),'source_line_id':str(original.lines.get().pk)}]}},format='json')
        self.assertEqual(response.status_code,201,response.data)
        from apps.sales.models import Invoice
        debit=approve_invoice(invoice=Invoice.objects.get(pk=response.data['id']),user=self.user)
        self.assertEqual(debit.total,Decimal('120'));self.assertEqual(debit.accounting_journal.source_type,'invoice')
        self.assertEqual(debit.lines.get().tax_snapshot['version_id'],str(current.pk))
        from common.documents import document_contract
        contract=document_contract(organisation=self.org,kind='invoice',pk=debit.pk)
        self.assertEqual(contract['title'],'Debit note')
        report=vat_workpaper(self.org,date(2027,1,1),date(2027,1,31))
        self.assertTrue(report['reconciled'],report);self.assertEqual(report['sections']['credit_debit_adjustments'],Decimal('20'))

    def test_supplier_wht_and_vat_withholding_are_separate_and_export_is_not_filing(self):
        from apps.purchases.services.payments.create_supplier_payment import create_supplier_payment
        from apps.tax.returns import withholding_register,prepare_return,transition_return,export_wht
        from apps.tax.models import TaxPeriod
        items=[]
        for family,code_name,rate in [('WHT','WHT-RES-SERVICES','5'),('VAT_WHT','GHS-VAT-WHT','7')]:
            code=TaxCode.objects.get(organisation=self.org,code=code_name)
            mapping={}
            for direction,kind in [('input','asset'),('output','liability')]:
                a=Account.objects.create(organisation=self.org,created_by=self.user,code=family+direction,name=family+direction,account_type=kind,account_class='current_asset' if kind=='asset' else 'current_liability',currency='GHS')
                mapping[direction+'_account']=str(a.pk)
            version=draft_version(organisation=self.org,user=self.user,code=code,effective_from=date(2026,1,1),effective_to=None,classification='STANDARD',components=[{'code':family,'rate':rate,**mapping}],rules={'tax_point':'PAYMENT_DATE','verified':True,'official_code':'SYNTHETIC-'+family,'residence':'RESIDENT'},source='Synthetic verified fixture; no statutory claim',reason='Test withholding families')
            version=approve_version(organisation=self.org,user=self.user,version=version);activate_version(organisation=self.org,user=self.user,version=version,confirmed=True)
            items.append({'tax_code_id':str(code.pk),'eligibility_confirmed':True,'tax_identifier':'SYNTHETIC-TIN','country':'GH','residence':'RESIDENT','certificate':'TEST-CERT','certificate_date':'2026-02-03','contract_amount':'1200','counterparty_vat_registered':True})
        bill=create_bill(organisation=self.org,user=self.user,supplier=self.customer,bill_number='WHT-BILL',issue_date=date(2026,2,2),due_date=date(2026,2,2),currency='GHS',lines=[{'description':'Service','quantity':1,'unit_price':1000,'expense_account':self.expense,'tax_code':self.purchases}])
        bill=approve_bill(bill=bill,user=self.user)
        payment=create_supplier_payment(organisation=self.org,user=self.user,supplier=self.customer,bank_account=self.bank,payment_date=date(2026,2,3),amount='1200',currency='GHS',bill=bill,withholdings=items)
        self.assertEqual(payment.cash_amount,Decimal('1070'));self.assertEqual(payment.accounting_journal.lines.get(account=self.ap).debit,Decimal('1200'))
        for family,expected in [('WHT','60'),('VAT_WHT','70')]:
            report=withholding_register(self.org,date(2026,2,1),date(2026,2,28),family)
            self.assertTrue(report['reconciled'],report);self.assertEqual(report['payable'],Decimal(expected))
        self.assertTrue(vat_workpaper(self.org,date(2026,2,1),date(2026,2,28))['reconciled'])
        period=TaxPeriod.objects.create(organisation=self.org,start_date=date(2026,2,1),end_date=date(2026,2,28))
        result=prepare_return(organisation=self.org,user=self.user,period=period,kind='WHT')
        result=transition_return(organisation=self.org,user=self.user,tax_return=result,target='REVIEWED',reason='Synthetic review')
        data,export=export_wht(organisation=self.org,user=self.user,tax_return=result)
        self.assertIn(b'60.00',data);self.assertIn('NOT_GRA_UPLOAD',export.template_version)
        result.refresh_from_db();self.assertEqual(result.status,'REVIEWED')
        with self.assertRaisesMessage(Exception,'template'):export_wht(organisation=self.org,user=self.user,tax_return=result,portal=True)
        from apps.finance.services.allocations.reverse_payment import reverse_payment
        reverse_payment(organisation=self.org,payment=payment,user=self.user,reversal_date=date(2026,3,1),reason='Synthetic payment correction')
        for family,expected in [('WHT','-60'),('VAT_WHT','-70')]:
            reversal=withholding_register(self.org,date(2026,3,1),date(2026,3,31),family)
            self.assertTrue(reversal['reconciled'],reversal);self.assertEqual(reversal['payable'],Decimal(expected))
            self.assertTrue(reversal['rows'][0]['reversal'])
        bill.refresh_from_db();self.assertEqual(bill.amount_paid,0)
        result.refresh_from_db();self.assertIn('60.00',str(result.snapshot))


    def test_tax_role_matrix_denies_before_object_lookup(self):
        from uuid import uuid4
        endpoint=f'/api/v1/tax/configuration/versions/{uuid4()}/emergency/'
        for role,allowed in [('owner',True),('admin',True),('accountant',False),('bookkeeper',False),('approver',False),('viewer',False),('employee',False)]:
            with self.subTest(role=role):
                member=OrganisationMember.objects.get(organisation=self.org,user=self.user)
                member.role=role;member.save()
                response=self.client.post(endpoint,{'confirmed':True,'reason':'Synthetic permission check'},format='json')
                self.assertEqual(response.status_code,404 if allowed else 403,response.data)
        member.role='owner';member.save()

    def test_database_guards_block_snapshot_mutation_and_locked_period_reopen(self):
        from django.db import transaction,DatabaseError
        from apps.tax.models import TaxPeriod
        from apps.tax.returns import prepare_return,transition_return
        invoice=approve_invoice(invoice=self.invoice(),user=self.user)
        with self.assertRaises(DatabaseError),transaction.atomic():
            DocumentTaxSnapshot.objects.filter(journal=invoice.accounting_journal).update(payload={})
        with self.assertRaises(DatabaseError),transaction.atomic():
            TaxCode.objects.filter(pk=self.sales.pk).update(code='MUTATED')
        period=TaxPeriod.objects.create(organisation=self.org,start_date=date(2026,2,1),end_date=date(2026,2,28))
        result=prepare_return(organisation=self.org,user=self.user,period=period)
        result=transition_return(organisation=self.org,user=self.user,tax_return=result,target='REVIEWED',reason='Synthetic review')
        transition_return(organisation=self.org,user=self.user,tax_return=result,target='APPROVED',reason='Synthetic approval')
        with self.assertRaises(DatabaseError),transaction.atomic():
            TaxPeriod.objects.filter(pk=period.pk).update(status='OPEN')

    def test_registration_migration_keeps_approved_organisation_override(self):
        current=self.sales.versions.get();components=deepcopy(current.components);components[0]['rate']='16'
        version=draft_version(organisation=self.org,user=self.user,code=self.sales,effective_from=date(2027,1,1),effective_to=None,classification='STANDARD',components=components,rules={},source='Synthetic reviewed override',reason='Prospective override')
        version=approve_version(organisation=self.org,user=self.user,version=version);activate_version(organisation=self.org,user=self.user,version=version,confirmed=True)
        profile=create_profile(organisation=self.org,user=self.user,structure='GHANA_GRA',jurisdiction='GH',effective_from=date(2027,1,2),registration=self.profile.registration,mappings=self.mappings,reason='Registration detail change',separate_approval=False)
        profile=review_profile(organisation=self.org,user=self.user,profile=profile);activate_profile(organisation=self.org,user=self.user,profile=profile,confirmed=True)
        from apps.tax.configuration import version_on
        adopted=version_on(self.org,self.sales,date(2027,1,2))
        self.assertEqual(adopted.components[0]['rate'],'16');self.assertEqual(adopted.provenance,'ORGANISATION_OVERRIDE')
        self.assertEqual(adopted.source,'Synthetic reviewed override')

    def test_custom_and_no_tax_profiles_do_not_inherit_ghana_catalogue(self):
        for structure in ['CUSTOM_INTERNATIONAL','NO_TAX']:
            org=Organisation.objects.create(name=structure,country_code='GB',base_currency='GBP',created_by=self.user)
            OrganisationMember.objects.create(organisation=org,user=self.user,role='owner')
            profile=create_profile(organisation=org,user=self.user,structure=structure,jurisdiction='GB',effective_from=date(2026,1,1),registration={},mappings={},reason='Explicit international selection',separate_approval=False)
            profile=review_profile(organisation=org,user=self.user,profile=profile);activate_profile(organisation=org,user=self.user,profile=profile,confirmed=True)
            self.assertFalse(TaxCode.objects.filter(organisation=org,statutory=True).exists())
            from apps.tax.document_tax import prepare_line_tax
            if structure=='NO_TAX':
                result=prepare_line_tax(organisation=org,line={'quantity':1,'unit_price':'123.45'},scope='SALES',point=date(2026,2,1))
                self.assertEqual(result['tax_amount'],0);self.assertEqual(result['gross_amount'],Decimal('123.45'))
            else:
                with self.assertRaisesMessage(Exception,'Select and confirm'):
                    prepare_line_tax(organisation=org,line={'quantity':1,'unit_price':100},scope='SALES',point=date(2026,2,1))

    def test_nonregistered_ghana_does_not_activate_standard_vat(self):
        org=Organisation.objects.create(name='Nonregistered',country_code='GH',base_currency='GHS',created_by=self.user)
        OrganisationMember.objects.create(organisation=org,user=self.user,role='owner')
        profile=create_profile(organisation=org,user=self.user,structure='GHANA_GRA',jurisdiction='GH',effective_from=date(2026,1,1),registration={'vat_registered':False},mappings={},reason='Not VAT registered',separate_approval=False)
        profile=review_profile(organisation=org,user=self.user,profile=profile);activate_profile(organisation=org,user=self.user,profile=profile,confirmed=True)
        self.assertFalse(TaxRateVersion.objects.filter(organisation=org,code__code='GHS-STD-SALES').exists())
        from apps.tax.document_tax import prepare_line_tax
        code=TaxCode.objects.get(organisation=org,code='GHS-OUT-SCOPE')
        result=prepare_line_tax(organisation=org,line={'quantity':1,'unit_price':100,'tax_code':code},scope='SALES',point=date(2026,2,1))
        self.assertEqual(result['tax_amount'],0);self.assertEqual(result['snapshot']['classification'],'OUT_SCOPE')


    def test_tax_refund_clears_input_controls_and_retries_are_idempotent(self):
        from uuid import uuid4
        from apps.tax.models import TaxPeriod, TaxPayment
        from apps.tax.returns import prepare_return, transition_return
        from apps.tax.operations import post_payment
        bill=create_bill(organisation=self.org,user=self.user,supplier=self.customer,bill_number='REFUND-INPUT',issue_date=date(2026,2,2),due_date=date(2026,2,2),currency='GHS',lines=[{'description':'Purchase','quantity':1,'unit_price':1000,'expense_account':self.expense,'tax_code':self.purchases}])
        approve_bill(bill=bill,user=self.user)
        period=TaxPeriod.objects.create(organisation=self.org,start_date=date(2026,2,1),end_date=date(2026,2,28))
        result=prepare_return(organisation=self.org,user=self.user,period=period)
        for status in ['REVIEWED','APPROVED','FILED']:
            result=transition_return(organisation=self.org,user=self.user,tax_return=result,target=status,reason='Synthetic refund review',acknowledgement='TEST-REFUND-ACK')
        kwargs=dict(organisation=self.org,user=self.user,tax_return=result,point=date(2026,3,1),bank_account_id=self.bank.pk,amount='-200',reference='TEST-REFUND',idempotency_key=uuid4(),
            allocations=[{'account_id':self.mappings['INPUT_'+code],'amount':amount} for code,amount in [('VAT','150'),('NHIL','25'),('GETFUND','25')]])
        first=post_payment(**kwargs);second=post_payment(**kwargs)
        self.assertEqual(first.pk,second.pk);self.assertEqual(TaxPayment.objects.count(),1)
        self.assertEqual(first.journal.lines.get(account=self.bank).debit,Decimal('200'))
        with self.assertRaisesMessage(Exception,'different settlement'):
            post_payment(**{**kwargs,'reference':'CHANGED'})
        self.assertTrue(vat_workpaper(self.org,date(2026,3,1),date(2026,3,31))['reconciled'])


    def test_duplicate_return_approval_and_amendment_cannot_duplicate_settlement(self):
        from apps.tax.models import TaxPeriod, TaxPayment
        from apps.tax.returns import prepare_return,transition_return
        from apps.tax.operations import post_payment
        approve_invoice(invoice=self.invoice(),user=self.user)
        period=TaxPeriod.objects.create(organisation=self.org,start_date=date(2026,2,1),end_date=date(2026,2,28))
        original=prepare_return(organisation=self.org,user=self.user,period=period)
        duplicate=prepare_return(organisation=self.org,user=self.user,period=period)
        for result in [original,duplicate]:transition_return(organisation=self.org,user=self.user,tax_return=result,target='REVIEWED',reason='Reviewed')
        original=transition_return(organisation=self.org,user=self.user,tax_return=original,target='APPROVED',reason='Approved')
        with self.assertRaisesMessage(Exception,'already exists'):
            transition_return(organisation=self.org,user=self.user,tax_return=duplicate,target='APPROVED',reason='Duplicate')
        original=transition_return(organisation=self.org,user=self.user,tax_return=original,target='FILED',reason='Filed',acknowledgement='TEST-ACK')
        allocations=[{'account_id':self.mappings['OUTPUT_'+code],'amount':amount} for code,amount in [('VAT','150'),('NHIL','25'),('GETFUND','25')]]
        post_payment(organisation=self.org,user=self.user,tax_return=original,point=date(2026,3,1),bank_account_id=self.bank.pk,amount='200',reference='TEST-PAY',allocations=allocations)
        original.refresh_from_db()
        amended=transition_return(organisation=self.org,user=self.user,tax_return=original,target='AMENDED',reason='Updated filing reference')
        for status in ['REVIEWED','APPROVED','FILED']:
            amended=transition_return(organisation=self.org,user=self.user,tax_return=amended,target=status,reason='Amendment review',acknowledgement='TEST-AMENDED')
        with self.assertRaisesMessage(Exception,'unsettled'):
            post_payment(organisation=self.org,user=self.user,tax_return=amended,point=date(2026,3,2),bank_account_id=self.bank.pk,amount='200',reference='DUPLICATE',allocations=allocations)
        self.assertEqual(TaxPayment.objects.count(),1)
        period.refresh_from_db()
        separate=prepare_return(organisation=self.org,user=self.user,period=period,kind='WHT')
        self.assertEqual(separate.kind,'WHT')

    def test_future_government_override_can_change_basis_without_mutating_preset(self):
        from apps.tax.models import TaxRegimeVersion
        preset=TaxRegimeVersion.objects.get(version='2026.1');checksum=preset.checksum
        components=deepcopy(self.sales.versions.get().components)
        components[0]['depends_on']=[]
        components[1]['kind']='FIXED';components[1]['rate']='5'
        components[2]['depends_on']=['VAT','NHIL']
        version=draft_version(organisation=self.org,user=self.user,code=self.sales,effective_from=date(2027,1,1),effective_to=None,classification='STANDARD',components=components,rules={},source='Synthetic future law reference',reason='Reviewed change of calculation basis')
        version=approve_version(organisation=self.org,user=self.user,version=version);activate_version(organisation=self.org,user=self.user,version=version,confirmed=True)
        invoice=approve_invoice(invoice=self.invoice('FUTURE-BASIS',date(2027,1,1)),user=self.user)
        self.assertEqual(invoice.total,Decimal('1183.88'));self.assertEqual(version.provenance,'ORGANISATION_OVERRIDE')
        preset.refresh_from_db();self.assertEqual(preset.checksum,checksum)
        self.assertTrue(vat_workpaper(self.org,date(2027,1,1),date(2027,1,31))['reconciled'])

    def test_effective_dates_respect_leap_day_and_organisation_local_midnight(self):
        from datetime import datetime,timezone
        from unittest.mock import patch
        from apps.tax.configuration import local_today,version_on
        self.org.timezone='Asia/Tokyo';self.org.save(update_fields=['timezone'])
        components=deepcopy(self.sales.versions.get().components);components[0]['rate']='16'
        version=draft_version(organisation=self.org,user=self.user,code=self.sales,effective_from=date(2028,2,29),effective_to=None,classification='STANDARD',components=components,rules={},source='Synthetic leap-day rule',reason='Local tax point test')
        version=approve_version(organisation=self.org,user=self.user,version=version)
        with patch('apps.tax.configuration.timezone.now',return_value=datetime(2028,2,28,23,30,tzinfo=timezone.utc)):
            self.assertEqual(local_today(self.org),date(2028,2,29))
            version=activate_version(organisation=self.org,user=self.user,version=version,confirmed=True)
            self.assertEqual(version.status,'ACTIVE')
        self.assertEqual(version_on(self.org,self.sales,date(2028,2,28)).components[0]['rate'],'15')
        for point in [date(2028,2,29),date(2028,3,1)]:self.assertEqual(version_on(self.org,self.sales,point).pk,version.pk)


    def test_workpaper_pdf_evidence_and_invalid_reference_handling(self):
        from io import BytesIO
        from pypdf import PdfReader
        from django.core.files.uploadedfile import SimpleUploadedFile
        from apps.tax.models import TaxPeriod, TaxExport
        from apps.tax.returns import prepare_return,transition_return
        approve_invoice(invoice=self.invoice(),user=self.user)
        period=TaxPeriod.objects.create(organisation=self.org,start_date=date(2026,2,1),end_date=date(2026,2,28))
        result=prepare_return(organisation=self.org,user=self.user,period=period)
        transition_return(organisation=self.org,user=self.user,tax_return=result,target='REVIEWED',reason='Reconciled review')
        response=self.client.post(f'/api/v1/tax/returns/{result.pk}/workpaper-export/',{'format':'pdf'},format='json')
        self.assertEqual(response.status_code,200,response.data if hasattr(response,'data') else response.status_code)
        self.assertTrue(response.content.startswith(b'%PDF-'))
        text=''.join(page.extract_text() for page in PdfReader(BytesIO(response.content)).pages)
        self.assertIn('VAT review workpaper',text);self.assertIn('Reconciliation difference',text)
        self.assertNotIn(str(result.pk),text)
        self.assertIn('revision 1',text)
        for row in result.snapshot.get('transactions', []):
            if row.get('journal_id'):
                self.assertNotIn(str(row['journal_id']),text)
        self.assertEqual(TaxExport.objects.count(),1)
        evidence=self.client.post(f'/api/v1/tax/returns/{result.pk}/evidence/',{'acknowledgement':'TEST-ACK','file':SimpleUploadedFile('review.pdf',response.content,content_type='application/pdf')},format='multipart')
        self.assertEqual(evidence.status_code,201,evidence.data)
        download=self.client.get(f"/api/v1/tax/returns/evidence/{evidence.data['id']}/download/")
        self.assertEqual(download.content,response.content)
        self.assertEqual(self.client.get('/api/v1/tax/returns/not-a-uuid/').status_code,400)
        result.refresh_from_db();self.assertEqual(result.status,'REVIEWED')


    def test_foreign_currency_original_snapshot_survives_later_rate_and_reversal(self):
        from apps.fx.models import Currency,ExchangeRate
        from apps.finance.services.corrections.reverse_document import reverse_document
        for code in ['USD','GHS']:Currency.objects.get_or_create(code=code,defaults={'name':code,'symbol':code})
        ExchangeRate.objects.create(organisation=self.org,base_currency_id='USD',target_currency_id='GHS',rate='12.5',effective_date=date(2026,1,1),source='Synthetic FX fixture')
        invoice=create_invoice(organisation=self.org,user=self.user,customer=self.customer,invoice_number='USD-TAX',issue_date=date(2026,2,1),due_date=date(2026,2,28),currency='USD',lines=[{'description':'USD supply','quantity':1,'unit_price':1000,'revenue_account':self.revenue,'tax_code':self.sales}])
        invoice=approve_invoice(invoice=invoice,user=self.user)
        snapshot=DocumentTaxSnapshot.objects.get(source_id=invoice.pk);checksum=snapshot.checksum
        self.assertEqual(snapshot.currency,'USD');self.assertEqual(invoice.accounting_journal.lines.get(account=self.ar).debit,Decimal('15000'))
        components=deepcopy(self.sales.versions.get().components);components[0]['rate']='16'
        version=draft_version(organisation=self.org,user=self.user,code=self.sales,effective_from=date(2027,1,1),effective_to=None,classification='STANDARD',components=components,rules={},source='Synthetic future law',reason='Reversal history test')
        version=approve_version(organisation=self.org,user=self.user,version=version);activate_version(organisation=self.org,user=self.user,version=version,confirmed=True)
        reverse_document(organisation=self.org,document=invoice,user=self.user,reversal_date=date(2027,1,2),reason='Original supply cancelled')
        old=vat_workpaper(self.org,date(2026,2,1),date(2026,2,28));reverse=vat_workpaper(self.org,date(2027,1,1),date(2027,1,31))
        self.assertTrue(old['reconciled'],old);self.assertTrue(reverse['reconciled'],reverse)
        self.assertEqual(old['net_payable'],Decimal('2500'));self.assertEqual(reverse['net_payable'],Decimal('-2500'))
        snapshot.refresh_from_db();self.assertEqual(snapshot.checksum,checksum)

    def test_zero_cash_return_clears_both_sides_without_bank_line(self):
        from apps.tax.models import TaxPeriod
        from apps.tax.returns import prepare_return,transition_return
        from apps.tax.operations import post_payment,settlement_controls
        approve_invoice(invoice=self.invoice(),user=self.user)
        bill=create_bill(organisation=self.org,user=self.user,supplier=self.customer,bill_number='NET-ZERO',issue_date=date(2026,2,2),due_date=date(2026,2,2),currency='GHS',lines=[{'description':'Cost','quantity':1,'unit_price':1000,'expense_account':self.expense,'tax_code':self.purchases}])
        approve_bill(bill=bill,user=self.user)
        period=TaxPeriod.objects.create(organisation=self.org,start_date=date(2026,2,1),end_date=date(2026,2,28))
        result=prepare_return(organisation=self.org,user=self.user,period=period)
        for status in ['REVIEWED','APPROVED','FILED']:result=transition_return(organisation=self.org,user=self.user,tax_return=result,target=status,reason='Synthetic zero-cash settlement',acknowledgement='TEST-ZERO')
        allocations=[{'account_id':key,'amount':str(abs(value))} for key,value in settlement_controls(result).items()]
        payment=post_payment(organisation=self.org,user=self.user,tax_return=result,point=date(2026,3,1),bank_account_id=None,amount='0',reference='TEST-NONCASH-CLEARING',allocations=allocations)
        self.assertEqual(payment.journal.lines.count(),6);self.assertFalse(payment.journal.lines.filter(account=self.bank).exists())
        self.assertFalse(any(settlement_controls(result).values()))
        self.assertTrue(vat_workpaper(self.org,date(2026,3,1),date(2026,3,31))['reconciled'])

    def test_preset_publication_and_adoption_are_explicit_and_preserve_mappings(self):
        import json,tempfile
        from io import StringIO
        from django.core.management import call_command,CommandError
        from apps.tax.models import TaxRegimeVersion,TaxConfigurationAudit
        self.user.is_staff=True;self.user.save(update_fields=['is_staff'])
        payload={'version':'SYNTHETIC-2027','effective_from':'2027-01-01','source_checked_on':'2026-01-01','source':'https://gra.gov.gh/domestic-tax/tax-types/vat/','verified':True,'review_note':'Synthetic command test, not a statutory publication','components':deepcopy(VAT_COMPONENTS)}
        payload['components'][0]['rate']='16'
        before=TaxRateVersion.objects.count()
        with tempfile.NamedTemporaryFile(mode='w',suffix='.json') as file:
            json.dump(payload,file);file.flush()
            call_command('publish_ghana_tax_preset',file.name,reviewer=str(self.user.pk),stdout=StringIO())
            self.assertFalse(TaxRegimeVersion.objects.filter(version=payload['version']).exists())
            call_command('publish_ghana_tax_preset',file.name,reviewer=str(self.user.pk),publish=True,stdout=StringIO())
            with self.assertRaises(CommandError):call_command('publish_ghana_tax_preset',file.name,reviewer=str(self.user.pk),publish=True,stdout=StringIO())
        self.assertEqual(TaxRateVersion.objects.count(),before)
        preset=TaxRegimeVersion.objects.get(version=payload['version'])
        data={'preset_id':str(preset.pk),'code_id':str(self.sales.pk),'effective_from':'2027-01-01','decision':'PREVIEW'}
        preview=self.client.post('/api/v1/tax/configuration/adopt/',data,format='json')
        self.assertEqual(preview.status_code,200,preview.data);self.assertEqual(preview.data['current']['gross_amount'],'1200.00');self.assertEqual(preview.data['proposed']['gross_amount'],'1210.00')
        self.assertEqual(TaxRateVersion.objects.count(),before)
        adopted=self.client.post('/api/v1/tax/configuration/adopt/',{**data,'decision':'SCHEDULE','confirmed':True,'reason':'Reviewed synthetic adoption'},format='json')
        self.assertEqual(adopted.status_code,201,adopted.data)
        version=TaxRateVersion.objects.get(pk=adopted.data['id']);self.assertEqual(version.status,'DRAFT')
        self.assertEqual(version.components[0]['output_account'],self.mappings['OUTPUT_VAT'])
        self.assertEqual(self.invoice('STILL-CURRENT',date(2027,1,1)).total,Decimal('1200'))
        self.assertTrue(TaxConfigurationAudit.objects.filter(event='PRESET_ADOPTION_DRAFTED',organisation=self.org).exists())


    def test_remittance_reversal_restores_allocations_without_rewriting_filed_return(self):
        from apps.tax.models import TaxPeriod,TaxConfigurationAudit
        from apps.tax.returns import prepare_return,transition_return
        from apps.tax.operations import post_payment,settlement_controls
        from apps.accounting.services.journals import reverse_journal_entry
        approve_invoice(invoice=self.invoice(),user=self.user)
        period=TaxPeriod.objects.create(organisation=self.org,start_date=date(2026,2,1),end_date=date(2026,2,28))
        result=prepare_return(organisation=self.org,user=self.user,period=period)
        for status in ['REVIEWED','APPROVED','FILED']:result=transition_return(organisation=self.org,user=self.user,tax_return=result,target=status,reason='Synthetic remittance correction',acknowledgement='TEST-ACK')
        original_checksum=result.checksum
        allocations=[{'account_id':key,'amount':str(abs(value))} for key,value in settlement_controls(result).items()]
        kwargs=dict(organisation=self.org,user=self.user,tax_return=result,point=date(2026,3,1),bank_account_id=self.bank.pk,amount='200',reference='TEST-PAY',allocations=allocations)
        payment=post_payment(**kwargs)
        with self.assertRaisesMessage(Exception,'generic journal'):reverse_journal_entry(payment.journal,self.user,date(2026,3,2))
        data={'payment_id':str(payment.pk),'date':'2026-03-02','reason':'Duplicate bank record corrected','confirmed':True}
        url=f'/api/v1/tax/returns/{result.pk}/reverse-payment/'
        first=self.client.post(url,data,format='json');second=self.client.post(url,data,format='json')
        self.assertEqual(first.status_code,200,first.data);self.assertEqual(first.data,second.data)
        result.refresh_from_db();self.assertEqual(result.status,'FILED');self.assertEqual(result.checksum,original_checksum)
        self.assertEqual(sum(settlement_controls(result).values()),Decimal('200'))
        self.assertTrue(vat_workpaper(self.org,date(2026,3,1),date(2026,3,31))['reconciled'])
        replacement=post_payment(**{**kwargs,'point':date(2026,3,3),'reference':'TEST-REPLACEMENT'})
        self.assertNotEqual(replacement.pk,payment.pk);self.assertFalse(any(settlement_controls(result).values()))
        self.assertEqual(TaxConfigurationAudit.objects.filter(event='TAX_PAYMENT_REVERSED',organisation=self.org).count(),1)


from django.test import TransactionTestCase

class TaxActivationConcurrencyTests(TransactionTestCase):
    def test_competing_activations_have_one_winner_without_overlapping_windows(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from django.db import close_old_connections, connections
        from apps.tax.models import TaxApplicabilityRule
        fixture=JurisdictionIntegrationTests();fixture.setUp()
        versions=[]
        initial=fixture.sales.versions.get().components
        for rate in ['16','17']:
            components=deepcopy(initial);components[0]['rate']=rate
            version=draft_version(organisation=fixture.org,user=fixture.user,code=fixture.sales,effective_from=date(2027,1,1),effective_to=None,classification='STANDARD',components=components,rules={},source='Synthetic future verification',reason='Concurrent activation fixture')
            versions.append(approve_version(organisation=fixture.org,user=fixture.user,version=version))
        barrier=Barrier(2)
        def activate(version):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                activate_version(organisation=fixture.org,user=fixture.user,version=version,confirmed=True)
                return 'activated'
            except Exception as error:
                from common.exceptions import BusinessRuleError
                if not isinstance(error,BusinessRuleError):raise
                return 'rejected'
            finally:connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(activate,versions))
        self.assertEqual(sorted(results),['activated','rejected'])
        self.assertEqual(TaxApplicabilityRule.objects.filter(organisation=fixture.org,code=fixture.sales,start=date(2027,1,1)).count(),1)
