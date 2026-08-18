"""Validate and import statement rows without silently posting ledger entries."""

import csv
import hashlib
import io
from datetime import datetime
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone

from common.exceptions import BusinessRuleError
from apps.banking.models import BankStatementImport, BankStatementImportRow, BankTransaction
from django.conf import settings


def fingerprint(*, organisation, bank_account, transaction_date, amount,
                transaction_type, reference, external_id):
    identity = (f"external:{external_id.strip().lower()}" if external_id else
        f"values:{transaction_date}|{amount}|{transaction_type}|{' '.join(reference.lower().split())}")
    return hashlib.sha256(f"{organisation.id}|{bank_account.id}|{identity}".encode()).hexdigest()


def _date(value, date_format):
    return datetime.strptime(value.strip(), date_format).date()


@transaction.atomic
def preview_bank_statement_import(*, organisation, bank_account, file_name, content,
                                  mapping, user, date_format="%Y-%m-%d"):
    if bank_account.organisation_id != organisation.id: raise BusinessRuleError("Bank account belongs to another organisation.")
    if not mapping.get("transaction_date") or not mapping.get("description"):
        raise BusinessRuleError("Date and description mappings are required.")
    amount_mode=bool(mapping.get("amount")); debit_credit_mode=bool(mapping.get("debit") or mapping.get("credit"))
    if amount_mode == debit_credit_mode: raise BusinessRuleError("Map either signed amount or debit/credit columns.")
    batch=BankStatementImport.objects.create(organisation=organisation, bank_account=bank_account,
        file_name=file_name, imported_by=user, status=BankStatementImport.Status.PENDING,
        metadata={"mapping": mapping, "date_format": date_format})
    existing=set(BankStatementImportRow.objects.filter(import_batch__organisation=organisation,
        import_batch__bank_account=bank_account, status=BankStatementImportRow.Status.IMPORTED).values_list("fingerprint", flat=True))
    seen=set(); rows=[]
    try:
        reader=csv.DictReader(io.StringIO(content.decode("utf-8-sig")))
        for number, source in enumerate(reader, start=2):
            if number > getattr(settings,"BANK_IMPORT_MAX_ROWS",10000)+1:raise BusinessRuleError("Bank statement exceeds the configured row limit.")
            try:
                transaction_date=_date(source[mapping["transaction_date"]], date_format)
                description=source[mapping["description"]].strip()
                reference=source.get(mapping.get("reference", ""), "").strip()
                external_id=source.get(mapping.get("external_id", ""), "").strip()
                if amount_mode:
                    signed=Decimal(source[mapping["amount"]].replace(",", "").strip())
                else:
                    credit=Decimal((source.get(mapping.get("credit", ""), "0") or "0").replace(",", ""))
                    debit=Decimal((source.get(mapping.get("debit", ""), "0") or "0").replace(",", ""))
                    if credit and debit: raise ValueError("Both debit and credit are populated")
                    signed=credit-debit
                if not description or signed == 0: raise ValueError("Description and non-zero amount are required")
                kind=BankTransaction.TransactionType.MONEY_IN if signed > 0 else BankTransaction.TransactionType.MONEY_OUT
                amount=abs(signed).quantize(Decimal("0.01")); currency=source.get(mapping.get("currency", ""), bank_account.currency).strip().upper() or bank_account.currency
                mark=fingerprint(organisation=organisation, bank_account=bank_account,
                    transaction_date=transaction_date, amount=amount, transaction_type=kind,
                    reference=reference, external_id=external_id)
                duplicate=mark in existing or mark in seen; seen.add(mark)
                rows.append(BankStatementImportRow(import_batch=batch, row_number=number,
                    transaction_date=transaction_date, description=description, reference=reference,
                    amount=amount, transaction_type=kind, currency=currency, external_id=external_id,
                    fingerprint=mark, status=(BankStatementImportRow.Status.DUPLICATE if duplicate else BankStatementImportRow.Status.READY),
                    error_message="Duplicate transaction" if duplicate else ""))
            except (KeyError, ValueError, InvalidOperation) as error:
                rows.append(BankStatementImportRow(import_batch=batch, row_number=number,
                    status=BankStatementImportRow.Status.REJECTED, error_message=str(error)))
    except UnicodeDecodeError as error:
        batch.status=BankStatementImport.Status.FAILED; batch.save(update_fields=["status", "updated_at"])
        raise BusinessRuleError("CSV must use UTF-8 encoding.") from error
    BankStatementImportRow.objects.bulk_create(rows)
    batch.total_rows=len(rows); batch.duplicate_rows=sum(x.status==x.Status.DUPLICATE for x in rows)
    batch.rejected_rows=sum(x.status==x.Status.REJECTED for x in rows); batch.status=batch.Status.PREVIEWED
    batch.save(update_fields=["total_rows", "duplicate_rows", "rejected_rows", "status", "updated_at"])
    return batch


@transaction.atomic
def commit_bank_statement_import(*, organisation, import_batch, user):
    batch=BankStatementImport.objects.select_for_update().get(pk=import_batch.pk, organisation=organisation)
    if batch.status != batch.Status.PREVIEWED: raise BusinessRuleError("Only a previewed import can be committed.")
    for row in batch.rows.select_for_update().filter(status=BankStatementImportRow.Status.READY):
        transaction=BankTransaction.objects.create(organisation=organisation, bank_account=batch.bank_account,
            transaction_date=row.transaction_date, description=row.description, reference=row.reference,
            transaction_type=row.transaction_type, amount=row.amount, currency=row.currency,
            external_id=row.external_id, created_by=user)
        row.bank_transaction=transaction; row.status=row.Status.IMPORTED
        row.save(update_fields=["bank_transaction", "status"])
    batch.imported_rows=batch.rows.filter(status=BankStatementImportRow.Status.IMPORTED).count()
    batch.status=batch.Status.COMPLETED; batch.imported_at=timezone.now()
    batch.save(update_fields=["imported_rows", "status", "imported_at", "updated_at"]); return batch
