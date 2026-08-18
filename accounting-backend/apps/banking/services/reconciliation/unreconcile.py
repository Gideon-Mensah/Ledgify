"""Remove a reconciliation link while preserving the audit trail and valid journals."""

from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from common.exceptions import BusinessRuleError
from apps.accounting.services.journals import reverse_journal_entry
from apps.banking.models import BankReconciliationHistory, BankTransaction
from apps.purchases.models import (
    Bill,
    SupplierPayment,
    SupplierPaymentAllocation,
)
from apps.sales.models import (
    CustomerPayment,
    CustomerPaymentAllocation,
    Invoice,
)
from apps.organisations.permissions import UNRECONCILE_BANK
from apps.organisations.services import require_organisation_permission


ZERO = Decimal("0.00")


def _latest_reconciliation(bank_transaction):
    history = (
        BankReconciliationHistory.objects.select_for_update()
        .filter(
            bank_transaction=bank_transaction,
            action=BankReconciliationHistory.Action.RECONCILED,
        )
        .order_by("-performed_at", "-id")
        .first()
    )
    if history is None:
        raise BusinessRuleError(
            "This reconciliation has no audit history and cannot be safely reversed."
        )
    return history


def _restore_invoice(invoice, previous_status):
    invoice.amount_paid = (
        CustomerPaymentAllocation.objects.filter(
            organisation=invoice.organisation,
            invoice=invoice,
            status=CustomerPaymentAllocation.Status.ACTIVE,
        ).aggregate(total=Sum("amount"))["total"]
        or ZERO
    )
    if invoice.amount_due <= ZERO:
        invoice.status = (
            Invoice.Status.WRITTEN_OFF
            if invoice.amount_written_off > ZERO
            else Invoice.Status.PAID
        )
    elif invoice.amount_paid > ZERO:
        invoice.status = Invoice.Status.PARTLY_PAID
    elif previous_status in {Invoice.Status.APPROVED, Invoice.Status.SENT}:
        invoice.status = previous_status
    else:
        invoice.status = Invoice.Status.APPROVED
    invoice.save(update_fields=["amount_paid", "status", "updated_at"])


def _restore_bill(bill, previous_status):
    bill.amount_paid = (
        SupplierPaymentAllocation.objects.filter(
            organisation=bill.organisation,
            bill=bill,
            status=SupplierPaymentAllocation.Status.ACTIVE,
        ).aggregate(total=Sum("amount"))["total"]
        or ZERO
    )
    if bill.amount_due <= ZERO:
        bill.status = Bill.Status.PAID
    elif bill.amount_paid > ZERO:
        bill.status = Bill.Status.PARTLY_PAID
    elif previous_status == Bill.Status.APPROVED:
        bill.status = previous_status
    else:
        bill.status = Bill.Status.APPROVED
    bill.save(update_fields=["amount_paid", "status", "updated_at"])


def _reverse_created_customer_payment(
    *, organisation, history, user, reversal_date, reason
):
    payment = (
        CustomerPayment.objects.select_for_update()
        .select_related("accounting_journal")
        .filter(pk=history.metadata.get("payment_id"))
        .first()
    )
    if payment is None or payment.organisation_id != organisation.id:
        raise BusinessRuleError("The reconciliation-created payment was not found.")
    if payment.status != CustomerPayment.Status.POSTED:
        raise BusinessRuleError("The reconciliation-created payment is no longer posted.")
    if not payment.accounting_journal_id or payment.accounting_journal_id != history.accounting_journal_id:
        raise BusinessRuleError("The payment journal no longer matches the reconciliation audit.")

    allocations = list(
        CustomerPaymentAllocation.objects.select_for_update()
        .select_related("invoice")
        .filter(payment=payment)
    )
    source_document_id = history.metadata.get("source_document_id")
    active = [item for item in allocations if item.status == item.Status.ACTIVE]
    if (
        not active
        or any(str(item.invoice_id) != source_document_id for item in active)
        or sum((item.amount for item in active), ZERO) != payment.amount
        or len(active) != len(allocations)
    ):
        raise BusinessRuleError(
            "The payment allocations have changed; automated unreconciliation is unsafe."
        )

    reversal = reverse_journal_entry(
        journal_entry=payment.accounting_journal,
        user=user,
        reversal_date=reversal_date,
        check_permissions=False,
    )
    reversed_at = timezone.now()
    for allocation in active:
        allocation.status = CustomerPaymentAllocation.Status.REVERSED
        allocation.reversed_at = reversed_at
        allocation.reversed_by = user
        allocation.reversal_reason = reason
        allocation.save(update_fields=[
            "status", "reversed_at", "reversed_by", "reversal_reason",
        ])
    invoice = Invoice.objects.select_for_update().get(pk=active[0].invoice_id)
    _restore_invoice(invoice, history.metadata.get("previous_document_status"))
    payment.status = CustomerPayment.Status.REVERSED
    payment.save(update_fields=["status", "updated_at"])
    return reversal


