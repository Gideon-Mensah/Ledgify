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
    from apps.tax.document_tax import freeze_document
    from apps.tax.engine import decimal
    grouped = {}
    for line in lines:
        snapshot = getattr(line, 'tax_snapshot', {})
        if snapshot:
            for index, component in enumerate(snapshot['components']):
                rate_id = component.get('legacy_rate_id')
                if not rate_id:
                    continue
                rate = TaxRate.objects.get(organisation=document.organisation, pk=rate_id)
                amount = decimal(component['amount'] if direction == 'OUTPUT' else component.get('recoverable_amount', 0))
                if direction == 'INPUT' and not amount and decimal(component.get('nonrecoverable_amount', 0)):
                    continue
                account_id = component.get('output_account' if direction == 'OUTPUT' else 'input_account')
                if not account_id:
                    continue
                item = grouped.setdefault(rate_id, {'rate': rate, 'account_id': account_id, 'net': Decimal('0'), 'tax': Decimal('0'), 'base': Decimal('0'), 'snapshot': dict(component)})
                item['net'] += (line.line_total - line.tax_amount) if index == 0 else Decimal('0')
                item['base'] += line.line_total - line.tax_amount
                item['tax'] += amount
                item['snapshot'].update(classification=snapshot['classification'], version_id=snapshot.get('version_id'), tax_code=snapshot['code'])
        elif line.tax_amount:
            rate = line.tax_rate_config
            if rate is None:
                raise BusinessRuleError('A configured tax rate is required for a taxed posted line.')
            if direction == 'INPUT' and not rate.recoverable:
                continue
            account = rate.output_tax_account if direction == 'OUTPUT' else rate.input_tax_account
            if account is None:
                raise BusinessRuleError('The selected tax rate is missing its required tax control account.')
            item = grouped.setdefault(str(rate.pk), {'rate': rate, 'account_id': account.pk, 'net': Decimal('0'), 'tax': Decimal('0'), 'base': Decimal('0'), 'snapshot': {}})
            item['net'] += line.line_total - line.tax_amount
            item['tax'] += line.tax_amount
    created = []
    for item in grouped.values():
        if item['snapshot']:
            item['snapshot']['taxable_base'] = str(item['base'])
        created.append(TaxTransaction.objects.create(
            organisation=document.organisation, tax_rate=item['rate'],
            tax_rate_percent=0 if item['snapshot'].get('kind')=='FIXED' else item['snapshot'].get('rate', item['rate'].rate),
            transaction_date=document.issue_date, source_type=source_type, source_id=document.pk,
            document_number=document_number, contact=contact, net_amount=item['net'],
            tax_amount=item['tax'], gross_amount=item['net'] + item['tax'], direction=direction,
            tax_account_id=item['account_id'], journal_entry=journal_entry, component_snapshot=item['snapshot'],
        ))
    reverse_charge = {}
    for line in lines:
        if not line.tax_snapshot.get('self_assessed'):
            continue
        for component in line.tax_snapshot['components']:
            key = component['legacy_rate_id']
            item = reverse_charge.setdefault(key, {'component': component, 'amount': Decimal('0')})
            item['amount'] += decimal(component['amount'])
    for rate_id, item in reverse_charge.items():
        component = item['component']
        created.append(TaxTransaction.objects.create(
            organisation=document.organisation, tax_rate_id=rate_id, tax_rate_percent=0 if component.get('kind')=='FIXED' else component['rate'],
            transaction_date=document.issue_date, source_type=source_type, source_id=document.pk,
            document_number=document_number, contact=contact, net_amount=0, tax_amount=item['amount'],
            gross_amount=item['amount'], direction='OUTPUT', tax_account_id=component['output_account'],
            journal_entry=journal_entry, component_snapshot={**component, 'classification': 'REVERSE_CHARGE', 'self_assessed': True},
        ))
    freeze_document(document, lines, journal_entry, source_type)
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
