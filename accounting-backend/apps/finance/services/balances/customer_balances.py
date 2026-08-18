"""Summarise organisation customer balances from authoritative open documents."""

from decimal import Decimal

from django.db.models import Sum

from apps.sales.models import (
    BadDebtWriteOff,
    CustomerCreditNote,
    CustomerRefund,
    CustomerPayment,
    Invoice,
)


ZERO = Decimal("0.00")


def customer_balance_summary(
    *,
    organisation,
    customer=None,
):
    queryset = Invoice.objects.filter(
        organisation=organisation,
    ).exclude(
        status__in=[
            Invoice.Status.DRAFT,
            Invoice.Status.VOID,
        ],
    )

    if customer is not None:
        queryset = queryset.filter(customer=customer)

    totals = queryset.aggregate(
        total_invoiced=Sum("total"),
    )
    total_invoiced = totals["total_invoiced"] or ZERO
    payments = CustomerPayment.objects.filter(
        organisation=organisation,
        status=CustomerPayment.Status.POSTED,
    )
    if customer is not None:
        payments = payments.filter(customer=customer)
    total_paid = payments.aggregate(total=Sum("amount"))["total"] or ZERO
    credits = CustomerCreditNote.objects.filter(
        organisation=organisation,
        status__in=[
            CustomerCreditNote.Status.APPROVED,
            CustomerCreditNote.Status.PARTLY_APPLIED,
            CustomerCreditNote.Status.APPLIED,
        ],
    )
    if customer is not None:
        credits = credits.filter(customer=customer)
    total_credited = credits.aggregate(
        total=Sum("total")
    )["total"] or ZERO
    write_offs = BadDebtWriteOff.objects.filter(
        organisation=organisation,
        status=BadDebtWriteOff.Status.POSTED,
    )
    refunds = CustomerRefund.objects.filter(
        organisation=organisation,
        status=CustomerRefund.Status.POSTED,
    )
    if customer is not None:
        write_offs = write_offs.filter(invoice__customer=customer)
        refunds = refunds.filter(customer=customer)
    total_written_off = write_offs.aggregate(
        total=Sum("amount")
    )["total"] or ZERO
    total_refunded = refunds.aggregate(
        total=Sum("amount")
    )["total"] or ZERO

    return {
        "total_invoiced": total_invoiced,
        "total_paid": total_paid,
        "total_credited": total_credited,
        "total_written_off": total_written_off,
        "total_outstanding": (
            total_invoiced
            - total_paid
            - total_credited
            - total_written_off
            + total_refunded
        ),
    }
