"""First organisation creation. No financial records are written by draft saves."""
import hashlib
import json
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones
from django.conf import settings
from django.db import transaction
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from apps.accounts.models import User, PolicyAcceptance
from apps.accounts.identity import audit, require_policy_configuration
from common.currencies import validate_currency_code
from common.documents import validate_logo
from .models import Organisation, OrganisationMember, OnboardingDraft, OrganisationSetup

BASE_ACCOUNTS = [
    ('1000','Bank','asset','bank','cash'), ('1100','Accounts receivable','asset','receivable','operating'),
    ('2000','Accounts payable','liability','payable','operating'), ('3000','Retained earnings','equity','retained_earnings','financing'),
    ('3100','Owner capital','equity','equity','financing'), ('4000','Sales','revenue','sales','operating'),
    ('5000','Operating expenses','expense','operating_expense','operating'),
]
EXTRA_ACCOUNTS = [('1200','Inventory','asset','current_asset','operating'), ('1500','Equipment','asset','fixed_asset','investing'), ('5100','Cost of sales','expense','cost_of_sales','operating')]
CHOICES = ['ghana_small_business','general','import_later','minimal']


def account_preview(choice):
    rows = BASE_ACCOUNTS + (EXTRA_ACCOUNTS if choice in {'ghana_small_business','general'} else [])
    return [{'code': c, 'name': n, 'account_type': t, 'account_class': k, 'cash_flow_category': f,
        'is_system_account': k in {'receivable','payable','retained_earnings'}} for c,n,t,k,f in rows]


class OnboardingInput(serializers.Serializer):
    terms_accepted = serializers.BooleanField(default=False)
    terms_version = serializers.CharField(max_length=100, required=False, allow_blank=True, default='')
    privacy_version = serializers.CharField(max_length=100, required=False, allow_blank=True, default='')
    legal_name = serializers.CharField(max_length=255)
    trading_name = serializers.CharField(max_length=255, allow_blank=True, required=False, default='')
    business_type = serializers.CharField(max_length=80)
    registration_number = serializers.CharField(max_length=100, allow_blank=True, required=False, default='')
    tax_number = serializers.CharField(max_length=100, allow_blank=True, required=False, default='')
    email = serializers.EmailField(max_length=254)
    phone = serializers.CharField(max_length=50)
    address_line_1 = serializers.CharField(max_length=255)
    address_line_2 = serializers.CharField(max_length=255, allow_blank=True, required=False, default='')
    city = serializers.CharField(max_length=100)
    region = serializers.CharField(max_length=100, allow_blank=True, required=False, default='')
    postal_code = serializers.CharField(max_length=30, allow_blank=True, required=False, default='')
    ghana_post_gps = serializers.CharField(max_length=30, allow_blank=True, required=False, default='')
    website = serializers.URLField(max_length=200, allow_blank=True, required=False, default='')
    logo_data = serializers.CharField(max_length=350000, allow_blank=True, required=False, default='')
    country_code = serializers.CharField(min_length=2, max_length=2)
    base_currency = serializers.CharField(min_length=3, max_length=3)
    timezone = serializers.CharField(max_length=100)
    locale = serializers.CharField(max_length=30)
    regional_confirmed = serializers.BooleanField()
    financial_year_start_month = serializers.IntegerField(min_value=1, max_value=12)
    first_year_start = serializers.DateField()
    first_year_end = serializers.DateField()
    accounting_start_date = serializers.DateField()
    reporting_basis = serializers.ChoiceField(choices=['ACCRUAL'])
    chart = serializers.ChoiceField(choices=CHOICES)
    tax_structure = serializers.ChoiceField(choices=['GHANA_GRA','CUSTOM_INTERNATIONAL','NO_TAX'])
    tax_effective_from = serializers.DateField()
    registration = serializers.JSONField(default=dict)
    activate_tax = serializers.BooleanField(default=False)
    tax_confirmation = serializers.BooleanField(default=False)
    opening_choice = serializers.ChoiceField(choices=['zero','enter_now','import_later','accountant'])

    def validate_logo_data(self, value):
        return validate_logo(value)

    def validate(self, data):
        data['country_code'] = data['country_code'].upper()
        if not data['country_code'].isascii() or not data['country_code'].isalpha():
            raise ValidationError({'country_code':'Choose a valid two-letter country code.'})
        data['base_currency'] = validate_currency_code(data['base_currency'])
        try: ZoneInfo(data['timezone'])
        except (ZoneInfoNotFoundError, ValueError): raise ValidationError({'timezone':'Choose a recognised timezone.'}) from None
        if not data['regional_confirmed']:
            raise ValidationError({'regional_confirmed':'Review the currency and timezone before creation.'})
        if not data['first_year_start'] < data['first_year_end']:
            raise ValidationError({'first_year_end':'The financial year must end after its start.'})
        if not data['first_year_start'] <= data['accounting_start_date'] <= data['first_year_end']:
            raise ValidationError({'accounting_start_date':'The accounting start must fall within the first financial year.'})
        if data['first_year_start'].month != data['financial_year_start_month']:
            raise ValidationError({'financial_year_start_month':'Match the first financial year start month.'})
        if data['country_code'] != 'GH' and (data['tax_structure'] == 'GHANA_GRA' or data['chart'] == 'ghana_small_business'):
            raise ValidationError('Ghana tax and chart choices require a Ghana organisation.')
        from apps.tax.configuration import _registration
        data['registration'] = _registration(data['registration'], data['tax_structure'])
        if data['tax_structure'] != 'GHANA_GRA' and any(data['registration'].get(k) for k in ('wht_agent','vat_wht_agent','paye_employer','evat_required')):
            raise ValidationError('Configure jurisdiction-specific obligations after organisation creation.')
        if data['activate_tax'] and not data['tax_confirmation']:
            raise ValidationError({'tax_confirmation':'Explicitly confirm the reviewed tax configuration before activation.'})
        return data


