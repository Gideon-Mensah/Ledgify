"""Versioned configuration extends TaxRate/TaxTransaction; it does not replace the ledger."""
import uuid
from django.conf import settings
from django.db import models
from django.core.exceptions import ValidationError


class TaxOwned(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey('organisations.Organisation', on_delete=models.PROTECT)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True


class ImmutableTaxRecord(TaxOwned):
    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError('Tax audit records are immutable; create a new event/version.')
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError('Tax audit records cannot be deleted.')

    class Meta:
        abstract = True


class TaxRegimeVersion(models.Model):
    """Global published catalogue, never editable through a customer API."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    jurisdiction = models.CharField(max_length=2)
    regime = models.CharField(max_length=40)
    version = models.CharField(max_length=40)
    effective_from = models.DateField()
    source = models.URLField(max_length=500)
    source_checked_on = models.DateField()
    catalogue = models.JSONField()
    checksum = models.CharField(max_length=64)
    verified = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['jurisdiction', 'regime', 'version'], name='tax_regime_version_unique')]


class OrganisationTaxProfile(TaxOwned):
    structure = models.CharField(max_length=30, choices=[(v, v) for v in ('GHANA_GRA', 'CUSTOM_INTERNATIONAL', 'NO_TAX')])
    jurisdiction = models.CharField(max_length=2)
    version = models.PositiveIntegerField()
    effective_from = models.DateField()
    status = models.CharField(max_length=20, default='DRAFT')
    # Explicit, validated registration/configuration fields; no credentials.
    registration = models.JSONField(default=dict)
    mappings = models.JSONField(default=dict)
    reason = models.TextField()
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name='+')
    activated_at = models.DateTimeField(null=True)
    source = models.CharField(max_length=500, blank=True)
    separate_approval = models.BooleanField(default=True)
    maximum_rate = models.DecimalField(max_digits=12, decimal_places=4, default=1000)
    high_rate_threshold = models.DecimalField(max_digits=12, decimal_places=4, default=100)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organisation', 'version'], name='tax_profile_version_unique')]


class OrganisationTaxRegistration(ImmutableTaxRecord):
    profile = models.ForeignKey(OrganisationTaxProfile, on_delete=models.PROTECT, related_name='obligations')
    obligation = models.CharField(max_length=40)
    status = models.CharField(max_length=20, default='TRACKING_ONLY')
    effective_from = models.DateField()
    effective_to = models.DateField(null=True)
    frequency = models.CharField(max_length=20, blank=True)
    notes = models.TextField(blank=True)
    source = models.CharField(max_length=500, blank=True)
    account = models.ForeignKey('accounting.Account', on_delete=models.PROTECT, null=True)


class TaxCode(TaxOwned):
    code = models.CharField(max_length=40)
    name = models.CharField(max_length=150)
    family = models.CharField(max_length=20, default='INDIRECT')
    scope = models.CharField(max_length=20, default='BOTH')
    jurisdiction = models.CharField(max_length=2)
    statutory = models.BooleanField(default=False)
    tracking_only = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organisation', 'code'], name='tax_code_org_unique')]


class TaxRateVersion(TaxOwned):
    code = models.ForeignKey(TaxCode, on_delete=models.PROTECT, related_name='versions')
    number = models.PositiveIntegerField()
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    classification = models.CharField(max_length=25, default='STANDARD')
    provenance = models.CharField(max_length=30, default='PENDING_REVIEW')
    status = models.CharField(max_length=20, default='DRAFT')
    components = models.JSONField(default=list)
    rules = models.JSONField(default=dict)
    source = models.CharField(max_length=500)
    reason = models.TextField()
    preset = models.ForeignKey(TaxRegimeVersion, on_delete=models.PROTECT, null=True, blank=True)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name='+')
    approved_at = models.DateTimeField(null=True)
    activated_at = models.DateTimeField(null=True)
    checksum = models.CharField(max_length=64)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['organisation', 'code', 'number'], name='tax_code_version_unique'),
            models.CheckConstraint(condition=models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=models.F('effective_from')), name='tax_version_dates_valid'),
        ]


class TaxApplicabilityRule(TaxOwned):
    """Activation windows are separate from immutable statutory rate content."""
    code = models.ForeignKey(TaxCode, on_delete=models.PROTECT)
    version = models.OneToOneField(TaxRateVersion, on_delete=models.PROTECT, related_name='window')
    start = models.DateField()
    end = models.DateField(null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['organisation', 'code', 'start'], name='tax_window_start_unique'),
            models.CheckConstraint(condition=models.Q(end__isnull=True) | models.Q(end__gte=models.F('start')), name='tax_window_dates_valid'),
        ]


class TaxAccountMapping(ImmutableTaxRecord):
    version = models.ForeignKey(TaxRateVersion, on_delete=models.PROTECT, related_name='account_mappings')
    component_code = models.CharField(max_length=30)
    direction = models.CharField(max_length=10)
    account = models.ForeignKey('accounting.Account', on_delete=models.PROTECT)
    legacy_rate = models.ForeignKey('tax.TaxRate', on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['version', 'component_code', 'direction'], name='tax_component_mapping_unique')]


class DocumentTaxSnapshot(ImmutableTaxRecord):
    source_type = models.CharField(max_length=30)
    source_id = models.UUIDField()
    tax_point = models.DateField()
    currency = models.CharField(max_length=3)
    base_currency = models.CharField(max_length=3)
    exchange_rate = models.DecimalField(max_digits=20, decimal_places=10)
    journal = models.OneToOneField('accounting.JournalEntry', on_delete=models.PROTECT)
    payload = models.JSONField()
    checksum = models.CharField(max_length=64)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organisation', 'source_type', 'source_id'], name='document_tax_snapshot_unique')]


class DocumentLineTaxSnapshot(ImmutableTaxRecord):
    document = models.ForeignKey(DocumentTaxSnapshot, on_delete=models.PROTECT, related_name='lines')
    source_line_id = models.UUIDField()
    version = models.ForeignKey(TaxRateVersion, on_delete=models.PROTECT, null=True)
    payload = models.JSONField()


class TaxConfigurationAudit(ImmutableTaxRecord):
    event = models.CharField(max_length=50)
    subject_id = models.UUIDField(null=True)
    reason = models.TextField()
    before = models.JSONField(default=dict)
    after = models.JSONField(default=dict)


class TaxReturnDraft(TaxOwned):
    period = models.ForeignKey('tax.TaxPeriod', on_delete=models.PROTECT, related_name='returns')
    kind = models.CharField(max_length=20, default='VAT')
    revision = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=20, default='DRAFT')
    snapshot = models.JSONField(default=dict)
    checksum = models.CharField(max_length=64, blank=True)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name='+')
    approved_at = models.DateTimeField(null=True)
    amends = models.ForeignKey('self', on_delete=models.PROTECT, null=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organisation', 'period', 'kind', 'revision'], name='tax_return_revision_unique')]


class TaxFilingEvidence(ImmutableTaxRecord):
    tax_return = models.ForeignKey(TaxReturnDraft, on_delete=models.PROTECT, related_name='evidence', null=True)
    obligation = models.ForeignKey(OrganisationTaxRegistration, on_delete=models.PROTECT, null=True)
    acknowledgement = models.CharField(max_length=200)
    filename = models.CharField(max_length=200, blank=True)
    content_type = models.CharField(max_length=50, blank=True)
    # Private, bounded evidence served only through an authenticated endpoint.
    content = models.BinaryField(null=True)
    checksum = models.CharField(max_length=64, blank=True)
    notes = models.TextField(blank=True)


class TaxAdjustment(ImmutableTaxRecord):
    idempotency_key = models.UUIDField(null=True)
    payload_checksum = models.CharField(max_length=64, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organisation','idempotency_key'], name='taxadjustment_request_unique')]

    period = models.ForeignKey('tax.TaxPeriod', on_delete=models.PROTECT)
    original_return = models.ForeignKey(TaxReturnDraft, on_delete=models.PROTECT, null=True)
    component_code = models.CharField(max_length=30)
    direction = models.CharField(max_length=10)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    account = models.ForeignKey('accounting.Account', on_delete=models.PROTECT)
    journal = models.OneToOneField('accounting.JournalEntry', on_delete=models.PROTECT)
    reason = models.TextField()


class TaxPayment(ImmutableTaxRecord):
    idempotency_key = models.UUIDField(null=True)
    payload_checksum = models.CharField(max_length=64, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organisation','idempotency_key'], name='taxpayment_request_unique')]

    tax_return = models.ForeignKey(TaxReturnDraft, on_delete=models.PROTECT, related_name='payments')
    payment_date = models.DateField()
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    reference = models.CharField(max_length=200)
    journal = models.OneToOneField('accounting.JournalEntry', on_delete=models.PROTECT)


class WithholdingTransaction(ImmutableTaxRecord):
    family = models.CharField(max_length=20)  # WHT and VAT_WHT are distinct.
    version = models.ForeignKey(TaxRateVersion, on_delete=models.PROTECT)
    payment_id = models.UUIDField()
    supplier_payment = models.BooleanField()
    journal = models.ForeignKey('accounting.JournalEntry', on_delete=models.PROTECT)
    contact = models.ForeignKey('contacts.Contact', on_delete=models.PROTECT)
    account = models.ForeignKey('accounting.Account', on_delete=models.PROTECT)
    payment_date = models.DateField()
    currency = models.CharField(max_length=3)
    gross_amount = models.DecimalField(max_digits=18, decimal_places=2)
    withheld_amount = models.DecimalField(max_digits=18, decimal_places=2)
    net_amount = models.DecimalField(max_digits=18, decimal_places=2)
    base_withheld_amount = models.DecimalField(max_digits=18, decimal_places=2)
    certificate = models.CharField(max_length=200, blank=True)
    details = models.JSONField(default=dict)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organisation', 'payment_id', 'family'], name='tax_payment_withholding_unique')]


class TaxExport(ImmutableTaxRecord):
    tax_return = models.ForeignKey(TaxReturnDraft, on_delete=models.PROTECT, null=True)
    template_version = models.CharField(max_length=100)
    source = models.CharField(max_length=500)
    checksum = models.CharField(max_length=64)
    row_count = models.PositiveIntegerField()
    reconciliation = models.JSONField(default=dict)


class TaxCalendarEntry(TaxOwned):
    registration = models.ForeignKey(OrganisationTaxRegistration, on_delete=models.PROTECT)
    period_start = models.DateField()
    period_end = models.DateField()
    due_date = models.DateField()
    payment_due_date = models.DateField(null=True)
    responsible_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    reminders = models.JSONField(default=list)
    status = models.CharField(max_length=20, default='OPEN')
    rule_source = models.CharField(max_length=500)
    rule_version = models.CharField(max_length=40)
    acknowledgement = models.CharField(max_length=200, blank=True)
    payment_reference = models.CharField(max_length=200, blank=True)


class TaxClassification(ImmutableTaxRecord):
    product = models.ForeignKey('inventory.Product', on_delete=models.PROTECT, null=True)
    contact = models.ForeignKey('contacts.Contact', on_delete=models.PROTECT, null=True)
    code = models.ForeignKey(TaxCode, on_delete=models.PROTECT)
    effective_from = models.DateField()
    source_note = models.TextField()


class EvatCertification(ImmutableTaxRecord):
    invoice = models.ForeignKey('sales.Invoice', on_delete=models.PROTECT)
    # Reserved response contract. No user-editable API or fake responses.
    certification_status = models.CharField(max_length=30)
    receipt_identifier = models.CharField(max_length=200)
    serial_number = models.CharField(max_length=200)
    verification_identifier = models.CharField(max_length=200)
    signature = models.TextField()
    timestamp = models.DateTimeField()
    qr_payload = models.TextField()
    request_reference = models.CharField(max_length=200)
    schema_version = models.CharField(max_length=40)
    offline = models.BooleanField(default=False)
    synchronization_status = models.CharField(max_length=30)
    replacement = models.ForeignKey('self', on_delete=models.PROTECT, null=True)
