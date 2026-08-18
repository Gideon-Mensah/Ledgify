"""Summarise organisation supplier balances from authoritative open bills."""

from decimal import Decimal

from django.db.models import Sum

from apps.purchases.models import (
    Bill,
    SupplierCredit,
    SupplierPayment,
    SupplierRefund,
)


ZERO = Decimal("0.00")


def supplier_balance_summary(
    *,
    organisation,
    supplier=None,
):
    queryset = Bill.objects.filter(
        organisation=organisation,
    ).exclude(
        status__in=[
            Bill.Status.DRAFT,
            Bill.Status.VOID,
        ],
    )

    if supplier is not None:
        queryset = queryset.filter(supplier=supplier)

    totals = queryset.aggregate(
        total_billed=Sum("total"),
    )
    total_billed = totals["total_billed"] or ZERO
    payments = SupplierPayment.objects.filter(
        organisation=organisation,
        status=SupplierPayment.Status.POSTED,
    )
    if supplier is not None:
        payments = payments.filter(supplier=supplier)
    total_paid = payments.aggregate(total=Sum("amount"))["total"] or ZERO
    credits = SupplierCredit.objects.filter(
        organisation=organisation,
        status__in=[
            SupplierCredit.Status.APPROVED,
            SupplierCredit.Status.PARTLY_APPLIED,
            SupplierCredit.Status.APPLIED,
        ],
    )
    if supplier is not None:
        credits = credits.filter(supplier=supplier)
    total_credited = credits.aggregate(
        total=Sum("total")
    )["total"] or ZERO
    refunds = SupplierRefund.objects.filter(
        organisation=organisation,
        status=SupplierRefund.Status.POSTED,
    )
    if supplier is not None:
        refunds = refunds.filter(supplier=supplier)
    total_refunded = refunds.aggregate(
        total=Sum("amount")
    )["total"] or ZERO

    return {
        "total_billed": total_billed,
        "total_paid": total_paid,
        "total_credited": total_credited,
        "total_refunded": total_refunded,
        "total_outstanding": (
            total_billed
            - total_paid
            - total_credited
            + total_refunded
        ),
    }
