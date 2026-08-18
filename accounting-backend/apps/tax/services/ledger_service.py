"""Validate tax configuration and build tax ledger entries for posted documents."""

from collections import defaultdict
from decimal import Decimal

from django.db import transaction

from common.exceptions import BusinessRuleError
from apps.tax.models import TaxPeriod, TaxRate, TaxTransaction


@transaction.atomic
def record_tax_transactions(*, document, lines, journal_entry, source_type, direction, document_number, contact):
    if TaxPeriod.objects.filter(
        organisation=document.organisation, start_date__lte=document.issue_date,
        end_date__gte=document.issue_date, status__in=[TaxPeriod.Status.FILED, TaxPeriod.Status.LOCKED],
    ).exists():
        raise BusinessRuleError("The document date belongs to a filed or locked tax period. Use an adjustment in an open period.")
    grouped = defaultdict(lambda: {"net": Decimal("0.00"), "tax": Decimal("0.00"), "rate": None})
    for line in lines:
        if not line.tax_amount:
            continue
        rate = line.tax_rate_config
        if rate is None:
            raise BusinessRuleError("A configured tax rate is required for a taxed posted line.")
        item = grouped[rate.id]
        item["rate"] = rate
        item["net"] += line.line_total - line.tax_amount
        item["tax"] += line.tax_amount
    created = []
    for item in grouped.values():
        rate = item["rate"]
        account = rate.output_tax_account if direction == TaxTransaction.Direction.OUTPUT else rate.input_tax_account
        if account is None:
            raise BusinessRuleError("The selected tax rate is missing its required tax control account.")
        created.append(TaxTransaction.objects.create(
            organisation=document.organisation, tax_rate=rate, tax_rate_percent=rate.rate,
            transaction_date=document.issue_date, source_type=source_type, source_id=document.id,
            document_number=document_number, contact=contact, net_amount=item["net"],
            tax_amount=item["tax"], gross_amount=item["net"] + item["tax"], direction=direction,
            tax_account=account, journal_entry=journal_entry,
        ))
    return created


def validate_tax_rate(*, rate, organisation, scope, date):
    if not organisation.tax_registered:
        raise BusinessRuleError("The organisation is not registered for indirect tax.")
    if rate.organisation_id != organisation.id or rate.status != TaxRate.Status.ACTIVE:
        raise BusinessRuleError("Tax rate is inactive or belongs to another organisation.")
    if rate.scope not in {scope, TaxRate.Scope.BOTH}:
        raise BusinessRuleError("Tax rate cannot be used for this transaction type.")
    if date < rate.effective_from or (rate.effective_to and date > rate.effective_to):
        raise BusinessRuleError("Tax rate is not effective on the document date.")
