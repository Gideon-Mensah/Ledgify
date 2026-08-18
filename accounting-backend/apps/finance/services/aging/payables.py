"""Age open supplier balances after payments and supplier credits are deducted."""

from collections import OrderedDict
from decimal import Decimal

from apps.purchases.models import Bill

from .buckets import AGING_BUCKETS, get_aging_bucket


ZERO = Decimal("0.00")


def _empty_buckets():
    return {
        bucket.key: ZERO
        for bucket in AGING_BUCKETS
    }


def aged_payables(
    *,
    organisation,
    as_of_date,
    supplier=None,
):
    queryset = (
        Bill.objects
        .select_related("supplier")
        .filter(
            organisation=organisation,
            issue_date__lte=as_of_date,
        )
        .exclude(
            status__in=[
                Bill.Status.DRAFT,
                Bill.Status.VOID,
                Bill.Status.PAID,
            ],
        )
    )

    if supplier is not None:
        queryset = queryset.filter(supplier=supplier)

    queryset = queryset.order_by(
        "supplier__name",
        "supplier_id",
        "due_date",
        "bill_number",
    )

    buckets = _empty_buckets()
    suppliers = OrderedDict()
    total_outstanding = ZERO

    for bill in queryset:
        amount_due = (
            bill.total
            - bill.amount_paid
            - bill.amount_credited
        )

        if amount_due <= ZERO:
            continue

        days_overdue = (as_of_date - bill.due_date).days
        bucket = get_aging_bucket(days_overdue)
        supplier_data = suppliers.setdefault(
            bill.supplier_id,
            {
                "supplier": {
                    "id": str(bill.supplier_id),
                    "name": bill.supplier.name,
                },
                "buckets": _empty_buckets(),
                "total_outstanding": ZERO,
                "bills": [],
            },
        )

        buckets[bucket] += amount_due
        total_outstanding += amount_due
        supplier_data["buckets"][bucket] += amount_due
        supplier_data["total_outstanding"] += amount_due
        supplier_data["bills"].append(
            {
                "id": str(bill.id),
                "bill_number": bill.bill_number,
                "issue_date": bill.issue_date,
                "due_date": bill.due_date,
                "days_overdue": days_overdue,
                "bucket": bucket,
                "total": bill.total,
                "amount_paid": bill.amount_paid,
                "amount_due": amount_due,
            }
        )

    return {
        "as_of_date": as_of_date,
        "buckets": buckets,
        "total_outstanding": total_outstanding,
        "suppliers": list(suppliers.values()),
    }