def _reverse_created_supplier_payment(
    *, organisation, history, user, reversal_date, reason
):
    payment = (
        SupplierPayment.objects.select_for_update()
        .select_related("accounting_journal")
        .filter(pk=history.metadata.get("payment_id"))
        .first()
    )
    if payment is None or payment.organisation_id != organisation.id:
        raise BusinessRuleError("The reconciliation-created payment was not found.")
    if payment.status != SupplierPayment.Status.POSTED:
        raise BusinessRuleError("The reconciliation-created payment is no longer posted.")
    if not payment.accounting_journal_id or payment.accounting_journal_id != history.accounting_journal_id:
        raise BusinessRuleError("The payment journal no longer matches the reconciliation audit.")

    allocations = list(
        SupplierPaymentAllocation.objects.select_for_update()
        .select_related("bill")
        .filter(payment=payment)
    )
    source_document_id = history.metadata.get("source_document_id")
    active = [item for item in allocations if item.status == item.Status.ACTIVE]
    if (
        not active
        or any(str(item.bill_id) != source_document_id for item in active)
        or sum((item.amount for item in active), ZERO) != payment.amount
        or len(active) != len(allocations)
    ):
        raise BusinessRuleError(
            "The payment allocations have changed; automated unreconciliation is unsafe."
        )

    reversal = reverse_journal_entry(
        journal_entry=payment.accounting_journal,
        user=user,
        reversal_date=reversal_date,
        check_permissions=False,
    )
    reversed_at = timezone.now()
    for allocation in active:
        allocation.status = SupplierPaymentAllocation.Status.REVERSED
        allocation.reversed_at = reversed_at
        allocation.reversed_by = user
        allocation.reversal_reason = reason
        allocation.save(update_fields=[
            "status", "reversed_at", "reversed_by", "reversal_reason",
        ])
    bill = Bill.objects.select_for_update().get(pk=active[0].bill_id)
    _restore_bill(bill, history.metadata.get("previous_document_status"))
    payment.status = SupplierPayment.Status.REVERSED
    payment.save(update_fields=["status", "updated_at"])
    return reversal


def _mark_unreconciled(
    bank_transaction, *, history, user, reason, reversal=None, metadata=None
):
    BankReconciliationHistory.objects.create(
        organisation=bank_transaction.organisation,
        bank_transaction=bank_transaction,
        action=BankReconciliationHistory.Action.UNRECONCILED,
        reconciliation_type=history.reconciliation_type,
        reconciliation_object_id=history.reconciliation_object_id,
        accounting_journal=history.accounting_journal,
        performed_by=user,
        reason=reason,
        metadata={
            **(metadata or {}),
            "reversal_journal_id": str(reversal.id) if reversal else None,
        },
    )
    bank_transaction.status = BankTransaction.Status.UNRECONCILED
    bank_transaction.accounting_journal = None
    bank_transaction.unreconciled_at = timezone.now()
    bank_transaction.unreconciled_by = user
    bank_transaction.unreconciliation_reason = reason
    bank_transaction.save(update_fields=[
        "status", "accounting_journal", "unreconciled_at",
        "unreconciled_by", "unreconciliation_reason", "updated_at",
    ])


