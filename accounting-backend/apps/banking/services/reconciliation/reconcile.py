"""Accept a safe bank match without creating a duplicate payment or journal."""

from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from common.exceptions import BusinessRuleError
from apps.accounting.models import JournalEntry
from apps.accounting.services.journals import create_journal_entry, post_journal_entry
from apps.banking.models import BankReconciliationHistory, BankTransaction
from apps.purchases.models import Bill, SupplierPayment
from apps.purchases.services.payments import create_supplier_payment
from apps.sales.models import CustomerPayment, Invoice
from apps.sales.services.payments import create_customer_payment
from apps.organisations.permissions import RECONCILE_BANK
from apps.organisations.services import require_organisation_permission


def _lock_bank_transaction(organisation, bank_transaction):
    transaction_record = BankTransaction.objects.select_for_update().select_related(
        "bank_account", "bank_account__ledger_account"
    ).get(pk=bank_transaction.pk)
    if transaction_record.organisation_id != organisation.id:
        raise BusinessRuleError(
            "Bank transaction does not belong to this organisation."
        )
    if transaction_record.status != BankTransaction.Status.UNRECONCILED:
        raise BusinessRuleError("Bank transaction has already been reconciled.")
    return transaction_record


def _ensure_target_unused(organisation, reconciliation_type, object_id):
    if BankTransaction.objects.filter(
        organisation=organisation,
        reconciliation_type=reconciliation_type,
        reconciliation_object_id=object_id,
        status=BankTransaction.Status.RECONCILED,
    ).exists():
        raise BusinessRuleError("The selected record is already reconciled.")


def _mark_reconciled(
    bank_transaction, *, journal, match_type, object_id, user, metadata=None
):
    bank_transaction.status = BankTransaction.Status.RECONCILED
    bank_transaction.accounting_journal = journal
    bank_transaction.reconciliation_type = match_type
    bank_transaction.reconciliation_object_id = object_id
    bank_transaction.reconciled_by = user
    bank_transaction.reconciled_at = timezone.now()
    bank_transaction.save(update_fields=[
        "status", "accounting_journal", "reconciliation_type",
        "reconciliation_object_id", "reconciled_by", "reconciled_at",
        "updated_at",
    ])
    BankReconciliationHistory.objects.create(
        organisation=bank_transaction.organisation,
        bank_transaction=bank_transaction,
        action=BankReconciliationHistory.Action.RECONCILED,
        reconciliation_type=match_type,
        reconciliation_object_id=object_id,
        accounting_journal=journal,
        performed_by=user,
        metadata=metadata or {},
    )
    return bank_transaction


@transaction.atomic
def accept_customer_payment_match(*, organisation, bank_transaction, payment, user):
    bank_transaction = _lock_bank_transaction(organisation, bank_transaction)
    payment = CustomerPayment.objects.select_for_update().select_related(
        "bank_account", "accounting_journal"
    ).get(pk=payment.pk)
    if payment.organisation_id != organisation.id:
        raise BusinessRuleError("Payment does not belong to this organisation.")
    if payment.status != CustomerPayment.Status.POSTED or not payment.accounting_journal_id:
        raise BusinessRuleError("Only posted payments can be reconciled.")
    if bank_transaction.transaction_type != BankTransaction.TransactionType.MONEY_IN:
        raise BusinessRuleError("Customer payments require a money-in transaction.")
    if payment.currency != bank_transaction.currency or payment.amount != bank_transaction.amount:
        raise BusinessRuleError("Payment currency and amount must match exactly.")
    if payment.bank_account_id != bank_transaction.bank_account.ledger_account_id:
        raise BusinessRuleError("Payment bank account does not match the bank transaction account.")
    _ensure_target_unused(organisation, "customer_payment", payment.id)
    return _mark_reconciled(
        bank_transaction, journal=payment.accounting_journal,
        match_type="customer_payment", object_id=payment.id, user=user,
        metadata={"created_payment": False, "payment_id": str(payment.id)},
    )


