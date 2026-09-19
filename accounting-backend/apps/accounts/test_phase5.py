"""Phase 5 contracts exercised against real PostgreSQL/Redis in release verification."""
import json
import os
import re
import subprocess
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch

from django.conf import settings
from django.core import mail
from django.core.cache import cache
from django.db import IntegrityError, connection, connections, transaction
from django.test import TestCase, TransactionTestCase, override_settings, skipUnlessDBFeature
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from apps.accounts.models import User, EmailVerification, PolicyAcceptance, IdentityEmailAttempt
from apps.accounts.identity import deliver_identity_emails, verify_email, token_digest, queue_verification, IdentityUnavailable
from apps.accounts.identity_throttles import consume_limits
from apps.organisations.models import Organisation, OrganisationMember, OrganisationInvitation, OnboardingDraft, AccessAuditEvent
from apps.organisations.invitation_services import create_invitation, invitation_for_user, change_invitation
from apps.organisations.onboarding import finish_onboarding
from apps.accounting.models import Account, AccountingPeriod, FinancialYear, JournalEntry
from apps.tax.models import OrganisationTaxProfile, TaxCode

PASSWORD='SyntheticPassphrase!9824'
CONFIG=dict(DEBUG=True, REGISTRATION_ENABLED=True, EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
    DEFAULT_FROM_EMAIL='Ledgify <accounts@example.test>', FRONTEND_URL='https://app.example.test', TERMS_VERSION='test-1',
    PRIVACY_VERSION='test-1', TERMS_URL='https://example.test/terms', PRIVACY_URL='https://example.test/privacy',
    REGISTRATION_IP_RATE='1000/hour', REGISTRATION_EMAIL_RATE='1000/hour', VERIFICATION_IP_RATE='1000/hour',
    VERIFICATION_EMAIL_RATE='1000/hour', INVITATION_USER_RATE='1000/hour', INVITATION_ORGANISATION_RATE='1000/hour',
    LOGIN_IP_RATE='1000/hour', LOGIN_ACCOUNT_RATE='1000/hour')


def user(email='owner@example.test', verified=True):
    return User.objects.create_user(username=str(uuid.uuid4()), email=email, password=PASSWORD, is_email_verified=verified)


def acceptance(actor):
    return PolicyAcceptance.objects.create(user=actor, terms_version='test-1', privacy_version='test-1', terms_url='https://example.test/terms', privacy_url='https://example.test/privacy')


def organisation(actor, name='Synthetic company'):
    org=Organisation.objects.create(name=name, base_currency='GHS', country_code='GH', timezone='Africa/Accra', created_by=actor)
    OrganisationMember.objects.create(organisation=org, user=actor, role='owner')
    return org


def payload(country='GH', **changes):
    result=dict(legal_name='Synthetic onboarding business', trading_name='', business_type='Sole proprietor', email='business@example.test', phone='+233241234567',
        address_line_1='Synthetic address', city='Accra' if country=='GH' else 'Bristol', country_code=country,
        base_currency='GHS' if country=='GH' else 'GBP', timezone='Africa/Accra' if country=='GH' else 'Europe/London', locale='en-GH' if country=='GH' else 'en-GB',
        regional_confirmed=True, financial_year_start_month=1, first_year_start='2026-01-01', first_year_end='2026-12-31', accounting_start_date='2026-01-01',
        reporting_basis='ACCRUAL', chart='ghana_small_business' if country=='GH' else 'general', tax_structure='GHANA_GRA' if country=='GH' else 'CUSTOM_INTERNATIONAL',
        tax_effective_from='2026-01-01', registration={'vat_registered':False}, activate_tax=False, tax_confirmation=False, opening_choice='zero')
    return {**result, **changes}


def emailed_token():
    return re.search(r'#token=([A-Za-z0-9_-]+)', mail.outbox[-1].body).group(1)


