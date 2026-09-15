"""Document privacy, accounting values and mail acceptance, using no external SMTP."""
import io
import uuid
from unittest.mock import patch
from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from apps.accounting import test_phase2_history as fixtures
from apps.organisations.models import Organisation, OrganisationMember
from apps.sales.models import InvoiceEmailAttempt
from common.documents import document_contract, render_pdf

@override_settings(DEBUG=True,EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',DEFAULT_FROM_EMAIL='invoices@example.com',INVOICE_EMAIL_USER_RATE='1000/h',INVOICE_EMAIL_ORGANISATION_RATE='1000/h')
class DocumentTests(TestCase):
    def setUp(self):
        fixtures.HistoricalControlTests.setUp(self)
        cache.clear()
        self.customer.email='customer@example.com';self.customer.save()
        self.org.name='Accra Trading';self.org.country_code='GH';self.org.payment_instructions='Mobile money: saved collection instructions';self.org.save()
        self.invoice=fixtures.HistoricalControlTests.invoice(self)
        self.client=APIClient();self.client.force_authenticate(self.user);self.client.credentials(HTTP_X_ORGANISATION_ID=str(self.org.pk))
    def send(self,**kwargs):
        return self.client.post(f'/api/v1/invoices/{self.invoice.pk}/email/',{'subject':'Invoice INV','message':'Thank you',**kwargs},format='json',HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()))
    def test_contract_and_pdf_are_private_and_match(self):
        response=self.client.get(f'/api/v1/documents/invoice/{self.invoice.pk}/');self.assertEqual(response.status_code,200)
        self.assertEqual(response.data['organisation']['name'],'Accra Trading');self.assertEqual(response.data['currency'],'GHS');self.assertIn(['Total','120.00'],response.data['totals'])
        pdf=self.client.get(f'/api/v1/documents/invoice/{self.invoice.pk}/pdf/');self.assertEqual(pdf.status_code,200);self.assertTrue(pdf.content.startswith(b'%PDF'))
        self.assertEqual(pdf['Cache-Control'],'private, no-store')
        other=Organisation.objects.create(name='Other',base_currency='GBP',created_by=self.user)
        OrganisationMember.objects.create(organisation=other,user=self.user,role='owner')
        self.client.credentials(HTTP_X_ORGANISATION_ID=str(other.pk))
        self.assertEqual(self.client.get(f'/api/v1/documents/invoice/{self.invoice.pk}/pdf/').status_code,404)
        self.assertEqual(self.send().status_code,404)
    def test_email_acceptance_attachment_and_safe_content(self):
        result=self.send(message='<script>alert(1)</script> & Thank you',company={'name':'Forged company'},total='0.01',pdf='untrusted bytes')
        self.assertEqual(result.status_code,200);self.assertEqual(result.data['status'],'sent')
        self.assertEqual(len(mail.outbox),1);self.assertNotIn('<script>',mail.outbox[0].alternatives[0].content)
        self.assertIn('<script>',mail.outbox[0].body)
        self.assertEqual(mail.outbox[0].attachments[0].content,self.client.get(f'/api/v1/documents/invoice/{self.invoice.pk}/pdf/').content)
        self.invoice.refresh_from_db();self.assertEqual(self.invoice.status,'approved')
    def test_replay_and_changed_payload_conflict(self):
        key=str(uuid.uuid4());url=f'/api/v1/invoices/{self.invoice.pk}/email/'
        first=self.client.post(url,{'subject':'Invoice'},format='json',HTTP_IDEMPOTENCY_KEY=key)
        second=self.client.post(url,{'subject':'Invoice'},format='json',HTTP_IDEMPOTENCY_KEY=key)
        self.assertEqual(first.data,second.data);self.assertEqual(len(mail.outbox),1)
        self.assertEqual(self.client.post(url,{'subject':'Changed'},format='json',HTTP_IDEMPOTENCY_KEY=key).status_code,409)
    def test_header_injection_and_missing_details(self):
        for values in ({'subject':'Invoice\nBcc: bad@example.com'},{'recipient':'x@example.com\r\nBcc: bad@example.com'},{'recipient':'invalid'}):
            self.assertEqual(self.send(**values).status_code,400)
        self.customer.email='';self.customer.save();self.assertEqual(self.send().status_code,400)
        self.assertEqual(InvoiceEmailAttempt.objects.count(),0)
    def test_failures_never_change_invoice(self):
        import smtplib
        for error,category in [(smtplib.SMTPRecipientsRefused({}),'recipient_rejected'),(OSError('secret provider response'),'transport_unknown')]:
            with patch('django.core.mail.EmailMultiAlternatives.send',side_effect=error):result=self.send()
            self.assertEqual(result.status_code,502);self.assertEqual(result.data['failure_category'],category)
            self.assertNotIn('secret',str(result.data))
        self.invoice.refresh_from_db();self.assertEqual(self.invoice.status,'approved')
    @override_settings(DEBUG=False)
    def test_console_and_locmem_cannot_claim_production_success(self):
        self.assertEqual(self.send().data['failure_category'],'configuration')
    def test_permission_and_state(self):
        member=OrganisationMember.objects.get(organisation=self.org,user=self.user);member.role='viewer';member.save()
        self.assertEqual(self.send().status_code,403)
        member.role='owner';member.save()
        draft=fixtures.HistoricalControlTests.invoice(self,number='DRAFT',approve=False);self.invoice=draft
        self.assertEqual(self.send().status_code,400)
    @override_settings(INVOICE_EMAIL_USER_RATE='1/h')
    def test_shared_cache_rate_limit(self):
        self.assertEqual(self.send().status_code,200);self.assertEqual(self.send().status_code,429)
    def test_long_multipage_document(self):
        contract=document_contract(organisation=self.org,kind='invoice',pk=self.invoice.pk)
        contract['rows']*=100;contract['rows'][0][0]='Long description '*80
        data=render_pdf(contract)
        from pypdf import PdfReader
        pages=PdfReader(io.BytesIO(data)).pages
        self.assertGreater(len(pages),2)
        for page in pages:self.assertTrue(page.extract_text().strip());self.assertIn('Page ',page.extract_text())
        self.assertIn('120.00',pages[-1].extract_text())

    def test_two_organisation_identities_and_transaction_currency(self):
        from datetime import date
        from apps.sales.services.invoices import create_invoice
        from apps.fx.models import ExchangeRate, Currency
        for code in ('GBP','GHS'):Currency.objects.get_or_create(code=code,defaults={'name':code})
        ExchangeRate.objects.create(organisation=self.org,base_currency_id='GBP',target_currency_id='GHS',rate='15',effective_date=date(2026,1,1))
        foreign=create_invoice(organisation=self.org,customer=self.customer,invoice_number="GBP-DRAFT",issue_date=date(2026,1,15),due_date=date(2026,1,31),currency="GBP",user=self.user,lines=[{"description":"Foreign service","quantity":1,"unit_price":"19.99","revenue_account":self.revenue}])
        doc=document_contract(organisation=self.org,kind="invoice",pk=foreign.pk)
        self.assertEqual(doc['currency'],'GBP');self.assertEqual(doc['organisation']['base_currency'],'GHS');self.assertIn(['Total','19.99'],doc['totals'])
        other=Organisation.objects.create(name='Bristol',base_currency='GBP',country_code='GB',created_by=self.user)
        from common.documents import identity
        self.assertEqual(identity(other)['name'],'Bristol');self.assertEqual(identity(other)['payment_instructions'],'');self.assertEqual(identity(other)['logo_data'],'')
        self.assertNotIn('Mobile money',str(identity(other)))

    def test_missing_identity_and_logo_validation(self):
        from common.documents import identity,validate_logo
        from rest_framework.exceptions import ValidationError
        self.org.name='';self.org.legal_name=''
        with self.assertRaises(ValidationError):identity(self.org)
        for value in ('https://private.internal/logo','data:image/svg+xml;base64,abc','data:image/png;base64,not-a-png'):
            with self.assertRaises(ValidationError):validate_logo(value)
        import base64
        from PIL import Image
        output=io.BytesIO();Image.new('RGB',(12,12),'blue').save(output,format='PNG')
        self.assertTrue(validate_logo('data:image/png;base64,'+base64.b64encode(output.getvalue()).decode()).startswith('data:image/png;base64,'))

    def test_source_reversal_and_locked_settled_rejections(self):
        from datetime import date
        from apps.sales.services.payments import create_customer_payment
        from apps.accounting.services.periods.period_service import lock_accounting_period
        # A successful source correction has durable audit details in its document.
        result=self.client.post(f'/api/v1/invoices/{self.invoice.pk}/reverse/',{'reversal_date':'2026-01-20','reason':'Incorrect invoice'},format='json')
        self.assertEqual(result.status_code,200)
        doc=document_contract(organisation=self.org,kind='invoice',pk=self.invoice.pk)
        self.assertEqual(doc['status'],'void');self.assertEqual(doc['correction']['reason'],'Incorrect invoice')
        settled=fixtures.HistoricalControlTests.invoice(self,number='SETTLED')
        create_customer_payment(organisation=self.org,customer=self.customer,invoice=settled,bank_account=self.bank,payment_date=date(2026,1,20),amount='10',currency='GHS',user=self.user)
        self.assertEqual(self.client.post(f'/api/v1/invoices/{settled.pk}/reverse/',{'reversal_date':'2026-01-20','reason':'No'},format='json').status_code,400)
        unsettled=fixtures.HistoricalControlTests.invoice(self,number='LOCKED')
        lock_accounting_period(period=self.period,user=self.user)
        self.assertEqual(self.client.post(f'/api/v1/invoices/{unsettled.pk}/reverse/',{'reversal_date':'2026-01-20','reason':'No'},format='json').status_code,400)

    def test_bill_credit_payment_journal_and_statement_contracts(self):
        from datetime import date
        from apps.sales.services.payments import create_customer_payment
        from apps.purchases.services.credits import create_supplier_credit
        bill=fixtures.HistoricalControlTests.bill(self)
        credit=create_supplier_credit(organisation=self.org,supplier=self.supplier,credit_number='SC',issue_date=date(2026,1,20),currency='GHS',user=self.user,lines=[{'description':'Credit','quantity':1,'unit_price':'12.34','expense_account':self.expense}])
        payment=create_customer_payment(organisation=self.org,customer=self.customer,bank_account=self.bank,payment_date=date(2026,1,20),amount='10',currency='GHS',user=self.user)
        for kind,pk in [('bill',bill.pk),('supplier-credit',credit.pk),('customer-payment',payment.pk),('journal',self.invoice.accounting_journal_id)]:
            doc=self.client.get(f'/api/v1/documents/{kind}/{pk}/');self.assertEqual(doc.status_code,200,(kind,doc.data));self.assertEqual(doc.data['organisation']['name'],'Accra Trading')
            self.assertEqual(self.client.get(f'/api/v1/documents/{kind}/{pk}/pdf/').status_code,200)
        statement=self.client.get(f'/api/v1/documents/customer-statement/{self.customer.pk}/?end_date=2026-01-31')
        self.assertEqual(statement.status_code,200);self.assertIn(['Closing balance','110.00'],statement.data['totals'])

    @override_settings(INVOICE_EMAIL_ORGANISATION_RATE='1/h')
    def test_organisation_rate_limit_applies_to_different_users(self):
        self.assertEqual(self.send().status_code,200)
        from django.contrib.auth import get_user_model
        user=get_user_model().objects.create_user(username='another-sender',email='second@example.invalid')
        OrganisationMember.objects.create(organisation=self.org,user=user,role='owner')
        self.client.force_authenticate(user)
        self.assertEqual(self.send().status_code,429)

    def test_stale_version_and_all_role_document_permissions(self):
        from apps.organisations.permissions import ROLE_PERMISSIONS
        result=self.client.get(f'/api/v1/documents/invoice/{self.invoice.pk}/pdf/?version=outdated')
        self.assertEqual(result.status_code,409)
        self.assertEqual(self.send(document_version='outdated').status_code,409)
        member=OrganisationMember.objects.get(organisation=self.org,user=self.user)
        for role,permissions in ROLE_PERMISSIONS.items():
            member.role=role;member.save()
            self.assertEqual(self.client.get(f'/api/v1/documents/invoice/{self.invoice.pk}/').status_code,200 if 'view_accounting' in permissions else 403,role)
            self.assertEqual(self.client.get(f'/api/v1/documents/invoice/{self.invoice.pk}/pdf/').status_code,200 if 'export_reports' in permissions else 403,role)
            self.assertEqual(self.send().status_code,200 if 'create_invoice' in permissions else 403,role)

