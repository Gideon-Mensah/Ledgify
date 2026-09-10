"""Cutoff-based subledger balances. Recorded timestamps never override effective dates.

Original journals remain effective until their dated reversal. Document carrying
values use their original exchange rate; the reconciliation bridge separately
shows control movements (including revaluations and opening/manual entries).
Legacy allocations without an effective date block historical output pending a
reviewed data plan; recording timestamps are not invented accounting dates.
"""
from collections import OrderedDict
from decimal import Decimal
from django.db.models import Sum
from django.db import transaction
from common.ledger_integrity import lock_ledger
from common.exceptions import BusinessRuleError
from apps.finance.services.allocations.carrying import control_value
from django.utils import timezone
from apps.accounting.models import JournalLine, LEDGER_EFFECTIVE_JOURNAL_STATUSES
from apps.fx.services import convert_amount
from .buckets import AGING_BUCKETS, get_aging_bucket

ZERO = Decimal("0.00")


def buckets():
    return {bucket.key: ZERO for bucket in AGING_BUCKETS}


def effective_journal(document, cutoff):
    journal = document.accounting_journal
    if not journal or journal.status not in LEDGER_EFFECTIVE_JOURNAL_STATUSES or journal.date > cutoff:
        return False
    reversal = getattr(journal, "reversal_entry", None)
    return not (reversal and reversal.status in LEDGER_EFFECTIVE_JOURNAL_STATUSES and reversal.date <= cutoff)


def event_date(event, field):
    value = getattr(event, "effective_date", None)
    if value is None:
        raise BusinessRuleError("Historical allocations lack verified accounting dates. Run audit_accounting_integrity and approve a separate legacy-data reconciliation before reporting.")
    return value


def allocation_active(event, cutoff, timestamp):
    if event_date(event, timestamp) > cutoff:
        return False
    if getattr(event, "status", None) == "reversed":
        reversal_date = event.reversal_effective_date
        if not reversal_date:
            raise BusinessRuleError("A historical unallocation lacks a verified effective reversal date; review its accounting history before reporting.")
        if reversal_date and reversal_date <= cutoff:
            return False
    return True