@override_settings(**CONFIG)
class RegistrationVerificationTests(TestCase):
    def setUp(self):
        cache.clear();self.client=APIClient()
    def register(self, **changes):
        options=self.client.get('/api/v1/auth/registration/options/').data
        data={'first_name':'Synthetic','last_name':'Person','email':'New@Example.test','password':PASSWORD,'confirm_password':PASSWORD,
            'terms_accepted':True,'terms_version':'test-1','privacy_version':'test-1','challenge':options['challenge'],**changes}
        return self.client.post('/api/v1/auth/register/',data,format='json')
    def test_registration_no_organisation_or_active_access(self):
        self.assertEqual(self.register().status_code,202)
        actor=User.objects.get();self.assertEqual(actor.email,'new@example.test');self.assertFalse(actor.is_email_verified)
        self.assertEqual(Organisation.objects.count(),0);self.assertEqual(PolicyAcceptance.objects.count(),1)
        self.assertFalse(PolicyAcceptance.objects.get().marketing_consent);self.assertIsNone(PolicyAcceptance.objects.get().ip_address)
        self.assertEqual(self.client.post('/api/v1/auth/token/',{'email':actor.email,'password':PASSWORD}).status_code,401)
    def test_duplicate_registration_is_generic_and_does_not_overwrite(self):
        first=self.register();second=self.register(email='new@EXAMPLE.test',first_name='Changed')
        self.assertEqual(first.status_code,second.status_code);self.assertEqual(first.data,second.data)
        self.assertEqual(User.objects.count(),1);self.assertEqual(User.objects.get().first_name,'Synthetic')
        self.assertEqual(IdentityEmailAttempt.objects.count(),1)
    def test_database_case_constraint_even_without_model_save(self):
        actor=user('case@example.test')
        with self.assertRaises(IntegrityError),transaction.atomic():
            User.objects.bulk_create([User(username='case-other',email='CASE@EXAMPLE.TEST',password='!')])
        self.assertEqual(User.objects.filter(pk=actor.pk).count(),1)
    def test_password_validation_and_confirmation(self):
        self.assertEqual(self.register(password='123',confirm_password='123').status_code,400)
        self.assertEqual(self.register(confirm_password='different').status_code,400)
        self.assertEqual(User.objects.count(),0)
    def test_terms_missing_or_stale(self):
        self.assertEqual(self.register(terms_accepted=False).status_code,400)
        self.assertEqual(self.register(terms_version='old').status_code,400)
        self.assertFalse(User.objects.exists())
    def test_bot_honeypot_and_challenge_replay(self):
        self.assertEqual(self.register(website='https://bot.invalid').status_code,202);self.assertFalse(User.objects.exists())
        self.assertEqual(self.register(challenge='altered').status_code,400)
    def test_registration_ip_and_email_limits(self):
        with override_settings(REGISTRATION_EMAIL_RATE='1/hour'):
            self.assertEqual(self.register().status_code,202)
            self.assertEqual(self.register(email='NEW@example.test').status_code,429)
        cache.clear()
        with override_settings(REGISTRATION_IP_RATE='1/hour'):
            self.assertEqual(self.register(email='a@example.test').status_code,202)
            self.assertEqual(self.register(email='b@example.test').status_code,429)
    def test_valid_single_use_html_email_and_session_claims(self):
        self.register();self.assertEqual(deliver_identity_emails(),1);token=emailed_token()
        row=EmailVerification.objects.get();self.assertNotEqual(row.token_hash,token);self.assertEqual(row.token_hash,token_digest(token))
        self.assertTrue(mail.outbox[-1].alternatives);self.assertIn('https://app.example.test/verify-email#token=',mail.outbox[-1].body)
        self.assertNotIn(token,str(list(IdentityEmailAttempt.objects.values())))
        self.assertEqual(self.client.post('/api/v1/auth/verification/confirm/',{'token':token}).status_code,200)
        self.assertEqual(self.client.post('/api/v1/auth/verification/confirm/',{'token':token}).status_code,400)
        result=self.client.post('/api/v1/auth/token/',{'email':' NEW@Example.test ','password':PASSWORD})
        self.assertEqual(result.status_code,200);self.assertIn('auth_version',RefreshToken(result.data['refresh']))
    def test_expired_altered_revoked_tokens(self):
        for mode in ['expired','altered','revoked']:
            actor=user(mode+'@example.test',False);queue_verification(actor);deliver_identity_emails();raw=emailed_token()
            row=EmailVerification.objects.get(user=actor)
            if mode=='expired':row.expires_at=timezone.now()-timedelta(seconds=1);row.save()
            if mode=='revoked':row.revoked_at=timezone.now();row.save()
            if mode=='altered':raw=raw[:-1]+('a' if raw[-1]!='a' else 'b')
            self.assertEqual(self.client.post('/api/v1/auth/verification/confirm/',{'token':raw}).status_code,400)
    def test_verification_revokes_all_outstanding(self):
        actor=user(verified=False);queue_verification(actor);deliver_identity_emails();raw=emailed_token()
        second=EmailVerification.objects.create(user=actor,email=actor.email,token_hash=token_digest('a'*48),expires_at=timezone.now()+timedelta(hours=1))
        verify_email(raw);second.refresh_from_db();self.assertIsNotNone(second.revoked_at)
    def test_resend_generic_idempotent_and_limited(self):
        actor=user(verified=False)
        first=self.client.post('/api/v1/auth/verification/resend/',{'email':actor.email})
        second=self.client.post('/api/v1/auth/verification/resend/',{'email':'unknown@example.test'})
        self.assertEqual(first.data,second.data)
        self.client.post('/api/v1/auth/verification/resend/',{'email':actor.email});self.assertEqual(IdentityEmailAttempt.objects.count(),1)
        cache.clear()
        with override_settings(VERIFICATION_EMAIL_RATE='1/hour'):
            self.client.post('/api/v1/auth/verification/resend/',{'email':actor.email})
            self.assertEqual(self.client.post('/api/v1/auth/verification/resend/',{'email':actor.email}).status_code,429)
    def test_login_failures_same_response_and_password_work(self):
        actor=user(verified=False)
        states=[]
        for email,password in [('unknown@example.test',PASSWORD),(actor.email,PASSWORD),(actor.email,'wrong')]:
            result=self.client.post('/api/v1/auth/token/',{'email':email,'password':password});states.append((result.status_code,result.data))
        actor.is_email_verified=True;actor.is_active=False;actor.save()
        result=self.client.post('/api/v1/auth/token/',{'email':actor.email,'password':PASSWORD});states.append((result.status_code,result.data))
        self.assertTrue(all(row==states[0] for row in states))
    def test_unverified_jwt_is_rejected_even_if_manually_minted(self):
        actor=user(verified=False);refresh=RefreshToken.for_user(actor);refresh['auth_version']=actor.auth_version
        self.client.credentials(HTTP_AUTHORIZATION='Bearer '+str(refresh.access_token))
        self.assertEqual(self.client.get('/api/v1/auth/me/').status_code,401)
    def test_email_change_revokes_session_and_requires_new_verification(self):
        actor=user();self.client.force_authenticate(actor)
        self.assertEqual(self.client.post('/api/v1/auth/email-change/',{'email':'Changed@Example.test','password':PASSWORD}).status_code,202)
        actor.refresh_from_db();self.assertFalse(actor.is_email_verified);self.assertEqual(actor.email,'changed@example.test');self.assertEqual(actor.auth_version,1)
        deliver_identity_emails();verify_email(emailed_token());actor.refresh_from_db();self.assertTrue(actor.is_email_verified)
    def test_model_email_change_also_clears_verification(self):
        actor=user();actor.email='other@example.test';actor.save(update_fields=['email']);actor.refresh_from_db();self.assertFalse(actor.is_email_verified)
    def test_reset_token_not_verification_token_and_no_secret_logs(self):
        from django.contrib.auth.tokens import default_token_generator
        actor=user(verified=False)
        with self.assertNoLogs('apps.accounts',level='DEBUG'):
            queue_verification(actor);deliver_identity_emails()
        self.assertEqual(self.client.post('/api/v1/auth/verification/confirm/',{'token':default_token_generator.make_token(actor)}).status_code,400)
    def test_backend_rejection_never_marks_sent_or_retries_ambiguous_delivery(self):
        actor=user(verified=False);queue_verification(actor)
        with patch('django.core.mail.EmailMultiAlternatives.send',return_value=0):self.assertEqual(deliver_identity_emails(),0)
        self.assertEqual(IdentityEmailAttempt.objects.get().status,'failed');self.assertEqual(deliver_identity_emails(),0)
    def test_production_rejects_console_and_in_memory(self):
        for backend in ['django.core.mail.backends.console.EmailBackend','django.core.mail.backends.locmem.EmailBackend']:
            with override_settings(DEBUG=False,EMAIL_BACKEND=backend):
                self.assertEqual(self.client.get('/api/v1/auth/registration/options/').status_code,503)
    def test_unsafe_frontend_origin_rejected(self):
        with override_settings(FRONTEND_URL='https://example.test/?next=https://evil.invalid'):
            self.assertEqual(self.client.get('/api/v1/auth/registration/options/').status_code,503)