from django.test import TransactionTestCase
from django.db import connection, close_old_connections, connections
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless

@skipUnless(connection.vendor=='postgresql','Requires real PostgreSQL connections')
@override_settings(DEBUG=True,EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',DEFAULT_FROM_EMAIL='invoices@example.com',INVOICE_EMAIL_USER_RATE='1000/h',INVOICE_EMAIL_ORGANISATION_RATE='1000/h')
class EmailConcurrencyTests(TransactionTestCase):
    def test_concurrent_email_submits_once(self):
        fixtures.HistoricalControlTests.setUp(self)
        self.customer.email='customer@example.com';self.customer.save();cache.clear()
        invoice=fixtures.HistoricalControlTests.invoice(self);key=str(uuid.uuid4());barrier=Barrier(2)
        def send():
            close_old_connections()
            try:
                client=APIClient();client.force_authenticate(self.user);client.credentials(HTTP_X_ORGANISATION_ID=str(self.org.pk));barrier.wait(timeout=10)
                result=client.post(f'/api/v1/invoices/{invoice.pk}/email/',{'subject':'Invoice'},format='json',HTTP_IDEMPOTENCY_KEY=key)
                return result.status_code,result.data['attempt_id']
            finally:connections.close_all()
        with patch('django.core.mail.EmailMultiAlternatives.send',return_value=1) as provider:
            with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:send(),range(2)))
        self.assertEqual(provider.call_count,1);self.assertEqual(len({r[1] for r in results}),1)
        self.assertTrue(all(r[0] in (200,202) for r in results));self.assertEqual(InvoiceEmailAttempt.objects.count(),1)
