"""Separate-connection PostgreSQL races; SQLite is explicitly insufficient."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from unittest import skipUnless
from uuid import uuid4
from datetime import date
from django.db import connection, connections, close_old_connections, transaction, DatabaseError
from django.test import TransactionTestCase
from rest_framework.test import APIClient
from . import test_phase2_integrity as fixtures
from .models import JournalEntry, Account, AccountingPeriod
from .services.journals import create_journal_entry, post_journal_entry
from .services.periods.period_service import lock_accounting_period
from common.exceptions import BusinessRuleError
from common.ledger_integrity import lock_ledger


@skipUnless(connection.vendor == "postgresql", "Requires real PostgreSQL connections and database triggers")
class PostgreSQLConcurrencyTests(TransactionTestCase):
    setUp = fixtures.AccountingIntegrityTests.setUp
    journal = fixtures.AccountingIntegrityTests.journal

    def parallel(self, *functions):
        barrier = Barrier(len(functions))
        def run(function):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return function()
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=len(functions)) as pool:
            futures = [pool.submit(run, function) for function in functions]
            return [future.result(timeout=30) for future in futures]

    def test_raw_sql_cannot_edit_posted_header_or_line(self):
        journal = self.journal()
        for sql, params in [
            ("UPDATE accounting_journalentry SET description='tampered' WHERE id=%s", [journal.pk]),
            ("UPDATE accounting_journalline SET debit=999 WHERE journal_entry_id=%s AND debit>0", [journal.pk]),
            ("DELETE FROM accounting_journalentry WHERE id=%s", [journal.pk]),
        ]:
            with self.subTest(sql=sql), self.assertRaises(DatabaseError), transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute(sql, params)
        journal.refresh_from_db()
        self.assertEqual(journal.description, "Immutable capital")

    def test_unallocated_customer_payment_race_creates_exactly_one(self):
        from apps.contacts.models import Contact
        from apps.sales.models import CustomerPayment
        customer = Contact.objects.create(organisation=self.org, name="Customer", is_customer=True, currency="GHS", created_by=self.user)
        Account.objects.create(organisation=self.org, code="1100", name="Receivables", account_type="asset", account_class="receivable", currency="GHS", created_by=self.user)
        key = str(uuid4())
        payload = {"customer_id": str(customer.pk), "bank_account_id": str(self.bank.pk), "payment_date": "2026-01-15", "amount": "12.00", "currency": "GHS"}
        def submit(amount="12.00"):
            client = APIClient(); client.force_authenticate(self.user)
            response = client.post("/api/v1/customer-payments/", {**payload, "amount": amount}, format="json", HTTP_X_ORGANISATION_ID=str(self.org.pk), HTTP_IDEMPOTENCY_KEY=key)
            return response.status_code, response.data
        results = self.parallel(submit, submit)
        self.assertEqual([row[0] for row in results], [201, 201], results)
        self.assertEqual(results[0][1]["id"], results[1][1]["id"])
        self.assertEqual(CustomerPayment.objects.count(), 1)
        self.assertEqual(JournalEntry.objects.count(), 1)
        self.assertEqual(submit("12")[0], 201)
        self.assertEqual(submit("13")[0], 409)

    def test_close_waits_for_in_progress_post_and_rejects_later_post(self):
        entered, release, closing = Event(), Event(), Event()
        journal = create_journal_entry(organisation=self.org, date=date(2026,1,15), description="Race", user=self.user,
            lines=[{"account":self.bank,"debit":"10","credit":"0"},{"account":self.equity,"debit":"0","credit":"10"}])
        def post():
            close_old_connections()
            try:
                with transaction.atomic():
                    lock_ledger(self.org.pk)
                    post_journal_entry(journal, self.user)
                    entered.set()
                    if not release.wait(10): raise RuntimeError("Close did not start")
            finally: connections.close_all()
        def close():
            close_old_connections()
            try:
                closing.set()
                lock_accounting_period(period=self.period, user=self.user)
            finally: connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            posting = pool.submit(post)
            self.assertTrue(entered.wait(10))
            closer = pool.submit(close)
            self.assertTrue(closing.wait(10))
            self.assertFalse(closer.done())
            release.set(); posting.result(timeout=20); closer.result(timeout=20)
        self.period.refresh_from_db(); journal.refresh_from_db()
        self.assertEqual(self.period.status, "locked")
        self.assertEqual(journal.status, "posted")
        with self.assertRaises(BusinessRuleError): self.journal()

    def test_overlapping_period_race_has_one_winner(self):
        def create(start, end):
            try:
                AccountingPeriod.objects.create(organisation=self.org, name="Contended", start_date=start, end_date=end)
                return "created"
            except (BusinessRuleError, DatabaseError): return "rejected"
        results = self.parallel(lambda:create(date(2026,2,1),date(2026,2,20)), lambda:create(date(2026,2,10),date(2026,2,28)))
        self.assertCountEqual(results, ["created", "rejected"])

    def test_separate_bank_previews_concurrent_commits_and_retry(self):
        from apps.banking.models import BankAccount, BankTransaction
        from apps.banking.services.imports.csv_import import preview_bank_statement_import, commit_bank_statement_import
        bank=BankAccount.objects.create(organisation=self.org,name="Statement",currency="GHS",ledger_account=self.bank,created_by=self.user)
        mapping={"transaction_date":"Date","description":"Description","amount":"Amount","reference":"Reference"}
        content=b"Date,Description,Amount,Reference\n2026-01-15,Fee,-10,A\n2026-01-15,Fee,-10,A\n2026-01-15,Other fee,-10,B\n"
        def preview(data):return preview_bank_statement_import(organisation=self.org,bank_account=bank,file_name="statement.csv",content=data,mapping=mapping,user=self.user)
        first,second=preview(content),preview(content)
        def commit(batch):return commit_bank_statement_import(organisation=self.org,import_batch=batch,user=self.user)
        results=self.parallel(lambda:commit(first),lambda:commit(second))
        self.assertEqual(BankTransaction.objects.count(),3)
        self.assertCountEqual([row.imported_rows for row in results],[0,3])
        self.assertCountEqual([row.duplicate_rows for row in results],[0,3])
        self.assertEqual(commit(first).pk,first.pk)
        overlap=preview(b"Date,Description,Amount,Reference\n2026-01-15,Other fee,-10,B\n2026-01-16,New fee,-10,C\n")
        result=commit(overlap)
        self.assertEqual(result.imported_rows,1);self.assertEqual(result.duplicate_rows,1)
        self.assertEqual(BankTransaction.objects.count(),4)

    def test_two_opening_balances_cannot_both_post_and_retry_is_safe(self):
        from .services.opening_balances import save_draft, submit, post
        from .models import OpeningBalance
        data={"opening_date":date(2026,1,1),"lines":[{"account_id":self.bank.pk,"debit":"100","credit":"0"},{"account_id":self.equity.pk,"debit":"0","credit":"100"}]}
        first=submit(save_draft(organisation=self.org,record=None,data=data,user=self.user),self.user)
        second=submit(save_draft(organisation=self.org,record=None,data=data,user=self.user),self.user)
        def attempt(record):
            try:return post(record,self.user).pk
            except BusinessRuleError:return None
        results=self.parallel(lambda:attempt(first),lambda:attempt(second))
        self.assertEqual(sum(result is not None for result in results),1)
        self.assertEqual(OpeningBalance.objects.filter(status="posted").count(),1)
        self.assertEqual(JournalEntry.objects.filter(status="posted").count(),1)
        winner=OpeningBalance.objects.get(status="posted")
        self.assertEqual(post(winner,self.user).journal_id,winner.journal_id)

    def test_supplier_payment_race(self):
        from apps.contacts.models import Contact
        from apps.purchases.models import SupplierPayment
        supplier=Contact.objects.create(organisation=self.org,name="Supplier",is_supplier=True,currency="GHS",created_by=self.user)
        Account.objects.create(organisation=self.org,code="2000",name="Payables",account_type="liability",account_class="payable",currency="GHS",created_by=self.user)
        key=str(uuid4())
        def submit():
            client=APIClient();client.force_authenticate(self.user)
            return client.post("/api/v1/supplier-payments/",{"supplier_id":str(supplier.pk),"bank_account_id":str(self.bank.pk),"payment_date":"2026-01-15","amount":"12.00","currency":"GHS"},format="json",HTTP_X_ORGANISATION_ID=str(self.org.pk),HTTP_IDEMPOTENCY_KEY=key)
        results=self.parallel(submit,submit)
        self.assertEqual([result.status_code for result in results],[201,201],[r.data for r in results])
        self.assertEqual(results[0].data["id"],results[1].data["id"])
        self.assertEqual(SupplierPayment.objects.count(),1);self.assertEqual(JournalEntry.objects.count(),1)

    def test_raw_bulk_period_overlap_race_is_rejected_by_database(self):
        def create(start,end):
            try:
                AccountingPeriod.objects.bulk_create([AccountingPeriod(organisation=self.org,name="Raw overlap",start_date=start,end_date=end)])
                return "created"
            except DatabaseError:return "rejected"
        results=self.parallel(lambda:create(date(2026,2,1),date(2026,2,20)),lambda:create(date(2026,2,10),date(2026,2,28)))
        self.assertCountEqual(results,["created","rejected"])

    def test_source_fields_cannot_disagree_with_posted_ledger(self):
        from . import test_phase2_history as history_fixtures
        from apps.contacts.models import Contact
        self.customer=Contact.objects.create(organisation=self.org,name="Customer",is_customer=True,currency="GHS",created_by=self.user)
        self.revenue=Account.objects.create(organisation=self.org,code="4000",name="Revenue",account_type="revenue",account_class="sales",currency="GHS",created_by=self.user)
        Account.objects.create(organisation=self.org,code="1100",name="Receivables",account_type="asset",account_class="receivable",currency="GHS",created_by=self.user)
        invoice=history_fixtures.HistoricalControlTests.invoice(self)
        for column,value in [("total","999"),("amount_paid","1"),("exchange_rate","2")]:
            with self.subTest(column=column),self.assertRaises(DatabaseError),transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute(f'UPDATE sales_invoice SET {column}=%s WHERE id=%s',[value,invoice.pk])

    def test_opening_post_failure_rolls_back_every_write(self):
        from unittest.mock import patch
        from .services.opening_balances import save_draft,submit,post
        from .models import OpeningBalance
        record=submit(save_draft(organisation=self.org,record=None,data={"opening_date":date(2026,1,1),"lines":[{"account_id":self.bank.pk,"debit":"100","credit":"0"},{"account_id":self.equity.pk,"debit":"0","credit":"100"}]},user=self.user),self.user)
        with patch('apps.accounting.services.opening_balances.post_journal_entry',side_effect=BusinessRuleError("Injected failure")):
            with self.assertRaises(BusinessRuleError):post(record,self.user)
        record.refresh_from_db()
        self.assertEqual(record.status,OpeningBalance.Status.SUBMITTED)
        self.assertIsNone(record.journal_id)
        self.assertEqual(JournalEntry.objects.count(),0)