@transaction.atomic
def accept_supplier_payment_match(*, organisation, bank_transaction, payment, user):
    bank_transaction = _lock_bank_transaction(organisation, bank_transaction)
    payment = SupplierPayment.objects.select_for_update().select_related(
        "bank_account", "accounting_journal"
    ).get(pk=payment.pk)
    if payment.organisation_id != organisation.id:
        raise BusinessRuleError("Payment does not belong to this organisation.")
    if payment.status != SupplierPayment.Status.POSTED or not payment.accounting_journal_id:
        raise BusinessRuleError("Only posted payments can be reconciled.")
    if bank_transaction.transaction_type != BankTransaction.TransactionType.MONEY_OUT:
        raise BusinessRuleError("Supplier payments require a money-out transaction.")
    if payment.currency != bank_transaction.currency or payment.amount != bank_transaction.amount:
        raise BusinessRuleError("Payment currency and amount must match exactly.")
    if payment.bank_account_id != bank_transaction.bank_account.ledger_account_id:
        raise BusinessRuleError("Payment bank account does not match the bank transaction account.")
    _ensure_target_unused(organisation, "supplier_payment", payment.id)
    return _mark_reconciled(
        bank_transaction, journal=payment.accounting_journal,
        match_type="supplier_payment", object_id=payment.id, user=user,
        metadata={"created_payment": False, "payment_id": str(payment.id)},
    )


@transaction.atomic
def accept_bank_transfer_match(*, organisation, bank_transaction,
                               opposite_transaction, user):
    first_id, second_id = sorted([bank_transaction.id, opposite_transaction.id])
    locked = {
        item.id: item
        for item in BankTransaction.objects.select_for_update().select_related(
            "bank_account", "bank_account__ledger_account"
        ).filter(id__in=[first_id, second_id])
    }
    bank_transaction = locked.get(bank_transaction.id)
    opposite_transaction = locked.get(opposite_transaction.id)
    if bank_transaction is None or opposite_transaction is None:
        raise BusinessRuleError("Bank transfer transaction was not found.")
    if (bank_transaction.organisation_id != organisation.id
            or opposite_transaction.organisation_id != organisation.id):
        raise BusinessRuleError("Both transactions must belong to this organisation.")
    if (bank_transaction.status != BankTransaction.Status.UNRECONCILED
            or opposite_transaction.status != BankTransaction.Status.UNRECONCILED):
        raise BusinessRuleError("Both transfer transactions must be unreconciled.")
    if bank_transaction.bank_account_id == opposite_transaction.bank_account_id:
        raise BusinessRuleError("Internal transfers require different bank accounts.")
    if (bank_transaction.currency != opposite_transaction.currency
            or bank_transaction.amount != opposite_transaction.amount):
        raise BusinessRuleError("Transfer currency and amount must match exactly.")
    if bank_transaction.transaction_type == opposite_transaction.transaction_type:
        raise BusinessRuleError("Transfer transactions must have opposite directions.")
    if abs((bank_transaction.transaction_date - opposite_transaction.transaction_date).days) > 3:
        raise BusinessRuleError("Transfer transactions must be within three days.")
    money_in = (bank_transaction if bank_transaction.transaction_type
                == BankTransaction.TransactionType.MONEY_IN else opposite_transaction)
    money_out = opposite_transaction if money_in.id == bank_transaction.id else bank_transaction
    journal = create_journal_entry(
        organisation=organisation, date=max(money_in.transaction_date,
                                            money_out.transaction_date),
        description="Internal bank transfer", reference=(bank_transaction.reference
                                                          or opposite_transaction.reference),
        source_type=JournalEntry.SourceType.BANK_TRANSFER,
        source_id=bank_transaction.id, user=user,
        lines=[
            {"account": money_in.bank_account.ledger_account,
             "description": "Internal bank transfer", "debit": bank_transaction.amount,
             "credit": Decimal("0.00")},
            {"account": money_out.bank_account.ledger_account,
             "description": "Internal bank transfer", "debit": Decimal("0.00"),
             "credit": bank_transaction.amount},
        ],
    )
    post_journal_entry(journal_entry=journal, user=user)
    _mark_reconciled(bank_transaction, journal=journal, match_type="bank_transfer",
                     object_id=opposite_transaction.id, user=user,
                     metadata={"opposite_transaction_id": str(opposite_transaction.id)})
    _mark_reconciled(opposite_transaction, journal=journal, match_type="bank_transfer",
                     object_id=bank_transaction.id, user=user,
                     metadata={"opposite_transaction_id": str(bank_transaction.id)})
    return bank_transaction


