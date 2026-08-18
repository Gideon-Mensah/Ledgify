"""Build an auditable supplier statement from bills, credits, and payments."""

from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone

from common.exceptions import BusinessRuleError

from apps.purchases.models import (
    Bill,
    SupplierCredit,
    SupplierPayment,
    SupplierRefund,
)


ZERO = Decimal("0.00")


def supplier_statement(
    *,
    organisation,
    supplier,
    start_date=None,
    end_date=None,
):
    if supplier.organisation_id != organisation.id:
        raise BusinessRuleError(
            "Supplier does not belong to this organisation."
        )

    if not supplier.is_supplier:
        raise BusinessRuleError(
            "The selected contact is not a supplier."
        )

    end_date = end_date or timezone.localdate()

    if start_date and end_date < start_date:
        raise BusinessRuleError(
            "End date cannot be earlier than start date."
        )

    bills = Bill.objects.filter(
        organisation=organisation,
        supplier=supplier,
    ).exclude(
        status__in=[
            Bill.Status.DRAFT,
            Bill.Status.VOID,
        ],
    )
    payments = (
        SupplierPayment.objects
        .select_related("bill")
        .filter(
            organisation=organisation,
            supplier=supplier,
            status=SupplierPayment.Status.POSTED,
        )
    )
    credits = SupplierCredit.objects.filter(
        organisation=organisation,
        supplier=supplier,
        status__in=[
            SupplierCredit.Status.APPROVED,
            SupplierCredit.Status.PARTLY_APPLIED,
            SupplierCredit.Status.APPLIED,
        ],
    )
    refunds = SupplierRefund.objects.filter(
        organisation=organisation,
        supplier=supplier,
        status=SupplierRefund.Status.POSTED,
    )

    opening_balance = ZERO

    if start_date:
        bill_opening = bills.filter(
            issue_date__lt=start_date,
        ).aggregate(total=Sum("total"))["total"] or ZERO
        payment_opening = payments.filter(
            payment_date__lt=start_date,
        ).aggregate(total=Sum("amount"))["total"] or ZERO
        opening_balance = bill_opening - payment_opening
        credit_opening = credits.filter(
            issue_date__lt=start_date,
        ).aggregate(total=Sum("total"))["total"] or ZERO
        opening_balance -= credit_opening
        refund_opening = refunds.filter(
            refund_date__lt=start_date,
        ).aggregate(total=Sum("amount"))["total"] or ZERO
        opening_balance += refund_opening

    period_bills = bills.filter(issue_date__lte=end_date)
    period_payments = payments.filter(payment_date__lte=end_date)
    period_credits = credits.filter(issue_date__lte=end_date)
    period_refunds = refunds.filter(refund_date__lte=end_date)

    if start_date:
        period_bills = period_bills.filter(
            issue_date__gte=start_date,
        )
        period_payments = period_payments.filter(
            payment_date__gte=start_date,
        )
        period_credits = period_credits.filter(issue_date__gte=start_date)
        period_refunds = period_refunds.filter(refund_date__gte=start_date)

    transactions = []

    for bill in period_bills:
        transactions.append(
            {
                "type": "bill",
                "id": str(bill.id),
                "date": bill.issue_date,
                "reference": bill.bill_number,
                "description": f"Bill {bill.bill_number}",
                "debit": ZERO,
                "credit": bill.total,
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
                    f"Payment for bill {payment.bill.bill_number}"
                    if payment.bill_id
                    else "Unallocated supplier payment"
                ),
                "debit": payment.amount,
                "credit": ZERO,
                "_priority": 1,
            }
        )

    for credit in period_credits:
        transactions.append({
            "type": "supplier_credit", "id": str(credit.id),
            "date": credit.issue_date, "reference": credit.credit_number,
            "description": f"Supplier credit {credit.credit_number}",
            "debit": credit.total, "credit": ZERO, "_priority": 1,
        })

    for refund in period_refunds:
        transactions.append({
            "type": "refund",
            "id": str(refund.id),
            "date": refund.refund_date,
            "reference": refund.reference,
            "description": "Supplier refund",
            "debit": ZERO,
            "credit": refund.amount,
            "_priority": 2,
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
    period_bill_total = ZERO
    period_payment_total = ZERO

    for transaction in transactions:
        # AP rows use traditional debit/credit presentation, while the
        # running balance remains the positive amount owed to the supplier.
        running_balance += transaction["credit"]
        running_balance -= transaction["debit"]
        transaction["balance"] = running_balance
        transaction.pop("_priority")
        if transaction["type"] == "bill":
            period_bill_total += transaction["credit"]
        elif transaction["type"] == "payment":
            period_payment_total += transaction["debit"]

    return {
        "supplier": {
            "id": str(supplier.id),
            "name": supplier.name,
            "account_number": supplier.account_number,
        },
        "start_date": start_date,
        "end_date": end_date,
        "opening_balance": opening_balance,
        "transactions": transactions,
        "period_bills": period_bill_total,
        "period_payments": period_payment_total,
        "closing_balance": running_balance,
    }