@override_settings(**CONFIG)
class InvitationOnboardingTests(TestCase):
    def setUp(self):
        cache.clear();self.owner=user();self.org=organisation(self.owner);self.client=APIClient();self.client.force_authenticate(self.owner);self.client.credentials(HTTP_X_ORGANISATION_ID=str(self.org.pk))
    def invite(self, email='recipient@example.test',role='accountant'):
        obj=create_invitation(self.org,self.owner,email,role);deliver_identity_emails();return obj,emailed_token()
    def test_existing_verified_user_explicit_acceptance(self):
        recipient=user('recipient@example.test');inv,raw=self.invite()
        invitation_for_user(recipient,raw,False);self.assertFalse(OrganisationMember.objects.filter(user=recipient).exists())
        invitation_for_user(recipient,raw,True);self.assertEqual(OrganisationMember.objects.get(user=recipient).role,'accountant')
        with self.assertRaises(ValidationError):invitation_for_user(recipient,raw,True)
    def test_new_user_verifies_before_acceptance(self):
        inv,raw=self.invite();recipient=user('recipient@example.test',False)
        with self.assertRaises(ValidationError):invitation_for_user(recipient,raw,True)
        queue_verification(recipient);deliver_identity_emails();verify_email(emailed_token());recipient.refresh_from_db()
        invitation_for_user(recipient,raw,True);self.assertTrue(OrganisationMember.objects.filter(user=recipient).exists())
    def test_mismatch_revocation_and_expiry(self):
        recipient=user('different@example.test');inv,raw=self.invite()
        with self.assertRaises(ValidationError):invitation_for_user(recipient,raw,True)
        change_invitation(self.org,self.owner,inv.pk,'revoke')
        with self.assertRaises(ValidationError):invitation_for_user(recipient,raw,True)
        inv,raw=self.invite('different@example.test');inv.expires_at=timezone.now()-timedelta(seconds=1);inv.save()
        with self.assertRaises(ValidationError):invitation_for_user(recipient,raw,True)
    def test_admin_cannot_invite_owner_or_admin(self):
        admin=user('admin@example.test');OrganisationMember.objects.create(organisation=self.org,user=admin,role='admin')
        from rest_framework.exceptions import PermissionDenied
        for role in ['owner','admin']:
            with self.assertRaises(PermissionDenied):create_invitation(self.org,admin,'target@example.test',role)
    def test_duplicate_invitation_and_existing_owner_preserved(self):
        inv,raw=self.invite(self.owner.email,'viewer');same=create_invitation(self.org,self.owner,self.owner.email,'viewer');self.assertEqual(inv.pk,same.pk)
        invitation_for_user(self.owner,raw,True);self.assertEqual(OrganisationMember.objects.get(user=self.owner,organisation=self.org).role,'owner')
    def test_cross_organisation_invitation_access(self):
        other=user('other@example.test');foreign=organisation(other,'Other company');inv=create_invitation(foreign,other,'x@example.test','viewer')
        response=self.client.post(f'/api/v1/organisation-invitations/{inv.pk}/revoke/',{})
        self.assertEqual(response.status_code,403)
        self.client.credentials(HTTP_X_ORGANISATION_ID=str(foreign.pk));self.assertEqual(self.client.get('/api/v1/organisation-invitations/').status_code,403)
    def test_last_owner_and_direct_membership_creation(self):
        membership=OrganisationMember.objects.get(user=self.owner,organisation=self.org)
        self.assertEqual(self.client.patch(f'/api/v1/organisation-members/{membership.pk}/',{'role':'viewer'}).status_code,403)
        self.assertEqual(self.client.delete(f'/api/v1/organisation-members/{membership.pk}/').status_code,403)
        self.assertEqual(self.client.post('/api/v1/organisation-members/',{'user':str(self.owner.pk),'role':'owner'}).status_code,400)
    def test_resend_rotates_link_without_duplicate_email(self):
        recipient=user('recipient@example.test');inv,old=self.invite()
        change_invitation(self.org,self.owner,inv.pk,'resend');self.assertEqual(IdentityEmailAttempt.objects.filter(invitation=inv).count(),1)
        IdentityEmailAttempt.objects.filter(invitation=inv).update(created_at=timezone.now()-timedelta(hours=1))
        change_invitation(self.org,self.owner,inv.pk,'resend');deliver_identity_emails();new=emailed_token();self.assertNotEqual(new,old)
        with self.assertRaises(ValidationError):invitation_for_user(recipient,old,True)
    def test_onboarding_ghana_atomic_setup_without_journal(self):
        actor=user('setup@example.test');acceptance(actor)
        org=finish_onboarding(actor,payload(),str(uuid.uuid4()),True)
        self.assertEqual(org.base_currency,'GHS');self.assertEqual(org.timezone,'Africa/Accra')
        self.assertEqual(FinancialYear.objects.filter(organisation=org).count(),1);self.assertEqual(AccountingPeriod.objects.get(organisation=org).status,'open')
        self.assertEqual(Account.objects.filter(organisation=org).count(),10);self.assertFalse(JournalEntry.objects.filter(organisation=org).exists())
        self.assertEqual(OrganisationTaxProfile.objects.get(organisation=org).status,'DRAFT');self.assertFalse(TaxCode.objects.filter(organisation=org).exists())
    def test_ghana_vat_activation_requires_explicit_confirmation(self):
        actor=user('vatsetup@example.test');acceptance(actor)
        with self.assertRaises(ValidationError):finish_onboarding(actor,payload(activate_tax=True),str(uuid.uuid4()),True)
        self.assertFalse(Organisation.objects.filter(created_by=actor).exists())
        reg={'vat_registered':True,'tin':'TEST-TIN','vat_registration_number':'TEST-VAT','vat_effective_from':'2026-01-01'}
        org=finish_onboarding(actor,payload(registration=reg,activate_tax=True,tax_confirmation=True),str(uuid.uuid4()),True)
        self.assertEqual(OrganisationTaxProfile.objects.get(organisation=org).status,'ACTIVE');self.assertTrue(TaxCode.objects.filter(organisation=org).exists())
        self.assertFalse(JournalEntry.objects.filter(organisation=org).exists())
    def test_non_registered_ghana_never_assumes_vat_registration(self):
        actor=user('nonvat@example.test');acceptance(actor)
        org=finish_onboarding(actor,payload(activate_tax=True,tax_confirmation=True),str(uuid.uuid4()),True)
        self.assertFalse(OrganisationTaxProfile.objects.get(organisation=org).registration['vat_registered'])
        self.assertFalse(OrganisationTaxProfile.objects.get(organisation=org).obligations.filter(obligation='VAT').exists())
    def test_international_custom_and_no_tax_never_install_ghana(self):
        for i,structure in enumerate(['CUSTOM_INTERNATIONAL','NO_TAX']):
            actor=user(f'int{i}@example.test');acceptance(actor)
            org=finish_onboarding(actor,payload('GB',tax_structure=structure,activate_tax=True,tax_confirmation=True),str(uuid.uuid4()),True)
            self.assertEqual(org.base_currency,'GBP');self.assertFalse(TaxCode.objects.filter(organisation=org).exists())
            self.assertFalse(Account.objects.filter(organisation=org,code__startswith='TX-').exists())
    def test_foreign_country_cannot_request_ghana_tax(self):
        actor=user('foreign@example.test');acceptance(actor)
        with self.assertRaises(ValidationError):finish_onboarding(actor,payload('GB',tax_structure='GHANA_GRA'),str(uuid.uuid4()),True)
    def test_atomic_rollback_on_required_step_failure(self):
        actor=user('rollback@example.test');acceptance(actor)
        with patch('apps.tax.configuration.create_profile',side_effect=RuntimeError('synthetic failure')):
            with self.assertRaises(RuntimeError):finish_onboarding(actor,payload(),str(uuid.uuid4()),True)
        self.assertFalse(Organisation.objects.filter(created_by=actor).exists());self.assertFalse(Account.objects.filter(created_by=actor).exists())
        self.assertFalse(OnboardingDraft.objects.filter(user=actor).exists())
    def test_idempotent_retry_conflict_and_no_tenant_inheritance(self):
        actor=user('retry@example.test');acceptance(actor);key=str(uuid.uuid4());data=payload()
        org=finish_onboarding(actor,data,key,True);same=finish_onboarding(actor,data,key,True);self.assertEqual(org.pk,same.pk)
        with self.assertRaises(ValidationError):finish_onboarding(actor,{**data,'legal_name':'Changed'},key,True)
        with self.assertRaises(ValidationError):finish_onboarding(actor,data,str(uuid.uuid4()),True)
        self.assertEqual(Organisation.objects.filter(created_by=actor).count(),1);self.assertEqual(org.logo_data,'');self.assertNotEqual(org.pk,self.org.pk)
        self.assertFalse(org.members.exclude(user=actor).exists())
    def test_save_resume_private_draft_creates_no_financial_records(self):
        actor=user('draft@example.test');acceptance(actor);self.client.force_authenticate(actor)
        self.assertEqual(self.client.put('/api/v1/onboarding/',{'data':{'legal_name':'Saved'},'step':2},format='json').status_code,200)
        self.assertEqual(self.client.get('/api/v1/onboarding/').data['data']['legal_name'],'Saved')
        self.assertFalse(Organisation.objects.filter(created_by=actor).exists())
        self.client.force_authenticate(self.owner);self.assertEqual(self.client.get('/api/v1/onboarding/').data['data'],{})
    def test_chart_import_and_minimal_choices_include_protected_controls(self):
        for choice in ['import_later','minimal']:
            actor=user(choice+'@example.test');acceptance(actor);org=finish_onboarding(actor,payload(chart=choice),str(uuid.uuid4()),True)
            self.assertEqual(Account.objects.filter(organisation=org).count(),7)
            self.assertEqual(Account.objects.filter(organisation=org,is_system_account=True).count(),3)
    def test_bad_financial_period_and_region_rejected(self):
        actor=user('dates@example.test');acceptance(actor)
        for changes in [dict(first_year_end='2025-01-01'),dict(accounting_start_date='2027-01-01'),dict(regional_confirmed=False),dict(timezone='invalid/timezone')]:
            with self.assertRaises(ValidationError):finish_onboarding(actor,payload(**changes),str(uuid.uuid4()),True)
    def test_logo_validation_and_private_storage(self):
        actor=user('logo@example.test');acceptance(actor)
        with self.assertRaises(ValidationError):finish_onboarding(actor,payload(logo_data='data:image/svg+xml;base64,PHN2Zz4='),str(uuid.uuid4()),True)
    def test_required_controls_cannot_be_unprotected_or_deleted(self):
        actor=user('controls@example.test');acceptance(actor);org=finish_onboarding(actor,payload(),str(uuid.uuid4()),True)
        account=Account.objects.filter(organisation=org,is_system_account=True).first();self.client.force_authenticate(actor);self.client.credentials(HTTP_X_ORGANISATION_ID=str(org.pk))
        self.client.patch(f'/api/v1/accounts/{account.pk}/',{'is_system_account':False})
        account.refresh_from_db();self.assertTrue(account.is_system_account)
        self.assertEqual(self.client.delete(f'/api/v1/accounts/{account.pk}/').status_code,400)