@transaction.atomic
def historical_aging(*, organisation, as_of_date, payable=False, contact=None):
    lock_ledger(organisation.pk)
    if payable:
        from apps.purchases.models import Bill as Document, SupplierPayment as Payment, SupplierCredit as Credit, SupplierRefund as Refund
        party, documents_key, number_field, document_key, credit_key = "supplier", "bills", "bill_number", "bill", "credit"
    else:
        from apps.sales.models import Invoice as Document, CustomerPayment as Payment, CustomerCreditNote as Credit, CustomerRefund as Refund
        party, documents_key, number_field, document_key, credit_key = "customer", "invoices", "invoice_number", "invoice", "credit_note"
    base_currency = organisation.base_currency
    groups, currencies = OrderedDict(), {}
    totals = buckets()
    gross = ZERO
    legacy = 0
    source_ids = set()
    documents = Document.objects.filter(organisation=organisation, accounting_journal__isnull=False).select_related(party, "accounting_journal", "accounting_journal__reversal_entry").order_by(f"{party}__name", "due_date", number_field)
    if contact is not None:
        documents = documents.filter(**{party: contact})

    def currency_group(code):
        return currencies.setdefault(code, {"currency": code, "gross_outstanding": ZERO,
            "unallocated_payments": ZERO, "unallocated_credits": ZERO, "net_outstanding": ZERO})

    def person_group(person):
        return groups.setdefault(person.pk, {party: {"id": str(person.pk), "name": person.name},
            "currency": base_currency, "buckets": buckets(), "total_outstanding": ZERO,
            "unallocated_payments": ZERO, "unallocated_credits": ZERO, documents_key: []})

    for document in documents:
        source_ids.add(document.pk)
        if not effective_journal(document, as_of_date):
            continue
        paid, credited, written_off = ZERO, ZERO, ZERO
        consumed_base = ZERO
        for allocation in document.payment_allocations.filter(organisation=organisation).select_related("payment__accounting_journal", "payment__accounting_journal__reversal_entry"):
            legacy += allocation.effective_date is None
            if allocation_active(allocation, as_of_date, "allocated_at") and effective_journal(allocation.payment, as_of_date):
                paid += allocation.amount
                source_ids.add(allocation.pk)
                consumed_base += allocation.carrying_base_amount if allocation.carrying_base_amount is not None else convert_amount(amount=allocation.amount,rate=document.exchange_rate)
        for allocation in document.credit_allocations.filter(organisation=organisation).select_related(f"{credit_key}__accounting_journal", f"{credit_key}__accounting_journal__reversal_entry"):
            legacy += allocation.effective_date is None
            if allocation_active(allocation, as_of_date, "applied_at") and effective_journal(getattr(allocation, credit_key), as_of_date):
                credited += allocation.amount
                source_ids.add(allocation.pk)
                consumed_base += allocation.carrying_base_amount if allocation.carrying_base_amount is not None else convert_amount(amount=allocation.amount,rate=document.exchange_rate)
        if not payable:
            for write_off in document.write_offs.filter(organisation=organisation).select_related("accounting_journal", "accounting_journal__reversal_entry"):
                source_ids.add(write_off.pk)
                if effective_journal(write_off, as_of_date):
                    written_off += write_off.amount
                    consumed_base -= control_value(write_off)
        outstanding = document.total - paid - credited - written_off
        if outstanding == ZERO:
            continue
        base = control_value(document,payable=payable) - consumed_base
        days = (as_of_date - document.due_date).days
        bucket = get_aging_bucket(days)
        person = person_group(getattr(document, party))
        person["buckets"][bucket] += base
        person["total_outstanding"] += base
        person[documents_key].append({"id": str(document.pk), number_field: getattr(document, number_field),
            "issue_date": document.issue_date, "due_date": document.due_date, "days_overdue": days,
            "bucket": bucket, "currency": document.currency, "total": document.total,
            "amount_paid": paid, "amount_credited": credited, "amount_written_off": written_off,
            "amount_due": outstanding, "base_amount_due": base, "exchange_rate": document.exchange_rate})
        currency_group(document.currency)["gross_outstanding"] += outstanding
        totals[bucket] += base
        gross += base

    unallocated_payments, unallocated_credits = ZERO, ZERO
    for model, label, timestamp in [(Payment, "unallocated_payments", "allocated_at"), (Credit, "unallocated_credits", "applied_at")]:
        sources = model.objects.filter(organisation=organisation, accounting_journal__isnull=False).select_related(party, "accounting_journal", "accounting_journal__reversal_entry")
        if contact is not None:
            sources = sources.filter(**{party: contact})
        for source in sources:
            source_ids.add(source.pk)
            if not effective_journal(source, as_of_date):
                continue
            used = ZERO
            used_base = ZERO
            source_base = -control_value(source,payable=payable)
            source_total = source.amount if model is Payment else source.total
            for allocation in source.allocations.filter(organisation=organisation).select_related(f"{document_key}__accounting_journal", f"{document_key}__accounting_journal__reversal_entry"):
                if allocation_active(allocation, as_of_date, timestamp) and effective_journal(getattr(allocation, document_key), as_of_date):
                    used += allocation.amount
                    used_base += allocation.source_base_amount if allocation.source_base_amount is not None else convert_amount(amount=allocation.amount,rate=source_base/source_total)
            total = source.amount if model is Payment else source.total
            if model is Credit:
                for refund in source.refunds.filter(organisation=organisation).select_related("accounting_journal", "accounting_journal__reversal_entry"):
                    source_ids.add(refund.pk)
                    if effective_journal(refund, as_of_date):
                        used += refund.amount
                        used_base += control_value(refund,payable=payable)
            outstanding = total - used
            base = source_base - used_base
            currency_group(source.currency)[label] += outstanding
            person = person_group(getattr(source, party))
            person[label] += base
            person["total_outstanding"] -= base
            if model is Payment:
                unallocated_payments += base
            else:
                unallocated_credits += base

    standalone_refunds=ZERO
    if not payable:
        refunds=Refund.objects.filter(organisation=organisation,credit_note=None).select_related("customer","accounting_journal","accounting_journal__reversal_entry")
        if contact is not None:refunds=refunds.filter(customer=contact)
        for refund in refunds:
            source_ids.add(refund.pk)
            if effective_journal(refund,as_of_date):
                base=control_value(refund)
                standalone_refunds+=base
                group=currency_group(refund.currency)
                group["standalone_refunds"]=group.get("standalone_refunds",ZERO)+refund.amount
                person_group(refund.customer)["total_outstanding"]+=base

    for row in currencies.values():
        row["net_outstanding"] = row["gross_outstanding"] - row["unallocated_payments"] - row["unallocated_credits"] + row.get("standalone_refunds",ZERO)
    net = gross - unallocated_payments - unallocated_credits + standalone_refunds
    control = JournalLine.objects.filter(journal_entry__organisation=organisation,
        journal_entry__status__in=LEDGER_EFFECTIVE_JOURNAL_STATUSES,
        journal_entry__date__lte=as_of_date, account__organisation=organisation,
        account__account_class="payable" if payable else "receivable")
    if contact is not None:
        # Contact-specific controls use source provenance, including exact reversals.
        from django.db.models import Q
        control = control.filter(Q(journal_entry__source_id__in=source_ids) | Q(journal_entry__reversal_of__source_id__in=source_ids))
    sums = control.aggregate(debit=Sum("debit"), credit=Sum("credit"))
    ledger = (sums["credit"] or ZERO) - (sums["debit"] or ZERO) if payable else (sums["debit"] or ZERO) - (sums["credit"] or ZERO)
    # Only independently identifiable non-document movements belong in the bridge.
    # Any remaining difference is surfaced, never labelled reconciled by identity.
    bridge_types=("opening_balance","manual","fx_revaluation")
    bridge_rows=list(control.filter(journal_entry__source_type__in=bridge_types).values(
        "journal_entry_id","journal_entry__source_type").annotate(debit=Sum("debit"),credit=Sum("credit")))
    bridge=ZERO
    for row in bridge_rows:
        row["base_amount"]=(row["credit"]-row["debit"]) if payable else (row["debit"]-row["credit"])
        bridge+=row["base_amount"]
    reconciliation_difference=ledger-net-bridge
    return {"as_of_date": as_of_date, "currency": base_currency, "base_currency": base_currency,
        "buckets": totals, "gross_outstanding": gross, "total_outstanding": net,
        "unallocated_payments": unallocated_payments, "unallocated_credits": unallocated_credits, "standalone_refunds": standalone_refunds,
        "currency_totals": list(currencies.values()), f"{party}s": list(groups.values()),
        "control_balance": ledger, "other_control_movements": ledger - net,
        "control_adjustments": bridge_rows, "reconciliation_difference": reconciliation_difference,
        "reconciled": reconciliation_difference == ZERO, "reconciled_balance": net + bridge,
        "legacy_allocations_requiring_review": legacy,
        "exchange_rate_policy": "Original document carrying rate; opening, manual, revaluation and other control movements shown separately.",
        "due_date_policy": "Due date is current through the due date; overdue starts the following day."}