@transaction.atomic
def accept_invoice_match(*, organisation, bank_transaction, invoice, user):
    bank_transaction = _lock_bank_transaction(organisation, bank_transaction)
    invoice = Invoice.objects.select_for_update().select_related("customer").get(pk=invoice.pk)
    if invoice.organisation_id != organisation.id or invoice.amount_due <= 0:
        raise BusinessRuleError("Invoice is not available for reconciliation.")
    if invoice.status not in {Invoice.Status.APPROVED, Invoice.Status.SENT,
                              Invoice.Status.PARTLY_PAID}:
        raise BusinessRuleError("Invoice is not eligible for payment.")
    if bank_transaction.transaction_type != BankTransaction.TransactionType.MONEY_IN:
        raise BusinessRuleError("Invoice matching requires a money-in transaction.")
    if bank_transaction.currency != invoice.currency or bank_transaction.amount > invoice.amount_due:
        raise BusinessRuleError("Bank transaction does not match the invoice balance.")
    previous_status = invoice.status
    payment = create_customer_payment(
        organisation=organisation, customer=invoice.customer, invoice=invoice,
        bank_account=bank_transaction.bank_account.ledger_account,
        payment_date=bank_transaction.transaction_date, amount=bank_transaction.amount,
        currency=bank_transaction.currency, reference=(bank_transaction.reference
                                                       or bank_transaction.external_id),
        user=user,
    )
    return _mark_reconciled(bank_transaction, journal=payment.accounting_journal,
                            match_type="customer_payment", object_id=payment.id, user=user,
                            metadata={
                                "created_payment": True,
                                "payment_id": str(payment.id),
                                "source_document_id": str(invoice.id),
                                "previous_document_status": previous_status,
                            })


@transaction.atomic
def accept_bill_match(*, organisation, bank_transaction, bill, user):
    bank_transaction = _lock_bank_transaction(organisation, bank_transaction)
    bill = Bill.objects.select_for_update().select_related("supplier").get(pk=bill.pk)
    if bill.organisation_id != organisation.id or bill.amount_due <= 0:
        raise BusinessRuleError("Bill is not available for reconciliation.")
    if bill.status not in {Bill.Status.APPROVED, Bill.Status.PARTLY_PAID}:
        raise BusinessRuleError("Bill is not eligible for payment.")
    if bank_transaction.transaction_type != BankTransaction.TransactionType.MONEY_OUT:
        raise BusinessRuleError("Bill matching requires a money-out transaction.")
    if bank_transaction.currency != bill.currency or bank_transaction.amount > bill.amount_due:
        raise BusinessRuleError("Bank transaction does not match the bill balance.")
    previous_status = bill.status
    payment = create_supplier_payment(
        organisation=organisation, supplier=bill.supplier, bill=bill,
        bank_account=bank_transaction.bank_account.ledger_account,
        payment_date=bank_transaction.transaction_date, amount=bank_transaction.amount,
        currency=bank_transaction.currency, reference=(bank_transaction.reference
                                                       or bank_transaction.external_id),
        user=user,
    )
    return _mark_reconciled(bank_transaction, journal=payment.accounting_journal,
                            match_type="supplier_payment", object_id=payment.id, user=user,
                            metadata={
                                "created_payment": True,
                                "payment_id": str(payment.id),
                                "source_document_id": str(bill.id),
                                "previous_document_status": previous_status,
                            })


@transaction.atomic
def accept_reconciliation_suggestion(*, organisation, bank_transaction,
                                     match_type, object_id, user):
    require_organisation_permission(
        organisation=organisation, user=user, permission=RECONCILE_BANK,
    )
    if match_type == "customer_payment":
        payment = CustomerPayment.objects.filter(
            id=object_id, organisation=organisation
        ).first()
        if payment is None:
            raise BusinessRuleError("Customer payment was not found.")
        return accept_customer_payment_match(
            organisation=organisation, bank_transaction=bank_transaction,
            payment=payment, user=user,
        )
    if match_type == "supplier_payment":
        payment = SupplierPayment.objects.filter(
            id=object_id, organisation=organisation
        ).first()
        if payment is None:
            raise BusinessRuleError("Supplier payment was not found.")
        return accept_supplier_payment_match(
            organisation=organisation, bank_transaction=bank_transaction,
            payment=payment, user=user,
        )
    if match_type == "bank_transfer":
        opposite = BankTransaction.objects.filter(
            id=object_id, organisation=organisation
        ).first()
        if opposite is None:
            raise BusinessRuleError("Opposite bank transaction was not found.")
        return accept_bank_transfer_match(
            organisation=organisation, bank_transaction=bank_transaction,
            opposite_transaction=opposite, user=user,
        )
    if match_type == "invoice":
        invoice = Invoice.objects.filter(id=object_id, organisation=organisation).first()
        if invoice is None:
            raise BusinessRuleError("Invoice was not found.")
        return accept_invoice_match(organisation=organisation,
                                    bank_transaction=bank_transaction,
                                    invoice=invoice, user=user)
    if match_type == "bill":
        bill = Bill.objects.filter(id=object_id, organisation=organisation).first()
        if bill is None:
            raise BusinessRuleError("Bill was not found.")
        return accept_bill_match(organisation=organisation,
                                 bank_transaction=bank_transaction,
                                 bill=bill, user=user)
    raise BusinessRuleError("Unsupported reconciliation match type.")