@transaction.atomic
def unreconcile_bank_transaction(
    *, organisation, bank_transaction, user, reversal_date=None, reason=""
):
    require_organisation_permission(
        organisation=organisation, user=user, permission=UNRECONCILE_BANK,
    )
    bank_transaction = (
        BankTransaction.objects.select_for_update()
        .select_related("accounting_journal")
        .get(pk=bank_transaction.pk)
    )
    if bank_transaction.organisation_id != organisation.id:
        raise BusinessRuleError(
            "Bank transaction does not belong to this organisation."
        )
    if bank_transaction.status != BankTransaction.Status.RECONCILED:
        raise BusinessRuleError("Only reconciled bank transactions can be unreconciled.")

    history = _latest_reconciliation(bank_transaction)
    if (
        history.organisation_id != organisation.id
        or history.reconciliation_type != bank_transaction.reconciliation_type
        or history.reconciliation_object_id != bank_transaction.reconciliation_object_id
    ):
        raise BusinessRuleError("Reconciliation audit metadata does not match active state.")

    reversal_date = reversal_date or timezone.localdate()
    reversal = None
    reconciliation_type = history.reconciliation_type
    created_payment = history.metadata.get("created_payment")

    if reconciliation_type == "customer_payment":
        if created_payment is None:
            raise BusinessRuleError("Payment origin is missing from reconciliation history.")
        if created_payment:
            reversal = _reverse_created_customer_payment(
                organisation=organisation, history=history, user=user,
                reversal_date=reversal_date, reason=reason,
            )
    elif reconciliation_type == "supplier_payment":
        if created_payment is None:
            raise BusinessRuleError("Payment origin is missing from reconciliation history.")
        if created_payment:
            reversal = _reverse_created_supplier_payment(
                organisation=organisation, history=history, user=user,
                reversal_date=reversal_date, reason=reason,
            )
    elif reconciliation_type == "manual_account":
        if not history.accounting_journal_id:
            raise BusinessRuleError("The manual reconciliation journal is missing.")
        reversal = reverse_journal_entry(
            journal_entry=history.accounting_journal,
            user=user,
            reversal_date=reversal_date,
            check_permissions=False,
        )
    elif reconciliation_type == "bank_transfer":
        opposite = (
            BankTransaction.objects.select_for_update()
            .select_related("accounting_journal")
            .filter(pk=history.reconciliation_object_id)
            .first()
        )
        if (
            opposite is None
            or opposite.organisation_id != organisation.id
            or opposite.status != BankTransaction.Status.RECONCILED
            or opposite.reconciliation_type != "bank_transfer"
            or opposite.reconciliation_object_id != bank_transaction.id
            or opposite.accounting_journal_id != history.accounting_journal_id
            or bank_transaction.accounting_journal_id != history.accounting_journal_id
        ):
            raise BusinessRuleError("The paired bank transfer reconciliation is inconsistent.")
        opposite_history = _latest_reconciliation(opposite)
        if (
            opposite_history.organisation_id != organisation.id
            or opposite_history.reconciliation_type != "bank_transfer"
            or opposite_history.reconciliation_object_id != bank_transaction.id
            or opposite_history.accounting_journal_id != history.accounting_journal_id
        ):
            raise BusinessRuleError("The paired bank transfer audit history is inconsistent.")
        if not history.accounting_journal_id:
            raise BusinessRuleError("The bank transfer journal is missing.")
        reversal = reverse_journal_entry(
            journal_entry=history.accounting_journal,
            user=user,
            reversal_date=reversal_date,
            check_permissions=False,
        )
        _mark_unreconciled(
            opposite, history=opposite_history, user=user, reason=reason,
            reversal=reversal, metadata={"paired_transaction_id": str(bank_transaction.id)},
        )
    else:
        raise BusinessRuleError("This reconciliation type cannot be unreconciled.")

    _mark_unreconciled(
        bank_transaction, history=history, user=user, reason=reason,
        reversal=reversal,
        metadata=(
            {"paired_transaction_id": str(history.reconciliation_object_id)}
            if reconciliation_type == "bank_transfer" else {}
        ),
    )
    bank_transaction.refresh_from_db()
    return bank_transaction
