"""Age open customer balances without double-counting payments, credits, or write-offs."""

from collections import OrderedDict
from decimal import Decimal

from apps.sales.models import Invoice

from .buckets import AGING_BUCKETS, get_aging_bucket


ZERO = Decimal("0.00")


def _empty_buckets():
    return {
        bucket.key: ZERO
        for bucket in AGING_BUCKETS
    }


def aged_receivables(
    *,
    organisation,
    as_of_date,
    customer=None,
):
    queryset = (
        Invoice.objects
        .select_related("customer")
        .filter(
            organisation=organisation,
            issue_date__lte=as_of_date,
        )
        .exclude(
            status__in=[
                Invoice.Status.DRAFT,
                Invoice.Status.VOID,
                Invoice.Status.PAID,
            ],
        )
    )

    if customer is not None:
        queryset = queryset.filter(customer=customer)

    queryset = queryset.order_by(
        "customer__name",
        "customer_id",
        "due_date",
        "invoice_number",
    )

    buckets = _empty_buckets()
    customers = OrderedDict()
    total_outstanding = ZERO

    for invoice in queryset:
        amount_due = (
            invoice.total
            - invoice.amount_paid
            - invoice.amount_credited
            - invoice.amount_written_off
        )

        if amount_due <= ZERO:
            continue

        days_overdue = (as_of_date - invoice.due_date).days
        bucket = get_aging_bucket(days_overdue)
        customer_data = customers.setdefault(
            invoice.customer_id,
            {
                "customer": {
                    "id": str(invoice.customer_id),
                    "name": invoice.customer.name,
                },
                "buckets": _empty_buckets(),
                "total_outstanding": ZERO,
                "invoices": [],
            },
        )

        buckets[bucket] += amount_due
        total_outstanding += amount_due
        customer_data["buckets"][bucket] += amount_due
        customer_data["total_outstanding"] += amount_due
        customer_data["invoices"].append(
            {
                "id": str(invoice.id),
                "invoice_number": invoice.invoice_number,
                "issue_date": invoice.issue_date,
                "due_date": invoice.due_date,
                "days_overdue": days_overdue,
                "bucket": bucket,
                "total": invoice.total,
                "amount_paid": invoice.amount_paid,
                "amount_due": amount_due,
            }
        )

    return {
        "as_of_date": as_of_date,
        "buckets": buckets,
        "total_outstanding": total_outstanding,
        "customers": list(customers.values()),
    }
