"""Validate and import statement rows without silently posting ledger entries."""
from common.ledger_integrity import ledger_transaction

import hashlib
import json
from collections import Counter
from decimal import InvalidOperation

from django.utils import timezone

from common.exceptions import BusinessRuleError
from apps.banking.models import BankAccount, BankStatementImport, BankStatementImportRow, BankTransaction


def fingerprint(*, organisation, bank_account, transaction_date, amount,
                transaction_type, reference, external_id, description="", currency="", occurrence=1):
    # Preserve v2 fingerprints for compatibility with existing imports. Repeated
    # occurrences still have ordinal identities, but are now held as possible
    # duplicates rather than automatically imported. Bank IDs are case-sensitive.
    identity = (["external", external_id.strip()] if external_id else
        ["values", str(transaction_date), str(amount), transaction_type,
         reference.strip(), description.strip(), currency, occurrence])
    return hashlib.sha256(json.dumps(["v2", str(organisation.id), str(bank_account.id), identity],
        ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


@ledger_transaction
def preview_bank_statement_import(*, organisation, bank_account, file_name, content,
                                  mapping, user, date_format="%Y-%m-%d", amount_sign="positive_in", mime=""):
    from .statement_schema import read_statement, read_date, read_money, FIELDS, DATE_FORMATS, normalise
    if bank_account.organisation_id != organisation.id: raise BusinessRuleError("Bank account belongs to another organisation.")
    if bank_account.status != 'active': raise BusinessRuleError("Choose an active bank account.")
    headers, sources, kind = read_statement(file_name, content, mime)
    allowed = {field[0] for field in FIELDS}
    if not isinstance(mapping, dict) or any(key not in allowed or not isinstance(value,str) or value not in headers for key,value in mapping.items() if value):
        raise BusinessRuleError("Mapping contains an unknown field or file column. Detect the file again.")
    mapping = {key:value for key,value in mapping.items() if value}
    if len(set(mapping.values())) != len(mapping): raise BusinessRuleError("Each file column can map to only one Ledgify field.")
    if not mapping.get("transaction_date") or not mapping.get("description"): raise BusinessRuleError("Map the required Date and Description fields.")
    amount_mode=bool(mapping.get("amount")); debit_credit_mode=bool(mapping.get("debit") or mapping.get("credit"))
    if amount_mode == debit_credit_mode: raise BusinessRuleError("Map either Amount or Money In / Money Out columns, not both.")
    if date_format not in DATE_FORMATS: raise BusinessRuleError("Choose a supported date format.")
    if amount_sign not in {'','positive_in','positive_out'}: raise BusinessRuleError("Choose the amount sign convention.")
    batch=BankStatementImport.objects.create(organisation=organisation, bank_account=bank_account,
        file_name=file_name.rsplit('/',1)[-1][:255], file_type=kind, imported_by=user, status=BankStatementImport.Status.PENDING,
        metadata={"mapping": mapping, "date_format": date_format, "amount_sign": amount_sign, "fingerprint_version": 2})
    existing=set(BankStatementImportRow.objects.filter(import_batch__organisation=organisation,
        import_batch__bank_account=bank_account, status=BankStatementImportRow.Status.IMPORTED).values_list("fingerprint", flat=True))
    existing_ids=set(); existing_values=set()
    for prior in BankTransaction.objects.filter(organisation=organisation,bank_account=bank_account).iterator():
        if prior.external_id:existing_ids.add(prior.external_id)
        existing_values.add((prior.transaction_date,prior.amount,prior.transaction_type,prior.reference.strip(),prior.description.strip(),prior.currency))
    seen=set(); seen_ids=set(); occurrences=Counter(); rows=[]; balances=[]
    for number,source,structure_error in sources:
        get=lambda key: str(source.get(mapping.get(key,''),'') or '').strip()
        row=BankStatementImportRow(import_batch=batch,row_number=number,source_data={key:str(value)[:1000] for key,value in source.items()},description=get('description')[:255],reference=get('reference')[:100],currency=bank_account.currency)
        try:
            if structure_error:raise ValueError(structure_error)
            description=get('description'); reference=get('reference'); external_id=get('external_id')
            currency=get('currency').upper() or bank_account.currency
            if currency != bank_account.currency:raise ValueError(f"Currency {currency} does not match this {bank_account.currency} bank account. No conversion was performed.")
            row.currency=currency
            if len(description)>255 or len(reference)>100 or len(external_id)>255:raise ValueError('Description, reference or external ID exceeds the supported length; shorten it before importing.')
            if not description:raise ValueError('Description is missing.')
            if get('balance'):row.statement_balance=read_money(get('balance'))
            if normalise(description) in {'openingbalance','closingbalance','balancebroughtforward','balancecarriedforward','balancebf','balancecf'}:
                if row.statement_balance is None:row.statement_balance=read_money(get('amount') or get('credit') or get('debit'))
                row.status=row.Status.INFORMATION;row.error_message='Statement balance information only; no transaction or ledger entry will be created.'
                balances.append({'row':number,'label':description,'balance':str(row.statement_balance)})
                rows.append(row);continue
            try:row.transaction_date=read_date(get('transaction_date'),date_format)
            except ValueError as error:
                if 'ambiguous' in str(error) or 'missing' in str(error) or 'could not' in str(error):raise
                raise ValueError('Transaction date is invalid for the selected format. Fix mapping or the source date.') from None
            if amount_mode:
                signed=read_money(get('amount'))
                direction=normalise(get('transaction_type'))
                if mapping.get('transaction_type'):
                    directions={'credit':1,'cr':1,'moneyin':1,'deposit':1,'debit':-1,'dr':-1,'moneyout':-1,'withdrawal':-1}
                    if direction not in directions:raise ValueError(f"Transaction type '{get('transaction_type')[:40]}' is not recognised. Use Credit/CR or Debit/DR.")
                    if signed<0 and directions[direction]>0:raise ValueError('The negative amount conflicts with the Credit/Money In transaction type.')
                    signed=abs(signed)*directions[direction]
                elif not amount_sign:raise ValueError('Choose whether positive amounts mean money in or money out in Map columns.')
                elif amount_sign=='positive_out':signed=-signed
            else:
                credit=read_money(get('credit'),blank=True);debit=read_money(get('debit'),blank=True)
                if credit<0 or debit<0:raise ValueError('Money In and Money Out must be non-negative. Use signed Amount for negative values.')
                if credit and debit:raise ValueError('Both Money In and Money Out contain amounts. Review the row.')
                signed=credit-debit
            if signed==0:raise ValueError('A non-zero transaction amount is required.')
            row.amount=abs(signed);row.transaction_type=BankTransaction.TransactionType.MONEY_IN if signed>0 else BankTransaction.TransactionType.MONEY_OUT
            row.external_id=external_id
            key=(row.transaction_date,row.amount,row.transaction_type,reference,description,currency);occurrences[key]+=1
            row.fingerprint=fingerprint(organisation=organisation,bank_account=bank_account,transaction_date=row.transaction_date,amount=row.amount,transaction_type=row.transaction_type,reference=reference,external_id=external_id,description=description,currency=currency,occurrence=occurrences[key])
            exact=row.fingerprint in existing or row.fingerprint in seen or bool(external_id and (external_id in existing_ids or external_id in seen_ids))
            possible=not exact and (key in existing_values or occurrences[key]>1)
            row.status=row.Status.DUPLICATE if exact or possible else row.Status.READY
            row.duplicate_kind='exact' if exact else 'possible' if possible else ''
            row.error_message='Exact duplicate: already imported or repeated External ID.' if exact else 'Possible duplicate with the same date, amount, reference and description. This row will not be imported.' if possible else ''
            seen.add(row.fingerprint)
            if external_id:seen_ids.add(external_id)
        except (ValueError,InvalidOperation) as error:
            row.status=row.Status.REJECTED;row.error_message=str(error) if isinstance(error,ValueError) else 'Amount could not be read.'
        rows.append(row)
    BankStatementImportRow.objects.bulk_create(rows)
    batch.total_rows=len(rows);batch.duplicate_rows=sum(row.status==row.Status.DUPLICATE for row in rows);batch.rejected_rows=sum(row.status==row.Status.REJECTED for row in rows)
    batch.metadata.update({'statement_balances':balances,'information_rows':sum(row.status==row.Status.INFORMATION for row in rows)})
    batch.status=batch.Status.PREVIEWED
    batch.save(update_fields=['total_rows','duplicate_rows','rejected_rows','status','metadata','updated_at'])
    return batch


@ledger_transaction
def commit_bank_statement_import(*, organisation, import_batch, user):
    # Lock the bank before the batch so independently previewed files serialize.
    bank_id=BankStatementImport.objects.get(pk=import_batch.pk, organisation=organisation).bank_account_id
    bank=BankAccount.objects.select_for_update().get(pk=bank_id, organisation=organisation)
    if bank.status != "active":raise BusinessRuleError("This bank account is no longer active.")
    batch=BankStatementImport.objects.select_for_update().get(pk=import_batch.pk, organisation=organisation)
    if batch.status == batch.Status.COMPLETED: return batch
    if batch.status != batch.Status.PREVIEWED: raise BusinessRuleError("Only a previewed import can be committed.")
    if batch.metadata.get("fingerprint_version") != 2:
        raise BusinessRuleError("Preview this statement again using the current fingerprint policy.")
    if BankStatementImportRow.objects.filter(import_batch__organisation=organisation,
        import_batch__bank_account_id=bank_id, status=BankStatementImportRow.Status.IMPORTED,
        bank_transaction__import_fingerprint__isnull=True).exists():
        raise BusinessRuleError("Legacy imported transactions require a reviewed fingerprint reconciliation before further imports.")
    for row in batch.rows.select_for_update().filter(status=BankStatementImportRow.Status.READY).order_by("row_number"):
        possible=BankTransaction.objects.filter(organisation=organisation,bank_account=bank,
            transaction_date=row.transaction_date,amount=row.amount,transaction_type=row.transaction_type,
            reference=row.reference,description=row.description,currency=row.currency).exclude(import_fingerprint=row.fingerprint).exists()
        external=bool(row.external_id and BankTransaction.objects.filter(organisation=organisation,bank_account=bank,external_id=row.external_id).exclude(import_fingerprint=row.fingerprint).exists())
        if possible or external:
            row.status=row.Status.DUPLICATE;row.duplicate_kind='exact' if external else 'possible';row.error_message='Duplicate detected during import; skipped safely.'
            row.save(update_fields=['status','duplicate_kind','error_message']);continue
        if row.currency != bank.currency:raise BusinessRuleError('Bank currency changed after preview. Preview the file again.')
        bank_transaction, created=BankTransaction.objects.get_or_create(
            organisation=organisation, bank_account=batch.bank_account, import_fingerprint=row.fingerprint,
            defaults=dict(transaction_date=row.transaction_date, description=row.description, reference=row.reference,
                transaction_type=row.transaction_type, amount=row.amount, currency=row.currency,
                external_id=row.external_id, created_by=user))
        row.bank_transaction=bank_transaction if created else None
        row.status=row.Status.IMPORTED if created else row.Status.DUPLICATE
        row.error_message="" if created else "Exact duplicate skipped at import"
        row.duplicate_kind="" if created else "exact"
        row.save(update_fields=["bank_transaction", "status", "error_message", "duplicate_kind"])
    batch.imported_rows=batch.rows.filter(status=BankStatementImportRow.Status.IMPORTED).count()
    batch.duplicate_rows=batch.rows.filter(status=BankStatementImportRow.Status.DUPLICATE).count()
    batch.status=batch.Status.COMPLETED; batch.imported_at=timezone.now()
    batch.save(update_fields=["imported_rows", "duplicate_rows", "status", "imported_at", "updated_at"])
    return batch
