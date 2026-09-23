"""Statement ingestion safety: parsers, API isolation and existing-ledger matching."""
import csv
import io
import json
import zipfile
from datetime import date
from decimal import Decimal
from xml.sax.saxutils import escape

from django.contrib.auth import get_user_model
from django.test import TestCase, SimpleTestCase, override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from common.accounting_test_fixtures import calendar_periods
from common.exceptions import BusinessRuleError
from apps.accounting.models import Account, JournalEntry
from apps.accounting.services.journals import create_journal_entry, post_journal_entry
from apps.organisations.models import Organisation, OrganisationMember
from apps.contacts.models import Contact
from apps.sales.models import CustomerPayment
from apps.sales.services.invoices import create_invoice, approve_invoice
from apps.sales.services.payments import create_customer_payment
from .models import BankAccount, BankTransaction, BankStatementImport
from .services.imports.csv_import import preview_bank_statement_import, commit_bank_statement_import
from .services.imports.statement_schema import detect_statement, read_statement, read_date, read_money, schema, template_csv
from .services.reconciliation import BankReconciliationMatcher
from .services.reconciliation.reconcile import accept_reconciliation_suggestion
from .services.reconciliation.summary import get_reconciliation_summary


def workbook(rows, formula=False, serial_date=False, external=False):
    """Minimal real OOXML ZIP; no third-party spreadsheet dependency."""
    stream = io.BytesIO()
    main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as out:
        out.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        out.writestr('xl/workbook.xml', f'<workbook xmlns="{main}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Statement" sheetId="1" r:id="rId1"/></sheets></workbook>')
        out.writestr('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/>' + ('<Relationship Id="rId2" Target="https://example.invalid" TargetMode="External"/>' if external else '') + '</Relationships>')
        out.writestr('xl/styles.xml', f'<styleSheet xmlns="{main}"><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>')
        cells = []
        for number, row in enumerate(rows, 1):
            columns = []
            for index, value in enumerate(row):
                ref = f'{chr(65+index)}{number}'
                if serial_date and number == 2 and index == 0:
                    columns.append(f'<c r="{ref}" s="1"><v>46288</v></c>')  # 2026-09-23
                else:
                    columns.append(f'<c r="{ref}" t="inlineStr">' + ('<f>1+1</f>' if formula and number == 2 and index == 1 else '') + f'<is><t>{escape(str(value))}</t></is></c>')
            cells.append(f'<row r="{number}">{"".join(columns)}</row>')
        out.writestr('xl/worksheets/sheet1.xml', f'<worksheet xmlns="{main}"><sheetData>{"".join(cells)}</sheetData></worksheet>')
    return stream.getvalue()


