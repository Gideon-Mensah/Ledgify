"""Read-only tax reporting projection. Original postings and dated reversals stay separate."""
from decimal import Decimal
from apps.accounting.models import LEDGER_EFFECTIVE_JOURNAL_STATUSES
from apps.fx.services import convert_amount
from apps.tax.models import TaxTransaction

ZERO = Decimal("0.00")
CREDITS = {"customer_credit", "supplier_credit"}


def tax_register(*, organisation, **filters):
    transactions = TaxTransaction.objects.filter(organisation=organisation, journal_entry__organisation=organisation, contact__organisation=organisation, tax_rate__organisation=organisation).select_related(
        "tax_rate", "contact", "journal_entry", "journal_entry__reversal_entry")
    for key in ("tax_rate", "direction", "status", "source_type"):
        if filters.get(key):
            transactions = transactions.filter(**{key: filters[key]})
    if filters.get("search"):
        from django.db.models import Q
        search = filters["search"]
        transactions = transactions.filter(Q(document_number__icontains=search) | Q(contact__name__icontains=search) | Q(tax_rate__code__icontains=search))
    # Older credit journals have no FX metadata; their immutable source document
    # still carries the exact rate used by the existing posting service.
    from apps.sales.models import Invoice, CustomerCreditNote
    from apps.purchases.models import Bill, SupplierCredit
    from common.exceptions import BusinessRuleError
    transactions = list(transactions)
    sources = {}
    for source_type, model in (("invoice", Invoice), ("bill", Bill), ("customer_credit", CustomerCreditNote), ("supplier_credit", SupplierCredit)):
        ids = [item.source_id for item in transactions if item.source_type == source_type]
        sources.update({(source_type, document.id): document for document in model.objects.filter(organisation=organisation, id__in=ids)})
    rows = []
    for transaction in transactions:
        journal = transaction.journal_entry
        source = sources.get((transaction.source_type, transaction.source_id))
        source_currency = getattr(source, "currency", "") or journal.transaction_currency or organisation.base_currency
        rate = journal.exchange_rate if journal.exchange_rate is not None else getattr(source, "exchange_rate", None)
        if rate is None:
            if source_currency != organisation.base_currency:
                raise BusinessRuleError("A tax posting has no stored exchange rate. Review the source document before reporting.")
            rate = Decimal("1")
        sign = Decimal("-1") if transaction.source_type in CREDITS else Decimal("1")
        reversal = getattr(journal, "reversal_entry", None)
        events = [(str(transaction.id), transaction.transaction_date, sign, False, journal)]
        if reversal and reversal.status in LEDGER_EFFECTIVE_JOURNAL_STATUSES:
            events.append((f"{transaction.id}:reversal", reversal.date, -sign, True, reversal))
        for row_id, date, factor, is_reversal, event_journal in events:
            if filters.get("start_date") and date < filters["start_date"]: continue
            if filters.get("end_date") and date > filters["end_date"]: continue
            included = event_journal.status in LEDGER_EFFECTIVE_JOURNAL_STATUSES
            inclusion = "included" if included else "excluded" if event_journal.status == "void" else "awaiting"
            if filters.get("inclusion") and filters["inclusion"] != inclusion: continue
            if filters.get("reversed_only") and not is_reversal: continue
            amounts = {name: factor * convert_amount(amount=getattr(transaction, name), rate=rate)
                       for name in ("net_amount", "tax_amount", "gross_amount")}
            rows.append({"id": row_id, "transaction_date": date, "document_number": transaction.document_number,
                         "contact_name": transaction.contact.name, "source_type": transaction.source_type,
                         "source_id": str(transaction.source_id), "tax_rate": str(transaction.tax_rate_id),
                         "tax_rate_code": transaction.tax_rate.code, "tax_rate_percent": transaction.tax_rate_percent,
                         "direction": transaction.direction, "status": transaction.status, "inclusion": inclusion,
                         "is_reversal": is_reversal, "is_credit": transaction.source_type in CREDITS,
                         "is_adjustment": is_reversal or transaction.status == "ADJUSTMENT" or transaction.source_type in CREDITS,
                         "journal_id": str(event_journal.id), "journal_number": event_journal.entry_number,
                         "journal_status": event_journal.status, "currency": organisation.base_currency,
                         "source_currency": source_currency,
                         "exchange_rate": rate, "original_tax_amount": transaction.tax_amount,
                         **amounts})
    if filters.get("adjustments_only"):
        rows = [row for row in rows if row["is_adjustment"]]
    ordering = filters.get("ordering", "-transaction_date")
    key = ordering.lstrip("-")
    rows.sort(key=lambda row: (row[key], row["id"]), reverse=ordering.startswith("-"))
    totals = {key: ZERO for key in ("sales_net", "purchase_net", "output_tax", "input_tax", "net_amount", "tax_amount", "gross_amount", "adjustments", "credit_adjustments")}
    for row in rows:
        if row["inclusion"] != "included": continue
        output = row["direction"] == "OUTPUT"
        totals["sales_net" if output else "purchase_net"] += row["net_amount"]
        totals["output_tax" if output else "input_tax"] += row["tax_amount"]
        for key in ("net_amount", "tax_amount", "gross_amount"): totals[key] += row[key]
        if row["is_adjustment"]: totals["adjustments"] += row["tax_amount"] * (1 if output else -1)
        if row["is_credit"]: totals["credit_adjustments"] += abs(row["tax_amount"])
    totals["net_tax_due_or_refundable"] = totals["output_tax"] - totals["input_tax"]
    return {"results": rows, "summary": totals, "count": len(rows), "currency": organisation.base_currency}
