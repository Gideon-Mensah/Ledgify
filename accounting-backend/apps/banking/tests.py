from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import models
from django.test import TestCase
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from common.exceptions import BusinessRuleError

from apps.accounting.models import Account, JournalEntry
from apps.banking.models import (
    BankAccount,
    BankReconciliationHistory,
    BankRule, BankStatementImportRow,
    BankTransaction,
)
from apps.banking.services.reconciliation import BankReconciliationMatcher
from apps.banking.services.reconciliation.reconcile import (
    accept_reconciliation_suggestion,
)
from apps.banking.services.reconciliation.unreconcile import (
    unreconcile_bank_transaction,
)
from apps.banking.services.reconciliation.summary import get_reconciliation_summary
from apps.banking.services.transactions import (
    create_bank_transaction,
    reconcile_bank_transaction_to_account,
)
from apps.banking.services.imports import commit_bank_statement_import, preview_bank_statement_import
from apps.banking.services.rules import apply_bank_rule, match_bank_rules
from apps.banking.serializers import BankAccountSerializer, BankImportPreviewSerializer
from apps.accounting.services.journals import create_journal_entry, post_journal_entry
from apps.accounting.services.reports import general_ledger, trial_balance
from apps.organisations.models import Organisation, OrganisationMember
from apps.contacts.models import Contact
from apps.sales.models import CustomerPayment
from apps.sales.services.invoices import approve_invoice, create_invoice
from apps.sales.services.payments import create_customer_payment


class BankingIntegrationTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="banking", email="banking@example.com", password="test"
        )
        self.organisation = Organisation.objects.create(
            name="Banking Test", created_by=self.user
        )
        OrganisationMember.objects.create(
            organisation=self.organisation,
            user=self.user,
            role=OrganisationMember.Role.OWNER,
        )
        self.bank_ledger = self._account(
            "BANK1", Account.AccountType.ASSET, Account.AccountClass.BANK
        )
        self.expense = self._account(
            "EXP", Account.AccountType.EXPENSE, Account.AccountClass.OPERATING_EXPENSE
        )
        self.bank = self._bank("Main bank", self.bank_ledger)

    def _account(self, code, account_type, account_class):
        return Account.objects.create(
            organisation=self.organisation,
            code=code,
            name=code,
            account_type=account_type,
            account_class=account_class,
            currency="GBP",
            created_by=self.user,
        )

    def _bank(self, name, ledger):
        return BankAccount.objects.create(
            organisation=self.organisation,
            ledger_account=ledger,
            name=name,
            currency="GBP",
            created_by=self.user,
        )

    def _transaction(self, bank, transaction_type, reference="BANK-1"):
        return create_bank_transaction(
            organisation=self.organisation,
            bank_account=bank,
            transaction_date=date(2026, 8, 13),
            description="Test banking workflow",
            reference=reference,
            transaction_type=transaction_type,
            amount="125.00",
            currency="GBP",
            user=self.user,
        )

    def test_manual_reconciliation_posts_and_unreconcile_preserves_audit(self):
        bank_transaction = self._transaction(
            self.bank, BankTransaction.TransactionType.MONEY_OUT
        )
        reconciled = reconcile_bank_transaction_to_account(
            bank_transaction=bank_transaction,
            target_account=self.expense,
            user=self.user,
        )
        journal = reconciled.accounting_journal
        journal.refresh_from_db()
        lines = {
            line.account_id: (line.debit, line.credit)
            for line in journal.lines.all()
        }
        self.assertEqual(journal.status, JournalEntry.Status.POSTED)
        self.assertEqual(
            lines[self.expense.id], (Decimal("125.00"), Decimal("0.00"))
        )
        self.assertEqual(
            lines[self.bank_ledger.id], (Decimal("0.00"), Decimal("125.00"))
        )

        result = unreconcile_bank_transaction(
            organisation=self.organisation,
            bank_transaction=reconciled,
            user=self.user,
            reversal_date=date(2026, 8, 13),
            reason="Integration test reversal",
        )
        self.assertEqual(result.status, BankTransaction.Status.UNRECONCILED)
        self.assertEqual(result.unreconciliation_reason, "Integration test reversal")
        self.assertTrue(
            JournalEntry.objects.filter(reversal_of=journal).exists()
        )
        self.assertEqual(
            BankReconciliationHistory.objects.filter(
                bank_transaction=result
            ).count(),
            2,
        )

    def test_cash_coding_rejects_receivable_and_payable_control_accounts(self):
        receivable = self._account(
            "AR", Account.AccountType.ASSET, Account.AccountClass.RECEIVABLE
        )
        payable = self._account(
            "AP", Account.AccountType.LIABILITY, Account.AccountClass.PAYABLE
        )

        for account, transaction_type in [
            (receivable, BankTransaction.TransactionType.MONEY_IN),
            (payable, BankTransaction.TransactionType.MONEY_OUT),
        ]:
            bank_transaction = self._transaction(
                self.bank,
                transaction_type,
                reference=f"CONTROL-{account.code}",
            )
            with self.assertRaisesMessage(
                BusinessRuleError,
                "control accounts cannot be used for cash coding",
            ):
                reconcile_bank_transaction_to_account(
                    bank_transaction=bank_transaction,
                    target_account=account,
                    user=self.user,
                )
            bank_transaction.refresh_from_db()
            self.assertEqual(
                bank_transaction.status,
                BankTransaction.Status.UNRECONCILED,
            )
            self.assertIsNone(bank_transaction.accounting_journal_id)

    def test_customer_receipt_matches_canonical_payment_without_duplicate_journal(self):
        receivable = self._account(
            "AR", Account.AccountType.ASSET, Account.AccountClass.RECEIVABLE
        )
        revenue = self._account(
            "REV", Account.AccountType.REVENUE, Account.AccountClass.SALES
        )
        customer = Contact.objects.create(
            organisation=self.organisation,
            name="Receipt customer",
            is_customer=True,
            currency="GBP",
            created_by=self.user,
        )
        invoice = create_invoice(
            organisation=self.organisation,
            customer=customer,
            invoice_number="BANK-MATCH-INV",
            issue_date=date(2026, 8, 10),
            due_date=date(2026, 9, 10),
            currency="GBP",
            user=self.user,
            lines=[{
                "description": "Receipt matching test",
                "quantity": "1",
                "unit_price": "125.00",
                "discount_amount": "0.00",
                "tax_rate": "0.00",
                "revenue_account": revenue,
            }],
        )
        # Approval uses the organisation's receivable control account.
        receivable.name = "Accounts Receivable"
        receivable.save(update_fields=["name"])
        invoice = approve_invoice(invoice=invoice, user=self.user)
        payment = create_customer_payment(
            organisation=self.organisation,
            customer=customer,
            invoice=invoice,
            bank_account=self.bank_ledger,
            payment_date=date(2026, 8, 13),
            amount="125.00",
            currency="GBP",
            reference="BANK-MATCH-1",
            user=self.user,
        )
        bank_transaction = self._transaction(
            self.bank,
            BankTransaction.TransactionType.MONEY_IN,
            "BANK-MATCH-1",
        )
        payment_count = CustomerPayment.objects.count()
        journal_count = JournalEntry.objects.count()

        result = accept_reconciliation_suggestion(
            organisation=self.organisation,
            bank_transaction=bank_transaction,
            match_type="customer_payment",
            object_id=payment.id,
            user=self.user,
        )

        self.assertEqual(result.reconciliation_type, "customer_payment")
        self.assertEqual(result.reconciliation_object_id, payment.id)
        self.assertEqual(result.accounting_journal_id, payment.accounting_journal_id)
        self.assertEqual(CustomerPayment.objects.count(), payment_count)
        self.assertEqual(JournalEntry.objects.count(), journal_count)

    def test_bank_profile_book_balance_reconciles_to_gl_and_trial_balance(self):
        journal = create_journal_entry(
            organisation=self.organisation, date=date(2026, 8, 13),
            description="Existing bank ledger activity", user=self.user,
            lines=[
                {"account": self.bank_ledger, "debit": "500.00", "credit": "0.00"},
                {"account": self.expense, "debit": "0.00", "credit": "500.00"},
            ],
        )
        post_journal_entry(journal_entry=journal, user=self.user)
        payload = BankAccountSerializer(self.bank).data
        ledger = general_ledger(
            organisation=self.organisation, account_id=self.bank_ledger.id,
            end_date=date(2026, 8, 13),
        )[0]
        trial_row = next(row for row in trial_balance(
            organisation=self.organisation, as_of_date=date(2026, 8, 13),
        )["rows"] if row["account"]["id"] == str(self.bank_ledger.id))
        self.assertEqual(Decimal(payload["book_balance"]), ledger["closing_balance"])
        self.assertEqual(Decimal(payload["book_balance"]), trial_row["debit"])

    def test_reconciliation_summary_uses_one_date_and_statement_activity(self):
        self.bank.opening_balance = Decimal("1000.00")
        self.bank.opening_balance_date = date(2026, 7, 1)
        self.bank.save(update_fields=["opening_balance", "opening_balance_date"])
        create_bank_transaction(
            organisation=self.organisation, bank_account=self.bank,
            transaction_date=date(2026, 7, 15), description="Customer receipt",
            reference="IN-1", transaction_type=BankTransaction.TransactionType.MONEY_IN,
            amount="500.00", currency="GBP", user=self.user,
        )
        create_bank_transaction(
            organisation=self.organisation, bank_account=self.bank,
            transaction_date=date(2026, 7, 20), description="Supplier payment",
            reference="OUT-1", transaction_type=BankTransaction.TransactionType.MONEY_OUT,
            amount="200.00", currency="GBP", user=self.user,
        )
        future = create_bank_transaction(
            organisation=self.organisation, bank_account=self.bank,
            transaction_date=date(2026, 8, 1), description="Future item",
            reference="FUTURE", transaction_type=BankTransaction.TransactionType.MONEY_IN,
            amount="900.00", currency="GBP", user=self.user,
        )
        summary = get_reconciliation_summary(
            organisation=self.organisation, bank_account=self.bank,
            reconciliation_date=date(2026, 7, 31),
        )
        self.assertEqual(summary["statement_balance"], Decimal("1300.00"))
        self.assertEqual(summary["difference"], Decimal("1300.00"))
        self.assertEqual(summary["unreconciled_count"], 2)
        self.assertNotIn(future.id, self.bank.transactions.filter(
            transaction_date__lte=date(2026, 7, 31)
        ).values_list("id", flat=True))

    def test_bank_profile_rejects_invalid_foreign_and_duplicate_ledgers(self):
        common = {
            "name": "Invalid", "bank_name": "Bank", "account_number": "1",
            "currency": "GBP", "opening_balance": "0.00", "status": "active",
        }
        invalid = BankAccountSerializer(
            data={**common, "ledger_account_id": str(self.expense.id)},
            context={"organisation": self.organisation},
        )
        self.assertFalse(invalid.is_valid())
        self.assertIn("ledger_account_id", invalid.errors)

        duplicate = BankAccountSerializer(
            data={**common, "ledger_account_id": str(self.bank_ledger.id)},
            context={"organisation": self.organisation},
        )
        self.assertFalse(duplicate.is_valid())
        self.assertIn("ledger_account_id", duplicate.errors)

        foreign = Organisation.objects.create(name="Foreign bank org", created_by=self.user)
        foreign_ledger = Account.objects.create(
            organisation=foreign, code="FBANK", name="Foreign bank",
            account_type=Account.AccountType.ASSET,
            account_class=Account.AccountClass.BANK,
            currency="GBP", created_by=self.user,
        )
        cross_org = BankAccountSerializer(
            data={**common, "ledger_account_id": str(foreign_ledger.id)},
            context={"organisation": self.organisation},
        )
        self.assertFalse(cross_org.is_valid())
        self.assertIn("ledger_account_id", cross_org.errors)

    def test_internal_transfer_suggestion_acceptance_posts_balanced_journal(self):
        destination_ledger = self._account(
            "BANK2", Account.AccountType.ASSET, Account.AccountClass.BANK
        )
        destination = self._bank("Reserve bank", destination_ledger)
        outgoing = self._transaction(
            self.bank, BankTransaction.TransactionType.MONEY_OUT, "TRANSFER-1"
        )
        incoming = self._transaction(
            destination, BankTransaction.TransactionType.MONEY_IN, "TRANSFER-1"
        )
        matches = BankReconciliationMatcher(
            organisation=self.organisation,
            bank_transaction=outgoing,
        ).get_suggestions()
        transfer = next(
            item for item in matches["suggestions"]
            if item["match_type"] == "bank_transfer"
        )
        result = accept_reconciliation_suggestion(
            organisation=self.organisation,
            bank_transaction=outgoing,
            match_type="bank_transfer",
            object_id=transfer["object_id"],
            user=self.user,
        )
        incoming.refresh_from_db()
        self.assertEqual(result.status, BankTransaction.Status.RECONCILED)
        self.assertEqual(incoming.status, BankTransaction.Status.RECONCILED)
        self.assertEqual(result.accounting_journal_id, incoming.accounting_journal_id)
        totals = result.accounting_journal.lines.aggregate(
            debit=models.Sum("debit"), credit=models.Sum("credit")
        )
        self.assertEqual(totals["debit"], totals["credit"])

    def test_csv_preview_commit_and_repeat_duplicate_detection(self):
        content=b"Date,Description,Reference,Amount\n2026-08-13,Microsoft 365,MS-1,-79.99\n2026-08-13,Microsoft 365,MS-1,-79.99\n"
        mapping={"transaction_date":"Date", "description":"Description", "reference":"Reference", "amount":"Amount"}
        first=preview_bank_statement_import(organisation=self.organisation, bank_account=self.bank,
            file_name="statement.csv", content=content, mapping=mapping, user=self.user)
        self.assertEqual(first.rows.filter(status=BankStatementImportRow.Status.READY).count(), 1)
        self.assertEqual(first.duplicate_rows, 1)
        commit_bank_statement_import(organisation=self.organisation, import_batch=first, user=self.user)
        self.assertEqual(BankTransaction.objects.count(), 1)
        second=preview_bank_statement_import(organisation=self.organisation, bank_account=self.bank,
            file_name="again.csv", content=content, mapping=mapping, user=self.user)
        self.assertEqual(second.duplicate_rows, 2)

    @override_settings(BANK_IMPORT_MAX_BYTES=32)
    def test_bank_import_rejects_oversized_binary_and_non_csv_uploads(self):
        base={"bank_account_id":self.bank.id,"mapping":{"transaction_date":"Date","description":"Description","amount":"Amount"}}
        oversized=BankImportPreviewSerializer(data={**base,"file":SimpleUploadedFile("statement.csv",b"x"*33,content_type="text/csv")});self.assertFalse(oversized.is_valid());self.assertIn("file",oversized.errors)
        binary=BankImportPreviewSerializer(data={**base,"file":SimpleUploadedFile("statement.csv",b"MZ executable",content_type="text/csv")});self.assertFalse(binary.is_valid());self.assertIn("file",binary.errors)
        archive=BankImportPreviewSerializer(data={**base,"file":SimpleUploadedFile("statement.zip",b"PK\x03\x04",content_type="application/zip")});self.assertFalse(archive.is_valid());self.assertIn("file",archive.errors)

    def test_bank_rule_match_and_apply_uses_existing_reconciliation(self):
        row=self._transaction(self.bank, BankTransaction.TransactionType.MONEY_OUT)
        row.description="MICROSOFT 365"; row.amount=Decimal("79.99"); row.save()
        rule=BankRule.objects.create(organisation=self.organisation, name="Microsoft",
            direction=BankTransaction.TransactionType.MONEY_OUT,
            description_contains="MICROSOFT", max_amount=Decimal("500"),
            target_account=self.expense, created_by=self.user)
        matches=match_bank_rules(organisation=self.organisation, bank_transaction=row)
        self.assertEqual(matches[0]["rule_id"], str(rule.id))
        result=apply_bank_rule(organisation=self.organisation, bank_transaction=row, rule=rule, user=self.user)
        self.assertEqual(result.status, BankTransaction.Status.RECONCILED)
        self.assertEqual(JournalEntry.objects.filter(source_id=row.id).count(), 1)
