"""Build an auditable customer statement from invoices, credits, and payments."""

from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone

from common.exceptions import BusinessRuleError

from apps.sales.models import (
    BadDebtWriteOff,
    CustomerCreditNote,
    CustomerPayment,
    CustomerRefund,
    Invoice,
)


ZERO = Decimal("0.00")


def customer_statement(
    *,
    organisation,
    customer,
    start_date=None,
    end_date=None,
):
    if customer.organisation_id != organisation.id:
        raise BusinessRuleError(
            "Customer does not belong to this organisation."
        )

    if not customer.is_customer:
        raise BusinessRuleError(
            "The selected contact is not a customer."
        )

    end_date = end_date or timezone.localdate()

    if start_date and end_date < start_date:
        raise BusinessRuleError(
            "End date cannot be earlier than start date."
        )

    invoices = Invoice.objects.filter(
        organisation=organisation,
        customer=customer,
    ).exclude(
        status__in=[
            Invoice.Status.DRAFT,
            Invoice.Status.VOID,
        ],
    )
    payments = (
        CustomerPayment.objects
        .select_related("invoice")
        .filter(
            organisation=organisation,
            customer=customer,
            status=CustomerPayment.Status.POSTED,
        )
    )
    credits = CustomerCreditNote.objects.filter(
        organisation=organisation,
        customer=customer,
        status__in=[
            CustomerCreditNote.Status.APPROVED,
            CustomerCreditNote.Status.PARTLY_APPLIED,
            CustomerCreditNote.Status.APPLIED,
        ],
    )
    refunds = CustomerRefund.objects.filter(
        organisation=organisation,
        customer=customer,
        status=CustomerRefund.Status.POSTED,
    )
    write_offs = BadDebtWriteOff.objects.filter(
        organisation=organisation,
        invoice__customer=customer,
        status=BadDebtWriteOff.Status.POSTED,
    )

    opening_balance = ZERO

    if start_date:
        invoice_opening = invoices.filter(
            issue_date__lt=start_date,
        ).aggregate(total=Sum("total"))["total"] or ZERO
        payment_opening = payments.filter(
            payment_date__lt=start_date,
        ).aggregate(total=Sum("amount"))["total"] or ZERO
        opening_balance = invoice_opening - payment_opening
        credit_opening = credits.filter(
            issue_date__lt=start_date,
        ).aggregate(total=Sum("total"))["total"] or ZERO
        opening_balance -= credit_opening
        refund_opening = refunds.filter(
            refund_date__lt=start_date,
        ).aggregate(total=Sum("amount"))["total"] or ZERO
        write_off_opening = write_offs.filter(
            write_off_date__lt=start_date,
        ).aggregate(total=Sum("amount"))["total"] or ZERO
        opening_balance += refund_opening
        opening_balance -= write_off_opening

    period_invoices = invoices.filter(issue_date__lte=end_date)
    period_payments = payments.filter(payment_date__lte=end_date)
    period_credits = credits.filter(issue_date__lte=end_date)
    period_refunds = refunds.filter(refund_date__lte=end_date)
    period_write_offs = write_offs.filter(write_off_date__lte=end_date)

    if start_date:
        period_invoices = period_invoices.filter(
            issue_date__gte=start_date,
        )
        period_payments = period_payments.filter(
            payment_date__gte=start_date,
        )
        period_credits = period_credits.filter(issue_date__gte=start_date)
        period_refunds = period_refunds.filter(refund_date__gte=start_date)
        period_write_offs = period_write_offs.filter(
            write_off_date__gte=start_date
        )

    transactions = []

    for invoice in period_invoices:
        transactions.append(
            {
                "type": "invoice",
                "id": str(invoice.id),
                "date": invoice.issue_date,
                "reference": invoice.invoice_number,
                "description": f"Invoice {invoice.invoice_number}",
                "debit": invoice.total,
                "credit": ZERO,
                "_priority": 0,
            }
        )

    for payment in period_payments:
        transactions.append(
            {
                "type": "payment",
                "id": str(payment.id),
                "date": payment.payment_date,
                "reference": payment.reference,
                "description": (
                    f"Payment for invoice "
                    f"{payment.invoice.invoice_number}"
                    if payment.invoice_id
                    else "Unallocated customer payment"
                ),
                "debit": ZERO,
                "credit": payment.amount,
                "_priority": 1,
            }
        )

    for credit in period_credits:
        transactions.append({
            "type": "credit_note", "id": str(credit.id),
            "date": credit.issue_date, "reference": credit.credit_note_number,
            "description": f"Credit note {credit.credit_note_number}",
            "debit": ZERO, "credit": credit.total, "_priority": 1,
        })

    for refund in period_refunds:
        transactions.append({
            "type": "refund", "id": str(refund.id),
            "date": refund.refund_date, "reference": refund.reference,
            "description": "Customer refund", "debit": refund.amount,
            "credit": ZERO, "_priority": 2,
        })

    for write_off in period_write_offs:
        transactions.append({
            "type": "bad_debt_write_off", "id": str(write_off.id),
            "date": write_off.write_off_date, "reference": write_off.reference,
            "description": write_off.reason or "Bad debt write-off",
            "debit": ZERO, "credit": write_off.amount, "_priority": 2,
        })

    transactions.sort(
        key=lambda item: (
            item["date"],
            item["_priority"],
            item["reference"],
            item["id"],
        )
    )

    running_balance = opening_balance
    period_invoice_total = ZERO
    period_payment_total = ZERO

    for transaction in transactions:
        running_balance += transaction["debit"]
        running_balance -= transaction["credit"]
        transaction["balance"] = running_balance
        transaction.pop("_priority")
        if transaction["type"] == "invoice":
            period_invoice_total += transaction["debit"]
        elif transaction["type"] == "payment":
            period_payment_total += transaction["credit"]

    return {
        "customer": {
            "id": str(customer.id),
            "name": customer.name,
            "account_number": customer.account_number,
        },
        "start_date": start_date,
        "end_date": end_date,
        "opening_balance": opening_balance,
        "transactions": transactions,
        "period_invoices": period_invoice_total,
        "period_payments": period_payment_total,
        "closing_balance": running_balance,
    }