def options():
    from apps.tax.presets import GHANA_VERSION, GHANA_EFFECTIVE, VAT_COMPONENTS, GRA_VAT_SOURCE
    return {'policies': {'terms_version': settings.TERMS_VERSION, 'privacy_version': settings.PRIVACY_VERSION, 'terms_url': settings.TERMS_URL, 'privacy_url': settings.PRIVACY_URL}, 'charts': {key: account_preview(key) for key in CHOICES}, 'timezones': sorted(available_timezones()),
        'defaults': {'GH': {'base_currency':'GHS','timezone':'Africa/Accra','locale':'en-GH','tax_structure':'GHANA_GRA'},
                     'GB': {'base_currency':'GBP','timezone':'Europe/London','locale':'en-GB','tax_structure':'CUSTOM_INTERNATIONAL'}},
        'ghana_reference': {'version': GHANA_VERSION, 'effective_from': GHANA_EFFECTIVE, 'components': VAT_COMPONENTS, 'source': GRA_VAT_SOURCE}}


def safe_draft_payload(data):
    if not isinstance(data, dict) or len(json.dumps(data)) > 400000:
        raise ValidationError('Setup data is too large.')
    allowed = set(OnboardingInput().fields)
    if set(data) - allowed:
        raise ValidationError('Unsupported setup fields.')
    # Validate each provided field, but permit incomplete fields when saving progress.
    for key, value in data.items():
        if value not in ('', None):
            OnboardingInput().fields[key].run_validation(value)
    if data.get('logo_data'):
        data = {**data, 'logo_data': validate_logo(data['logo_data'])}
    return data


@transaction.atomic
def save_draft(user, data, step):
    User.objects.select_for_update().get(pk=user.pk)
    draft, _ = OnboardingDraft.objects.get_or_create(user=user)
    if draft.organisation_id:
        raise ValidationError('This setup is already complete.')
    draft.data = safe_draft_payload(data)
    draft.step = serializers.IntegerField(min_value=0, max_value=7).run_validation(step)
    draft.save(update_fields=['data','step','updated_at'])
    return draft


