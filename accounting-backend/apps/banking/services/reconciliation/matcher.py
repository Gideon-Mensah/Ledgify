"""Find existing accounting records that may match a bank transaction safely."""

from dataclasses import asdict
from datetime import timedelta

from common.exceptions import BusinessRuleError
from apps.banking.models import BankTransaction
from apps.purchases.models import Bill, SupplierPayment
from apps.sales.models import CustomerPayment, Invoice
from .scoring import (
    clamp_confidence,
    confidence_label,
    score_amount_match,
    score_date_match,
    score_reference_match,
)
from .suggestions import ReconciliationSuggestion
from .transfers import find_internal_transfer_matches


class BankReconciliationMatcher:
    def __init__(self, *, organisation, bank_transaction):
        if bank_transaction.organisation_id != organisation.id:
            raise BusinessRuleError(
                "Bank transaction does not belong to this organisation."
            )
        self.organisation = organisation
        self.bank_transaction = bank_transaction

    def _date_range(self, days=14):
        date = self.bank_transaction.transaction_date
        return date - timedelta(days=days), date + timedelta(days=days)

    def _score(self, *, amount, date, reference, party_name=""):
        amount_score = score_amount_match(self.bank_transaction.amount, amount)
        date_score = score_date_match(self.bank_transaction.transaction_date, date)
        reference_score = score_reference_match(
            self.bank_transaction.reference, reference
        )
        name_score = 0
        if party_name and party_name.lower() in self.bank_transaction.description.lower():
            name_score = 5
        score = clamp_confidence(
            amount_score + date_score + reference_score + name_score
        )
        reasons = []
        if amount_score:
            reasons.append(f"Amount match score: {amount_score}")
        if date_score:
            reasons.append(f"Date match score: {date_score}")
        if reference_score:
            reasons.append(f"Reference match score: {reference_score}")
        if name_score:
            reasons.append("Description contains party name")
        return score, reasons

    def find_customer_payment_matches(self):
        if self.bank_transaction.transaction_type != BankTransaction.TransactionType.MONEY_IN:
            return []
        start, end = self._date_range()
        candidates = CustomerPayment.objects.filter(
            organisation=self.organisation,
            status=CustomerPayment.Status.POSTED,
            currency=self.bank_transaction.currency,
            payment_date__range=(start, end),
        ).select_related("customer").prefetch_related(
            "allocations__invoice"
        )
        reconciled_ids = BankTransaction.objects.filter(
            organisation=self.organisation,
            status=BankTransaction.Status.RECONCILED,
            reconciliation_type="customer_payment",
        ).values_list("reconciliation_object_id", flat=True)
        candidates = candidates.exclude(id__in=reconciled_ids)
        suggestions = []
        for payment in candidates:
            customer_name = payment.customer.name if payment.customer_id else "Customer"
            score, reasons = self._score(
                amount=payment.amount, date=payment.payment_date,
                reference=payment.reference, party_name=customer_name,
            )
            allocations = [
                {
                    "invoice_id": str(item.invoice_id),
                    "invoice_number": item.invoice.invoice_number,
                    "amount": item.amount,
                }
                for item in payment.allocations.filter(status="active")
            ]
            suggestions.append(ReconciliationSuggestion(
                match_type="customer_payment", object_id=str(payment.id),
                label=f"Customer payment - {customer_name}", amount=payment.amount,
                confidence=score, reasons=reasons,
                metadata={
                    "customer_id": str(payment.customer_id) if payment.customer_id else None,
                    "customer_name": customer_name,
                    "payment_date": payment.payment_date,
                    "reference": payment.reference,
                    "amount_allocated": payment.amount_allocated,
                    "amount_unallocated": payment.amount_unallocated,
                    "invoice_allocations": allocations,
                },
            ))
        return self._sort(suggestions)

    def find_supplier_payment_matches(self):
        if self.bank_transaction.transaction_type != BankTransaction.TransactionType.MONEY_OUT:
            return []
        start, end = self._date_range()
        candidates = SupplierPayment.objects.filter(
            organisation=self.organisation,
            status=SupplierPayment.Status.POSTED,
            currency=self.bank_transaction.currency,
            payment_date__range=(start, end),
        ).select_related("supplier").prefetch_related("allocations__bill")
        reconciled_ids = BankTransaction.objects.filter(
            organisation=self.organisation,
            status=BankTransaction.Status.RECONCILED,
            reconciliation_type="supplier_payment",
        ).values_list("reconciliation_object_id", flat=True)
        candidates = candidates.exclude(id__in=reconciled_ids)
        suggestions = []
        for payment in candidates:
            supplier_name = payment.supplier.name if payment.supplier_id else "Supplier"
            score, reasons = self._score(
                amount=payment.amount, date=payment.payment_date,
                reference=payment.reference, party_name=supplier_name,
            )
            allocations = [
                {"bill_id": str(item.bill_id), "bill_number": item.bill.bill_number,
                 "amount": item.amount}
                for item in payment.allocations.filter(status="active")
            ]
            suggestions.append(ReconciliationSuggestion(
                match_type="supplier_payment", object_id=str(payment.id),
                label=f"Supplier payment - {supplier_name}", amount=payment.amount,
                confidence=score, reasons=reasons,
                metadata={
                    "supplier_id": str(payment.supplier_id) if payment.supplier_id else None,
                    "supplier_name": supplier_name, "payment_date": payment.payment_date,
                    "reference": payment.reference,
                    "amount_allocated": payment.amount_allocated,
                    "amount_unallocated": payment.amount_unallocated,
                    "bill_allocations": allocations,
                },
            ))
        return self._sort(suggestions)

    def find_invoice_matches(self):
        if self.bank_transaction.transaction_type != BankTransaction.TransactionType.MONEY_IN:
            return []
        start, end = self._date_range()
        invoices = Invoice.objects.filter(
            organisation=self.organisation,
            currency=self.bank_transaction.currency,
            due_date__range=(start, end),
        ).exclude(status__in=[Invoice.Status.DRAFT, Invoice.Status.VOID,
                             Invoice.Status.PAID,
                             Invoice.Status.WRITTEN_OFF]).select_related(
                                 "customer"
                             )
        suggestions = []
        for invoice in invoices:
            if invoice.amount_due <= 0:
                continue
            score, reasons = self._score(
                amount=invoice.amount_due, date=invoice.due_date,
                reference=invoice.invoice_number, party_name=invoice.customer.name,
            )
            suggestions.append(ReconciliationSuggestion(
                match_type="invoice", object_id=str(invoice.id),
                label=f"Create payment for {invoice.invoice_number}",
                amount=invoice.amount_due, confidence=score, reasons=reasons,
                metadata={"requires_payment_creation": True,
                          "customer_id": str(invoice.customer_id),
                          "customer_name": invoice.customer.name,
                          "invoice_number": invoice.invoice_number,
                          "due_date": invoice.due_date},
            ))
        return self._sort(suggestions)

    def find_bill_matches(self):
        if self.bank_transaction.transaction_type != BankTransaction.TransactionType.MONEY_OUT:
            return []
        start, end = self._date_range()
        bills = Bill.objects.filter(
            organisation=self.organisation, currency=self.bank_transaction.currency,
            due_date__range=(start, end),
        ).exclude(status__in=[Bill.Status.DRAFT, Bill.Status.VOID,
                             Bill.Status.PAID]).select_related("supplier")
        suggestions = []
        for bill in bills:
            if bill.amount_due <= 0:
                continue
            score, reasons = self._score(
                amount=bill.amount_due, date=bill.due_date,
                reference=bill.bill_number, party_name=bill.supplier.name,
            )
            suggestions.append(ReconciliationSuggestion(
                match_type="bill", object_id=str(bill.id),
                label=f"Create payment for {bill.bill_number}",
                amount=bill.amount_due, confidence=score, reasons=reasons,
                metadata={"requires_payment_creation": True,
                          "supplier_id": str(bill.supplier_id),
                          "supplier_name": bill.supplier.name,
                          "bill_number": bill.bill_number,
                          "due_date": bill.due_date},
            ))
        return self._sort(suggestions)

    def get_suggestions(self, *, limit=10):
        suggestions = find_internal_transfer_matches(
            organisation=self.organisation,
            bank_transaction=self.bank_transaction,
        )
        if self.bank_transaction.transaction_type == BankTransaction.TransactionType.MONEY_IN:
            suggestions.extend(self.find_customer_payment_matches())
            suggestions.extend(self.find_invoice_matches())
        else:
            suggestions.extend(self.find_supplier_payment_matches())
            suggestions.extend(self.find_bill_matches())
        suggestions = self._sort(suggestions)[:limit]
        output = []
        for suggestion in suggestions:
            item = asdict(suggestion)
            item["confidence_label"] = confidence_label(suggestion.confidence)
            output.append(item)
        transaction = self.bank_transaction
        return {
            "bank_transaction": {
                "id": str(transaction.id), "date": transaction.transaction_date,
                "description": transaction.description, "reference": transaction.reference,
                "transaction_type": transaction.transaction_type,
                "amount": transaction.amount, "currency": transaction.currency,
            },
            "suggestions": output,
            "manual_account_coding_available": True,
        }

    def _sort(self, suggestions):
        return sorted(
            suggestions,
            key=lambda item: (
                -item.confidence,
                abs((self.bank_transaction.transaction_date
                     - item.metadata.get("payment_date", item.metadata.get(
                         "due_date", self.bank_transaction.transaction_date))).days),
                item.object_id,
            ),
        )