# Tests import this exception explicitly rather than treating server errors as valid denials.
from rest_framework.exceptions import ValidationError


@override_settings(**CONFIG)
class Phase5ConcurrencyTests(TransactionTestCase):
    def setUp(self): cache.clear()
    def race(self, functions):
        barrier=Barrier(len(functions))
        def run(fn):
            connections.close_all();barrier.wait()
            try:return fn()
            finally:connections.close_all()
        with ThreadPoolExecutor(max_workers=len(functions)) as pool:return list(pool.map(run,functions))
    @skipUnlessDBFeature('has_select_for_update')
    def test_concurrent_case_variant_registration(self):
        def register(email):
            client=APIClient();challenge=client.get('/api/v1/auth/registration/options/').data['challenge']
            return client.post('/api/v1/auth/register/',dict(first_name='Race',last_name='Test',email=email,password=PASSWORD,confirm_password=PASSWORD,terms_accepted=True,terms_version='test-1',privacy_version='test-1',challenge=challenge),format='json').status_code
        result=self.race([lambda:register('race@example.test'),lambda:register('RACE@EXAMPLE.TEST')])
        self.assertEqual(result,[202,202]);self.assertEqual(User.objects.count(),1);self.assertEqual(PolicyAcceptance.objects.count(),1)
    @skipUnlessDBFeature('has_select_for_update')
    def test_concurrent_acceptance_creates_one_membership(self):
        owner=user();org=organisation(owner);recipient=user('recipient@example.test');create_invitation(org,owner,recipient.email,'viewer');deliver_identity_emails();raw=emailed_token()
        def accept():
            try:invitation_for_user(User.objects.get(pk=recipient.pk),raw,True);return 'accepted'
            except ValidationError:return 'rejected'
        self.assertCountEqual(self.race([accept,accept]),['accepted','rejected']);self.assertEqual(OrganisationMember.objects.filter(organisation=org,user=recipient).count(),1)
    @skipUnlessDBFeature('has_select_for_update')
    def test_concurrent_onboarding_same_key_creates_one_organisation(self):
        actor=user();acceptance(actor);key=str(uuid.uuid4())
        result=self.race([lambda:str(finish_onboarding(User.objects.get(pk=actor.pk),payload(),key,True).pk)]*2)
        self.assertEqual(result[0],result[1]);self.assertEqual(Organisation.objects.count(),1)
    @skipUnlessDBFeature('has_select_for_update')
    def test_concurrent_email_verification_consumes_once(self):
        actor=user(verified=False);queue_verification(actor);deliver_identity_emails();raw=emailed_token()
        def verify():
            try:verify_email(raw);return 'verified'
            except ValidationError:return 'rejected'
        self.assertCountEqual(self.race([verify,verify]),['verified','rejected'])
    def test_redis_limits_shared_across_processes(self):
        if 'redis' not in settings.CACHES['default']['BACKEND']:
            self.skipTest('Requires the release Redis service.')
        namespace='workers-'+uuid.uuid4().hex
        code="import os;os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings');import django;django.setup();from apps.accounts.identity_throttles import consume_limits;print(consume_limits(%r,[('email','synthetic@example.test','3/hour')]))"%namespace
        results=[int(subprocess.check_output([sys.executable,'-c',code],cwd=str(settings.BASE_DIR),env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'}).decode().strip()) for _ in range(4)]
        self.assertEqual(results[:3],[0,0,0]);self.assertGreater(results[3],0)


@override_settings(**CONFIG)
class IdentityOperationsTests(TestCase):
    def setUp(self): cache.clear()

    def test_identity_monitoring_drops_secrets_and_stack_locals(self):
        from common.identity_telemetry import scrub_identity_event
        event={'request':{'url':'https://app.example.test/api/v1/auth/register/','data':{'password':'synthetic-secret'}}}
        self.assertIsNone(scrub_identity_event(event))
        event={'request':{'url':'https://app.example.test/api/v1/accounts/','data':{'token':'secret'}},'breadcrumbs':{'values':[{'secret':'value'}]},'exception':{'values':[{'stacktrace':{'frames':[{'vars':{'raw':'secret'}}]}}]}}
        result=scrub_identity_event(event)
        self.assertNotIn('secret',json.dumps(result));self.assertNotIn('vars',json.dumps(result))

    def test_named_sender_supported_but_header_injection_rejected(self):
        from apps.accounts.identity import require_email_configuration
        require_email_configuration()
        with override_settings(DEFAULT_FROM_EMAIL='Ledgify\r\nBcc: victim@example.test'):
            with self.assertRaises(IdentityUnavailable): require_email_configuration()

    def test_pending_verification_does_not_accumulate_after_cooldown(self):
        actor=user(verified=False);queue_verification(actor)
        IdentityEmailAttempt.objects.update(created_at=timezone.now()-timedelta(days=1))
        queue_verification(actor);self.assertEqual(IdentityEmailAttempt.objects.count(),1)

    def test_cleanup_preserves_audit_and_policy_records(self):
        from django.core.management import call_command
        from io import StringIO
        actor=user();acceptance(actor);org=organisation(actor)
        invitation=create_invitation(org,actor,'old@example.test','viewer')
        old=timezone.now()-timedelta(days=200)
        OrganisationInvitation.objects.filter(pk=invitation.pk).update(expires_at=old)
        EmailVerification.objects.create(user=actor,email=actor.email,token_hash='a'*64,expires_at=old)
        draft=OnboardingDraft.objects.create(user=actor,data={'legal_name':'Abandoned'})
        OnboardingDraft.objects.filter(pk=draft.pk).update(updated_at=old)
        audits=AccessAuditEvent.objects.count()
        call_command('cleanup_identity',stdout=StringIO())
        self.assertFalse(OrganisationInvitation.objects.exists());self.assertFalse(EmailVerification.objects.exists());self.assertFalse(OnboardingDraft.objects.exists())
        self.assertEqual(AccessAuditEvent.objects.count(),audits);self.assertEqual(PolicyAcceptance.objects.count(),1)

    def test_business_identity_changes_are_audited_without_logo_blob(self):
        actor=user();org=organisation(actor);client=APIClient();client.force_authenticate(actor)
        response=client.patch(f'/api/v1/organisations/{org.pk}/',{'registration_number':'UPDATED-TEST','business_type':'Partnership'},format='json')
        self.assertEqual(response.status_code,200)
        event=AccessAuditEvent.objects.get(event='ORGANISATION_DETAILS_UPDATED')
        self.assertEqual(event.details['after']['registration_number'],'UPDATED-TEST');self.assertNotIn('logo_data',event.details['after'])

    def test_collision_migration_aborts_before_normalising(self):
        # The migration's actual collision query is evaluated before its update.
        from importlib import import_module
        migration=import_module('apps.accounts.migrations.0003_emailverification_identityemailattempt_and_more')
        with patch.object(User.objects,'annotate') as annotate:
            annotate.return_value.values.return_value.annotate.return_value.filter.return_value.count.return_value=1
            with patch.object(User.objects,'update') as update:
                with self.assertRaisesRegex(RuntimeError,'no accounts were merged'):
                    migration.normalise_existing_emails(type('Apps',(),{'get_model':lambda self,*args:User})(),None)
                update.assert_not_called()

    def test_existing_verified_account_can_accept_policies_during_first_setup(self):
        actor=user();client=APIClient();client.force_authenticate(actor)
        self.assertTrue(client.get('/api/v1/onboarding/').data['policy_required'])
        with self.assertRaises(ValidationError):finish_onboarding(actor,payload(),str(uuid.uuid4()),True)
        self.assertFalse(Organisation.objects.exists());self.assertFalse(PolicyAcceptance.objects.exists())
        data=payload(terms_accepted=True,terms_version='test-1',privacy_version='test-1')
        org=finish_onboarding(actor,data,str(uuid.uuid4()),True)
        policy=PolicyAcceptance.objects.get(user=actor)
        self.assertEqual(policy.terms_version,'test-1');self.assertFalse(policy.marketing_consent)
        self.assertEqual(org.setup.policy_acceptance,policy)

    def test_onboarding_rejects_stale_policy_and_rolls_back_new_consent_on_failure(self):
        actor=user()
        with self.assertRaises(ValidationError):finish_onboarding(actor,payload(terms_accepted=True,terms_version='old',privacy_version='test-1'),str(uuid.uuid4()),True)
        with patch('apps.tax.configuration.create_profile',side_effect=ValidationError('Synthetic failure')):
            with self.assertRaises(ValidationError):finish_onboarding(actor,payload(terms_accepted=True,terms_version='test-1',privacy_version='test-1'),str(uuid.uuid4()),True)
        self.assertFalse(PolicyAcceptance.objects.exists());self.assertFalse(Organisation.objects.exists())

    def test_invitation_pagination_retains_all_tenant_rows(self):
        actor=user();org=organisation(actor);foreign=organisation(user('foreign@example.test'))
        OrganisationInvitation.objects.bulk_create([OrganisationInvitation(organisation=org,email=f'page{i}@example.test',role='viewer',invited_by=actor,expires_at=timezone.now()+timedelta(days=1)) for i in range(51)])
        OrganisationInvitation.objects.create(organisation=foreign,email='foreign-recipient@example.test',role='viewer',invited_by=foreign.created_by,expires_at=timezone.now()+timedelta(days=1))
        client=APIClient();client.force_authenticate(actor);client.credentials(HTTP_X_ORGANISATION_ID=str(org.pk))
        first=client.get('/api/v1/organisation-invitations/').data;second=client.get('/api/v1/organisation-invitations/?page=2').data
        self.assertEqual(first['count'],51);self.assertEqual(len(first['invitations']),50);self.assertEqual(len(second['invitations']),1)
        ids={row['id'] for page in [first,second] for row in page['invitations']}
        self.assertEqual(len(ids),51);self.assertNotIn('foreign-recipient',json.dumps([first,second],default=str))