class StatementReaderTests(SimpleTestCase):
    def test_template_and_detection_share_schema(self):
        headers = next(csv.reader(io.StringIO(template_csv().lstrip('\ufeff'))))
        self.assertEqual(headers, schema()['template_headers'])
        content = (template_csv() + '2026-09-23,Receipt,R1,5000,,37500,,EXT1\n').encode()
        detected = detect_statement('current.csv', content)
        self.assertEqual(set(detected['mapping']), {'transaction_date','description','reference','credit','debit','balance','currency','external_id'})

    def test_aliases_case_spaces_punctuation_and_ambiguous_columns(self):
        content = b' Posting-Date ,NARRATIVE,Payment Reference, Credits ,Withdrawals,Running Balance,CCY,Bank Transaction ID\n23/09/2026,Receipt,R,5,,10,GHS,X\n'
        result = detect_statement('bank.csv', content)
        self.assertEqual(len(result['mapping']), 8)
        self.assertEqual(result['mapping']['transaction_date'], 'Posting-Date')
        ambiguous = detect_statement('bank.csv', b'Date,Value Date,Description,Amount\n2026-09-23,2026-09-23,Receipt,5\n')
        self.assertNotIn('transaction_date', ambiguous['mapping'])
        self.assertIn('Date', ambiguous['ambiguous_fields'])

    def test_supported_dates_and_explicit_ambiguity(self):
        for value in ['23/09/2026', '2026-09-23', '23-09-2026', '23 Sep 2026']:
            with self.subTest(value=value): self.assertEqual(read_date(value, 'auto'), date(2026,9,23))
        with self.assertRaisesMessage(ValueError, 'ambiguous'): read_date('09/10/2026', 'auto')
        self.assertEqual(read_date('09/10/2026', '%d/%m/%Y'), date(2026,10,9))
        self.assertEqual(read_date('09/10/2026', '%m/%d/%Y'), date(2026,9,10))
        with self.assertRaises(ValueError): read_date('31/02/2026', 'auto')

    def test_decimal_and_large_amounts_are_exact(self):
        self.assertEqual(read_money('9,999,999,999,999,999.99'), Decimal('9999999999999999.99'))
        self.assertEqual(read_money('-0.01'), Decimal('-.01'))
        for value in ['1,23', '1.001', 'NaN', 'Infinity', '=2+2', 'GHS 5', '1e3', '10000000000000000']:
            with self.subTest(value=value), self.assertRaises(ValueError): read_money(value)

    def test_csv_delimiters_quotes_and_structural_errors(self):
        result = read_statement('bank.csv', b'Date;Description;Amount\n2026-09-23;"Receipt; customer";5.00\n2026-09-23;Broken\n')
        self.assertEqual(result[1][0][1]['Description'], 'Receipt; customer')
        self.assertIn('number of values', result[1][1][2])
        for content in [b'\xffbad', b'Date,Description\n"unterminated', b'Date,Date\n1,2', b'Date,\n1,2', b'Date,Description\n']:
            with self.subTest(content=content), self.assertRaises(BusinessRuleError): read_statement('bad.csv', content)

    def test_xlsx_reader_and_native_excel_date(self):
        content = workbook([['Date','Description','Credit','Debit'],['2026-09-23','Receipt','5','']], serial_date=True)
        result = detect_statement('bank.xlsx', content)
        self.assertEqual(result['sample_rows'][0]['Date'], '2026-09-23')
        self.assertEqual(result['file_type'], 'xlsx')

    def test_xlsx_formulas_external_links_and_malformed_rejected(self):
        for content in [b'not a zip', b'PK\x03\x04broken', workbook([['Date','Description'],['x','y']], formula=True), workbook([['Date','Description'],['x','y']], external=True)]:
            with self.subTest(size=len(content)), self.assertRaises(BusinessRuleError): read_statement('bad.xlsx', content)

    def test_xlsx_macro_entities_and_archive_limits_rejected(self):
        def package(name, value):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as out:
                out.writestr(name, value)
            return stream.getvalue()
        for name, value in [
            ('xl/vbaProject.bin', b'macro'),
            ('xl/workbook.xml', b'<!DOCTYPE x [<!ENTITY y "bad">]><x>&y;</x>'),
            ('xl/workbook.xml', '<x/>'.encode('utf-16')),
            ('oversized.xml', b' '* (32*1024*1024+1)),
        ]:
            with self.subTest(name=name, size=len(value)), self.assertRaises(BusinessRuleError):
                read_statement('unsafe.xlsx', package(name, value))

    def test_mime_signatures_and_unsupported_formats(self):
        for filename,content,mime in [('bad.csv', b'MZexe','text/csv'),('bad.csv',b'%PDF-1.7','text/csv'),('bad.csv',b'Date,Description\nx,y','application/pdf'),('bad.xlsx',b'Date,Description','text/csv')]:
            with self.subTest(filename=filename), self.assertRaises(BusinessRuleError): read_statement(filename,content,mime)
        for suffix in ['pdf','xls','ofx','qfx','qif','exe']:
            with self.subTest(suffix=suffix), self.assertRaises(BusinessRuleError): read_statement(f'file.{suffix}', b'x')

    @override_settings(BANK_IMPORT_MAX_ROWS=2, BANK_IMPORT_MAX_BYTES=100)
    def test_limits(self):
        with self.assertRaisesMessage(BusinessRuleError, 'row limit'): read_statement('bank.csv', b'A,B\n1,2\n3,4\n5,6\n')
        with self.assertRaisesMessage(BusinessRuleError, 'size limit'): read_statement('bank.csv', b'x'*101)


class StatementImportTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='statement', email='statement@example.test', password='synthetic-test')
        self.org = Organisation.objects.create(name='Statement test', base_currency='GHS', created_by=self.user)
        OrganisationMember.objects.create(organisation=self.org, user=self.user, role='owner')
        calendar_periods(self.org)
        self.ledger = self.account('1100', 'asset', 'bank')
        self.bank = BankAccount.objects.create(organisation=self.org, ledger_account=self.ledger, name='Main Current Account', currency='GHS', created_by=self.user)
        self.api = APIClient(); self.api.force_authenticate(self.user); self.api.credentials(HTTP_X_ORGANISATION_ID=str(self.org.id))

    def account(self, code, kind, classification):
        return Account.objects.create(organisation=self.org, code=code, name=code, account_type=kind, account_class=classification, currency='GHS', created_by=self.user)

    def preview(self, content, **kwargs):
        if isinstance(content,str): content=content.encode()
        filename = kwargs.pop('file_name', 'statement.csv')
        mapping = kwargs.pop('mapping', detect_statement(filename, content)['mapping'])
        return preview_bank_statement_import(organisation=self.org,bank_account=self.bank,file_name=filename,content=content,mapping=mapping,user=self.user,date_format=kwargs.pop('date_format','auto'),amount_sign=kwargs.pop('amount_sign',''),**kwargs)

    def commit(self,batch):
        return commit_bank_statement_import(organisation=self.org,import_batch=batch,user=self.user)

    def test_current_template_populated_and_imported(self):
        batch=self.preview(template_csv()+'2026-09-23,Receipt,R1,5000,,37500,,EXT1\n')
        self.assertEqual(batch.rows.get().status,'ready')
        self.commit(batch)
        row=BankTransaction.objects.get();self.assertEqual(row.currency,'GHS');self.assertEqual(row.amount,Decimal('5000'))
        self.assertEqual(JournalEntry.objects.count(),0)

    def test_arbitrary_credit_debit_and_manual_mapping(self):
        batch=self.preview('When,What,In,Out\n23/09/2026,Receipt,10.21,\n2026-09-23,Fee,,0.21\n',mapping={'transaction_date':'When','description':'What','credit':'In','debit':'Out'})
        self.commit(batch)
        self.assertEqual(set(BankTransaction.objects.values_list('transaction_type','amount')), {('money_in',Decimal('10.21')),('money_out',Decimal('.21'))})

    def test_amount_transaction_type_cr_dr_conventions(self):
        values=['Credit','CR','Money In','Deposit','Debit','DR','Money Out','Withdrawal']
        batch=self.preview('Date,Description,Amount,Transaction Type\n'+''.join(f'2026-09-23,Row {i},5,{kind}\n' for i,kind in enumerate(values)))
        self.assertEqual(batch.rejected_rows,0)
        self.assertEqual(list(batch.rows.order_by('row_number').values_list('transaction_type',flat=True)),['money_in']*4+['money_out']*4)

    def test_signed_amount_requires_choice_and_supports_both_conventions(self):
        content='Date,Description,Amount\n2026-09-23,Receipt,5\n2026-09-23,Fee,-2\n'
        self.assertEqual(self.preview(content).rejected_rows,2)
        for choice,directions in [('positive_in',['money_in','money_out']),('positive_out',['money_out','money_in'])]:
            batch=self.preview(content,amount_sign=choice)
            self.assertEqual(list(batch.rows.order_by('row_number').values_list('transaction_type',flat=True)),directions)

    def test_ambiguous_dates_require_review(self):
        content='Date,Description,Credit\n09/10/2026,Receipt,5\n'
        self.assertIn('ambiguous',self.preview(content).rows.get().error_message)
        self.assertEqual(self.preview(content,date_format='%d/%m/%Y').rows.get().transaction_date,date(2026,10,9))

    def test_bad_and_missing_mapping_rejected_before_batch(self):
        content='Date,Description,Amount,Credit\n2026-09-23,Receipt,5,5\n'
        for mapping in [{},{'transaction_date':'Date','description':'Missing','amount':'Amount'},{'transaction_date':'Date','description':'Description','amount':'Amount','credit':'Credit'},{'transaction_date':'Date','description':'Date','amount':'Amount'}]:
            with self.subTest(mapping=mapping),self.assertRaises(BusinessRuleError):self.preview(content,mapping=mapping)
        self.assertEqual(BankStatementImport.objects.count(),0)

    def test_currency_default_mismatch_and_partial_validation(self):
        batch=self.preview('Date,Description,Credit,Currency\n2026-09-23,Valid,5,\n2026-09-23,Wrong,5,USD\n,Missing date,5,GHS\n2026-09-23,Bad money,NaN,GHS\n')
        self.assertEqual(batch.rejected_rows,3)
        self.assertEqual(batch.rows.get(description='Valid').currency,'GHS')
        self.assertIn('Currency USD',batch.rows.get(description='Wrong').error_message)
        self.assertEqual(batch.rows.get(description='Bad money').source_data['Credit'],'NaN')
        self.commit(batch);self.assertEqual(BankTransaction.objects.count(),1)

    def test_invalid_type_conflicting_amounts_and_zero(self):
        for content in ['Date,Description,Amount,Type\n2026-09-23,X,5,ABC\n','Date,Description,Amount,Type\n2026-09-23,X,-5,CR\n','Date,Description,Credit,Debit\n2026-09-23,X,5,5\n','Date,Description,Credit\n2026-09-23,X,0\n','Date,Description,Credit\n2026-09-23,X,-5\n']:
            with self.subTest(content=content):
                row=self.preview(content).rows.get();self.assertEqual(row.status,'rejected');self.assertTrue(row.error_message)

    def test_xlsx_import(self):
        batch=self.preview(workbook([['Date','Description','Credit','Debit'],['2026-09-23','Receipt','123.45','']]),file_name='bank.xlsx')
        self.commit(batch);self.assertEqual(BankTransaction.objects.get().amount,Decimal('123.45'))

    def test_possible_duplicate_same_values_and_exact_external_id(self):
        content='Date,Description,Credit,External ID\n2026-09-23,Receipt,5,X1\n2026-09-23,Receipt,5,X1\n2026-09-23,Receipt,5,\n'
        batch=self.preview(content)
        self.assertEqual(list(batch.rows.order_by('row_number').values_list('duplicate_kind',flat=True)),['','exact','possible'])
        self.commit(batch);self.assertEqual(BankTransaction.objects.count(),1)
        second=self.preview(content);self.assertEqual(second.duplicate_rows,3)
        altered=self.preview('Date,Description,Credit,External ID\n2026-09-24,Changed text,10,X1\n')
        self.assertEqual(altered.rows.get().duplicate_kind,'exact')

    def test_independent_previews_recheck_duplicates_at_commit_and_retry(self):
        content='Date,Description,Credit\n2026-09-23,Receipt,5\n'
        first=self.preview(content);second=self.preview(content)
        self.commit(first);self.commit(second);self.commit(first)
        second.refresh_from_db();self.assertEqual(second.duplicate_rows,1)
        self.assertEqual(BankTransaction.objects.count(),1)

    def test_changed_bank_currency_or_status_blocks_commit(self):
        batch=self.preview('Date,Description,Credit\n2026-09-23,Receipt,5\n')
        self.bank.currency='GBP';self.bank.save(update_fields=['currency'])
        with self.assertRaisesMessage(BusinessRuleError,'currency changed'):self.commit(batch)
        self.bank.status='inactive';self.bank.save(update_fields=['status'])
        with self.assertRaisesMessage(BusinessRuleError,'no longer active'):self.commit(batch)
        self.assertEqual(BankTransaction.objects.count(),0)

    def test_opening_receipt_closing_reconcile_without_duplicate_ledger(self):
        self.bank.opening_balance=Decimal('32500');self.bank.opening_balance_date=date(2026,9,22);self.bank.save()
        equity=self.account('3000','equity','equity')
        opening=create_journal_entry(organisation=self.org,date=date(2026,9,22),description='Existing opening balance',user=self.user,lines=[{'account':self.ledger,'debit':'32500','credit':'0'},{'account':equity,'debit':'0','credit':'32500'}])
        post_journal_entry(journal_entry=opening,user=self.user)
        self.account('1200','asset','receivable');revenue=self.account('4000','revenue','sales')
        customer=Contact.objects.create(organisation=self.org,name='Accra Business Solutions Ltd',is_customer=True,currency='GHS',created_by=self.user)
        invoice=create_invoice(organisation=self.org,customer=customer,invoice_number='ABS-PO-001',issue_date=date(2026,9,23),due_date=date(2026,10,23),currency='GHS',user=self.user,lines=[{'description':'Services','quantity':'1','unit_price':'5000','discount_amount':'0','tax_rate':'0','revenue_account':revenue}])
        approve_invoice(invoice=invoice,user=self.user)
        payment=create_customer_payment(organisation=self.org,customer=customer,invoice=invoice,bank_account=self.ledger,payment_date=date(2026,9,23),amount='5000',currency='GHS',reference='ABS-PO-001',user=self.user)
        journals=list(JournalEntry.objects.values('id','status','date','description'));payments=CustomerPayment.objects.count()
        batch=self.preview('Date,Description,Reference,Money In,Money Out,Balance\n2026-09-22,Opening Balance,,,,32500\n2026-09-23,Accra Business Solutions Ltd,ABS-PO-001,5000,,37500\n2026-09-23,Closing Balance,,,,37500\n')
        self.assertEqual(batch.metadata['information_rows'],2);self.commit(batch)
        row=BankTransaction.objects.get()
        suggestions=BankReconciliationMatcher(organisation=self.org,bank_transaction=row).find_customer_payment_matches()
        self.assertIn(str(payment.id),[item.object_id for item in suggestions])
        self.assertEqual(row.status,'unreconciled')
        accept_reconciliation_suggestion(organisation=self.org,bank_transaction=row,match_type='customer_payment',object_id=payment.id,user=self.user)
        summary=get_reconciliation_summary(organisation=self.org,bank_account=self.bank,reconciliation_date=date(2026,9,23))
        self.assertEqual(summary['book_balance'],Decimal('37500'));self.assertEqual(summary['statement_balance'],Decimal('37500'));self.assertEqual(summary['difference'],Decimal('0'));self.assertTrue(summary['complete'])
        self.assertEqual(list(JournalEntry.objects.values('id','status','date','description')),journals)
        self.assertEqual(CustomerPayment.objects.count(),payments)
        self.bank.refresh_from_db();self.assertEqual(self.bank.opening_balance,Decimal('32500'))

    def upload(self, content, **data):
        return {'bank_account_id':str(self.bank.id),'file':SimpleUploadedFile('statement.csv',content.encode(),content_type='text/csv'),**data}

    def test_api_detect_preview_paginate_commit_and_history(self):
        self.assertEqual(self.api.get('/api/v1/bank-imports/schema/').status_code,200)
        template=self.api.get('/api/v1/bank-imports/template/');self.assertEqual(template.content.decode(),template_csv())
        content='Date,Description,Credit\n'+''.join(f'2026-09-23,Receipt {i},5\n' for i in range(105))
        detected=self.api.post('/api/v1/bank-imports/detect/',self.upload(content),format='multipart');self.assertEqual(detected.status_code,200,detected.data)
        response=self.api.post('/api/v1/bank-imports/preview/',self.upload(content,mapping=json.dumps(detected.data['mapping'])),format='multipart')
        self.assertEqual(response.status_code,201,response.data);self.assertEqual(len(response.data['rows']),100)
        url=f"/api/v1/bank-imports/{response.data['id']}/"
        page=self.api.get(url+'rows/?page=2');self.assertEqual(len(page.data['results']),5)
        self.assertEqual(self.api.get(url+'rows/?status=rejected').data['count'],0)
        result=self.api.post(url+'commit/',{},format='json');self.assertEqual(result.status_code,200,result.data);self.assertEqual(result.data['imported_rows'],105)
        self.assertEqual(self.api.get('/api/v1/bank-imports/').data[0]['rows'],[])

    def test_cross_organisation_account_batch_and_header_rejected(self):
        batch=self.preview('Date,Description,Credit\n2026-09-23,Receipt,5\n')
        outsider=get_user_model().objects.create_user(username='outsider')
        other=Organisation.objects.create(name='Other',base_currency='GHS',created_by=outsider)
        OrganisationMember.objects.create(organisation=other,user=outsider,role='owner')
        self.api.force_authenticate(outsider);self.api.credentials(HTTP_X_ORGANISATION_ID=str(other.id))
        for action in ['detect','preview']:
            response=self.api.post(f'/api/v1/bank-imports/{action}/',self.upload('Date,Description,Credit\n2026-09-23,Receipt,5\n'),format='multipart');self.assertEqual(response.status_code,400)
        for suffix in ['', 'rows/']:
            self.assertEqual(self.api.get(f'/api/v1/bank-imports/{batch.id}/{suffix}').status_code,404)
        self.assertEqual(self.api.post(f'/api/v1/bank-imports/{batch.id}/commit/',{},format='json').status_code,404)
        self.api.credentials(HTTP_X_ORGANISATION_ID=str(self.org.id))
        self.assertEqual(self.api.get('/api/v1/bank-imports/').status_code,403)
        self.assertEqual(BankTransaction.objects.count(),0)

    def test_import_permission_required(self):
        membership=OrganisationMember.objects.get(user=self.user,organisation=self.org);membership.role='viewer';membership.save()
        self.assertEqual(self.api.get('/api/v1/bank-imports/template/').status_code,403)
        self.assertEqual(self.api.post('/api/v1/bank-imports/detect/',self.upload('Date,Description,Credit\n2026-09-23,Receipt,5\n'),format='multipart').status_code,403)