@transaction.atomic
def finish_onboarding(user, payload, idempotency_key, confirmed):
    user = User.objects.select_for_update().get(pk=user.pk)
    if not user.is_active or not user.is_email_verified:
        raise PermissionDenied('Sign in with a verified active account.')
    key = serializers.UUIDField().run_validation(idempotency_key)
    if confirmed is not True:
        raise ValidationError('Review and confirm organisation creation.')
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    draft, _ = OnboardingDraft.objects.get_or_create(user=user)
    if draft.organisation_id:
        if draft.idempotency_key != key or draft.payload_hash != digest:
            raise ValidationError('This setup was already completed. Select the created organisation.')
        if not OrganisationMember.objects.filter(organisation=draft.organisation, user=user, is_active=True, organisation__is_active=True).exists():
            raise PermissionDenied('The created organisation is unavailable.')
        return draft.organisation
    if OrganisationMember.objects.filter(user=user, is_active=True, organisation__is_active=True).exists():
        raise ValidationError('Select your existing organisation; this wizard creates your first organisation only.')
    policy = PolicyAcceptance.objects.filter(user=user).order_by('-accepted_at').first()
    serializer = OnboardingInput(data=payload)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    if not policy:
        require_policy_configuration()
        if not data['terms_accepted'] or data['terms_version'] != settings.TERMS_VERSION or data['privacy_version'] != settings.PRIVACY_VERSION:
            raise ValidationError('Review and accept the current Terms and Privacy Policy before creating an organisation.')
        policy = PolicyAcceptance.objects.create(user=user, terms_version=settings.TERMS_VERSION, privacy_version=settings.PRIVACY_VERSION, terms_url=settings.TERMS_URL, privacy_url=settings.PRIVACY_URL)
    business = {key: data[key] for key in ('legal_name','business_type','registration_number','tax_number','email','phone','address_line_1','address_line_2','city','region','postal_code','ghana_post_gps','website','logo_data','country_code','base_currency','timezone','locale','financial_year_start_month','accounting_start_date')}
    organisation = Organisation.objects.create(name=data['trading_name'] or data['legal_name'], created_by=user, **business)
    OrganisationMember.objects.create(organisation=organisation, user=user, role='owner')
    from apps.accounting.models import FinancialYear, AccountingPeriod, Account
    FinancialYear.objects.create(organisation=organisation, name=f"{data['first_year_start']} – {data['first_year_end']}", start_date=data['first_year_start'], end_date=data['first_year_end'])
    AccountingPeriod.objects.create(organisation=organisation, name='Initial open accounting period', start_date=data['accounting_start_date'], end_date=data['first_year_end'])
    for row in account_preview(data['chart']):
        Account.objects.create(organisation=organisation, created_by=user, **row)
    from apps.tax.configuration import create_profile, review_profile, activate_profile
    mappings = {}
    if data['tax_structure'] == 'GHANA_GRA' and data['activate_tax']:
        from apps.tax.operations import map_controls
        mappings = map_controls(organisation=organisation, user=user, mappings={}, confirmed=True)
    profile = create_profile(organisation=organisation, user=user, structure=data['tax_structure'], jurisdiction=data['country_code'],
        effective_from=data['tax_effective_from'], registration=data['registration'], mappings=mappings,
        reason='Explicitly reviewed first-organisation setup', source='Organisation onboarding declarations')
    if data['activate_tax']:
        profile = review_profile(organisation=organisation, user=user, profile=profile)
        activate_profile(organisation=organisation, user=user, profile=profile, confirmed=True)
    OrganisationSetup.objects.create(organisation=organisation, policy_acceptance=policy, opening_choice=data['opening_choice'],
        checklist={'customers':False,'suppliers':False,'tax':data['activate_tax'],'opening':data['opening_choice']=='zero','bank':False,'invoice':False,'team':False})
    audit('ORGANISATION_ONBOARDED', user, organisation, organisation, chart=data['chart'], opening_choice=data['opening_choice'], tax_activated=data['activate_tax'])
    draft.organisation, draft.idempotency_key, draft.payload_hash = organisation, key, digest
    draft.data = {}  # Minimise retained onboarding PII once copied into the private organisation.
    draft.save(update_fields=['organisation','idempotency_key','payload_hash','data','updated_at'])
    return organisation
