"""Regression cases for the reproduced September production audit attacks."""
from uuid import uuid4
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from apps.organisations.models import Organisation, OrganisationMember
from apps.accounting.models import Account
from apps.consolidation.models import ConsolidationGroup, ConsolidationGroupMember
from apps.fx.models import Currency


class Phase1AttackTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user(username='phase1', email='phase1@example.invalid', password='Strong-test-pass-837!')
        self.other = get_user_model().objects.create_user(username='other', email='other@example.invalid', password='Strong-test-pass-837!')
        self.a = Organisation.objects.create(name='A', base_currency='GHS', created_by=self.user)
        self.b = Organisation.objects.create(name='B', base_currency='GHS', created_by=self.other)
        OrganisationMember.objects.create(organisation=self.a, user=self.user, role='owner')
        OrganisationMember.objects.create(organisation=self.b, user=self.other, role='owner')
        self.foreign = Account.objects.create(organisation=self.b, created_by=self.other, code='FX', name='Foreign gain', account_type='revenue', account_class='other_income', currency='GHS')
        Currency.objects.get_or_create(code='GHS', defaults={'name':'Cedi'})
        self.group = ConsolidationGroup.objects.create(parent_organisation=self.a, name='Group', reporting_currency_id='GHS', created_by=self.user)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.client.credentials(HTTP_X_ORGANISATION_ID=str(self.a.id))

    @override_settings(ENABLE_CONSOLIDATION=True)
    def test_foreign_consolidation_member_rejected_without_write(self):
        response = self.client.post('/api/v1/consolidation-members/', {'group':str(self.group.id), 'organisation':str(self.b.id), 'ownership_percentage':'100', 'consolidation_method':'full', 'effective_from':'2026-01-01'}, format='json')
        self.assertIn(response.status_code, (400,403,404))
        self.assertFalse(ConsolidationGroupMember.objects.exists())

    @override_settings(ENABLE_CONSOLIDATION=False)
    def test_disabled_consolidation_is_404(self):
        self.assertEqual(self.client.get('/api/v1/consolidation-groups/').status_code,404)

    def test_foreign_fx_patch_rejected(self):
        response = self.client.patch(f'/api/v1/organisations/{self.a.id}/', {'fx_gain_account':str(self.foreign.id)},format='json')
        self.assertEqual(response.status_code,400)
        self.a.refresh_from_db()
        self.assertIsNone(self.a.fx_gain_account_id)

    def test_malformed_org_header_is_controlled(self):
        self.client.credentials(HTTP_X_ORGANISATION_ID='invalid-uuid')
        self.client.raise_request_exception=False
        self.assertEqual(self.client.get('/api/v1/accounts/').status_code,400)

    def login(self):
        self.client.force_authenticate(None)
        return self.client.post('/api/v1/auth/token/', {'email':self.user.email,'password':'Strong-test-pass-837!'}, format='json')

    def test_refresh_token_cannot_be_reused(self):
        tokens=self.login().data
        self.assertEqual(self.client.post('/api/v1/auth/token/refresh/',{'refresh':tokens['refresh']},format='json').status_code,200)
        self.assertEqual(self.client.post('/api/v1/auth/token/refresh/',{'refresh':tokens['refresh']},format='json').status_code,401)

    def test_real_login_posts_are_throttled(self):
        self.client.force_authenticate(None)
        responses=[self.client.post('/api/v1/auth/token/',{'email':'absent@example.invalid','password':'bad'},format='json').status_code for _ in range(12)]
        self.assertIn(429,responses)

    def test_header_missing_nonexistent_and_foreign(self):
        for value in (None, str(uuid4()), str(self.b.id), 'null', '123'):
            with self.subTest(value=value):
                self.client.credentials(**({'HTTP_X_ORGANISATION_ID': value} if value else {}))
                self.assertIn(self.client.get('/api/v1/accounts/').status_code,(400,403,404))

    @override_settings(ENABLE_CONSOLIDATION=False)
    def test_every_consolidation_route_is_disabled_before_auth_or_queries(self):
        from apps.consolidation.urls import router
        from django.urls import reverse
        self.client.force_authenticate(None)
        self.client.credentials(HTTP_AUTHORIZATION='Bearer malformed', HTTP_X_ORGANISATION_ID='bad')
        for url in router.urls:
            if not url.name or url.name == 'api-root' or 'format' in str(url.pattern):
                continue
            path = reverse(url.name, kwargs={'pk':uuid4()} if '<pk>' in str(url.pattern) or '(?P<pk>' in str(url.pattern) else {})
            for method in ('get','post','put','patch','delete','options'):
                with self.subTest(route=url.name,method=method), self.assertNumQueries(0):
                    self.assertEqual(getattr(self.client,method)(path).status_code,404)

    @override_settings(ENABLE_CONSOLIDATION=True)
    def test_member_access_role_matrix(self):
        for role, allowed in [('owner',True),('admin',True),('accountant',True),('bookkeeper',False),('viewer',False)]:
            for active in (True,False):
                with self.subTest(role=role,active=active):
                    membership=OrganisationMember.objects.create(organisation=self.b,user=self.user,role=role,is_active=active)
                    response=self.client.post('/api/v1/consolidation-members/', {'group':str(self.group.id),'organisation':str(self.b.id),'effective_from':'2026-01-01'},format='json')
                    self.assertEqual(response.status_code,201 if allowed and active else 403)
                    ConsolidationGroupMember.objects.all().delete()
                    membership.delete()

    @override_settings(ENABLE_CONSOLIDATION=True)
    def test_parent_role_matrix(self):
        membership=OrganisationMember.objects.get(organisation=self.a,user=self.user)
        for role, expected in [('owner',200),('admin',200),('accountant',200),('bookkeeper',403),('viewer',403)]:
            membership.role=role;membership.save()
            self.assertEqual(self.client.get('/api/v1/consolidation-groups/').status_code,expected)

    def graph_fixture(self):
        from apps.consolidation.models import ConsolidationAccount, ConsolidationPeriod
        target=ConsolidationAccount.objects.create(group=self.group,code='G1',name='Group account',account_type='asset',account_class='current_asset')
        period=ConsolidationPeriod.objects.create(group=self.group,start_date='2026-01-01',end_date='2026-12-31')
        return target,period

    @override_settings(ENABLE_CONSOLIDATION=True)
    def test_foreign_mapping_and_reparenting_are_rejected(self):
        from apps.consolidation.models import ConsolidationAccountMapping
        target,period=self.graph_fixture()
        foreign_group=ConsolidationGroup.objects.create(parent_organisation=self.b,name='B group',reporting_currency_id='GHS',created_by=self.other)
        data={'group':str(self.group.id),'organisation':str(self.b.id),'source_account':str(self.foreign.id),'consolidation_account':str(target.id),'effective_from':'2026-01-01'}
        self.assertIn(self.client.post('/api/v1/consolidation-mappings/',data,format='json').status_code,(400,403))
        self.assertFalse(ConsolidationAccountMapping.objects.exists())
        for endpoint,obj in [('consolidation-accounts',target),('consolidation-periods',period)]:
            for method in ('put','patch'):
                response=getattr(self.client,method)(f'/api/v1/{endpoint}/{obj.pk}/',{'group':str(foreign_group.id)},format='json')
                self.assertIn(response.status_code,(400,403))
                obj.refresh_from_db();self.assertEqual(obj.group_id,self.group.id)
        self.assertEqual(self.client.patch(f'/api/v1/consolidation-groups/{self.group.pk}/',{'parent_organisation':str(self.b.id)},format='json').status_code,400)

    @override_settings(ENABLE_CONSOLIDATION=True)
    def test_legacy_foreign_member_cannot_disclose_or_prepare(self):
        from apps.consolidation.models import ConsolidationSnapshot
        from apps.consolidation.services import prepare_consolidation, consolidated_trial_balance
        from rest_framework.exceptions import PermissionDenied
        target,period=self.graph_fixture()
        ConsolidationGroupMember.objects.create(group=self.group,organisation=self.b,effective_from='2026-01-01')
        for url in [f'/api/v1/consolidation-mappings/unmapped/?group={self.group.pk}',f'/api/v1/consolidation-reports/trial-balance/?period={period.pk}']:
            response=self.client.get(url)
            self.assertEqual(response.status_code,403)
            self.assertNotIn(self.foreign.name,str(response.data))
        with self.assertRaises(PermissionDenied):prepare_consolidation(group=self.group,period=period,user=self.user)
        with self.assertRaises(PermissionDenied):consolidated_trial_balance(group=self.group,period=period,user=self.user)
        self.assertFalse(ConsolidationSnapshot.objects.exists())
        period.refresh_from_db();self.assertEqual(period.status,'open')

    @override_settings(ENABLE_CONSOLIDATION=True)
    def test_nested_elimination_rejection_is_atomic(self):
        from apps.consolidation.models import EliminationJournal, EliminationJournalLine
        target,period=self.graph_fixture()
        payload={'group':str(self.group.pk),'period':str(period.pk),'entry_number':'E1','date':'2026-01-01','description':'Test','lines':[{'consolidation_account':str(target.pk),'debit':'1','organisation':str(self.b.pk)},{'consolidation_account':str(target.pk),'credit':'1'}]}
        self.assertEqual(self.client.post('/api/v1/elimination-journals/',payload,format='json').status_code,403)
        self.assertFalse(EliminationJournal.objects.exists());self.assertFalse(EliminationJournalLine.objects.exists())
        payload['lines'][0].pop('organisation');payload['lines'][1]['credit']='2'
        self.assertEqual(self.client.post('/api/v1/elimination-journals/',payload,format='json').status_code,400)
        self.assertFalse(EliminationJournal.objects.exists())
        payload['lines'][1]['credit']='1'
        result=self.client.post('/api/v1/elimination-journals/',payload,format='json')
        self.assertEqual(result.status_code,201)
        original=list(EliminationJournalLine.objects.values_list('id','debit','credit'))
        payload['lines'][0]['counterparty_organisation']=str(self.b.pk)
        self.assertEqual(self.client.patch(f"/api/v1/elimination-journals/{result.data['id']}/",{'lines':payload['lines']},format='json').status_code,403)
        self.assertEqual(list(EliminationJournalLine.objects.values_list('id','debit','credit')),original)

    @override_settings(ENABLE_CONSOLIDATION=True)
    def test_query_identifiers_are_controlled(self):
        for endpoint,param in [('consolidation-mappings/unmapped','group'),('consolidation-reports/trial-balance','period'),('consolidation-reports/profit-loss','period'),('consolidation-reports/balance-sheet','period')]:
            for value in ('','bad',str(uuid4())):
                self.assertIn(self.client.get(f'/api/v1/{endpoint}/?{param}={value}').status_code,(400,403,404))
        for value in ('bad',str(uuid4())):
            self.assertIn(self.client.get(f'/api/v1/manufacturing/reports/bom-explosion/?product_id={value}&quantity=1&production_date=2026-01-01').status_code,(400,403,404))

    def test_read_only_audit_finds_legacy_relationship(self):
        from io import StringIO
        from django.core.management import call_command
        member=ConsolidationGroupMember.objects.create(group=self.group,organisation=self.b,effective_from='2026-01-01')
        before=list(ConsolidationGroupMember.objects.values())
        output=StringIO();call_command('audit_consolidation_relationships',stdout=output)
        self.assertIn(str(self.group.pk),output.getvalue())
        self.assertIn('creator_lacks_current_access',output.getvalue())
        self.assertEqual(before,list(ConsolidationGroupMember.objects.values()))
        self.assertTrue(ConsolidationGroupMember.objects.filter(pk=member.pk).exists())

    def test_fx_all_write_methods_and_account_rules(self):
        local=Account.objects.create(organisation=self.a,created_by=self.user,code='FX',name='Local',account_type='revenue',account_class='other_income')
        for method in ('patch','put'):
            for field in ('fx_gain_account','fx_loss_account'):
                self.assertEqual(getattr(self.client,method)(f'/api/v1/organisations/{self.a.pk}/',{'name':'A','base_currency':'GHS',field:str(self.foreign.pk)},format='json').status_code,400)
        self.assertEqual(self.client.post('/api/v1/organisations/',{'name':'New','base_currency':'GHS','fx_gain_account':str(self.foreign.pk)},format='json').status_code,400)
        self.assertEqual(self.client.patch(f'/api/v1/organisations/{self.a.pk}/',{'fx_loss_account':str(local.pk)},format='json').status_code,400)
        self.assertEqual(self.client.patch(f'/api/v1/organisations/{self.a.pk}/',{'fx_gain_account':str(local.pk)},format='json').status_code,200)

    def test_logout_revokes_refresh_and_access_including_rotated_successor(self):
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken
        tokens=self.login().data
        successor=self.client.post('/api/v1/auth/token/refresh/',{'refresh':tokens['refresh']},format='json').data
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        self.assertEqual(self.client.post('/api/v1/auth/logout/',{'refresh':tokens['refresh']},format='json').status_code,204)
        self.assertTrue(BlacklistedToken.objects.exists())
        for refresh in (tokens['refresh'],successor['refresh']):
            self.assertEqual(self.client.post('/api/v1/auth/token/refresh/',{'refresh':refresh},format='json').status_code,401)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {successor['access']}")
        self.assertEqual(self.client.get('/api/v1/auth/me/').status_code,401)

    def test_logout_cannot_revoke_another_users_token(self):
        tokens=self.login().data
        other=APIClient().post('/api/v1/auth/token/',{'email':self.other.email,'password':'Strong-test-pass-837!'},format='json').data
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        self.assertEqual(self.client.post('/api/v1/auth/logout/',{'refresh':other['refresh']},format='json').status_code,401)
        self.assertEqual(APIClient().post('/api/v1/auth/token/refresh/',{'refresh':other['refresh']},format='json').status_code,200)

    def test_password_change_and_inactive_user_revoke_sessions(self):
        for change in ('password','inactive'):
            cache.clear();self.user.is_active=True;self.user.set_password('Strong-test-pass-837!');self.user.save()
            tokens=self.login().data
            if change=='password':self.user.set_password('Another-password-987!')
            else:self.user.is_active=False
            self.user.save()
            self.assertEqual(self.client.post('/api/v1/auth/token/refresh/',{'refresh':tokens['refresh']},format='json').status_code,401)
            self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
            self.assertEqual(self.client.get('/api/v1/auth/me/').status_code,401)

    @override_settings(LOGIN_IP_RATE='2/minute',LOGIN_ACCOUNT_RATE='2/minute')
    def test_throttle_shared_clients_expiry_and_generic_errors(self):
        from unittest.mock import patch
        clients=[APIClient(),APIClient(),APIClient()]
        with patch('common.rate_limits.time.time',return_value=120.0):
            results=[clients[i].post('/api/v1/auth/token/',{'email':self.user.email if i==0 else self.user.email.upper(),'password':'bad'},format='json',REMOTE_ADDR=f'192.0.2.{i+1}') for i in range(3)]
            self.assertEqual([r.status_code for r in results],[401,401,429])
            self.assertEqual(results[2]['Retry-After'],'60')
        with patch('common.rate_limits.time.time',return_value=180.0):
            self.assertEqual(self.login().status_code,200)
        cache.clear()
        known=APIClient().post('/api/v1/auth/token/',{'email':self.user.email,'password':'bad'},format='json')
        unknown=APIClient().post('/api/v1/auth/token/',{'email':'unknown@example.invalid','password':'bad'},format='json')
        self.assertEqual(known.status_code,unknown.status_code);self.assertEqual(known.data,unknown.data)

    @override_settings(LOGIN_IP_RATE='2/minute',LOGIN_ACCOUNT_RATE='100/minute')
    def test_ip_throttle_cannot_be_bypassed_by_spoofed_forwarding(self):
        results=[APIClient().post('/api/v1/auth/token/',{'email':f'unknown{i}@example.invalid','password':'bad'},format='json',HTTP_X_FORWARDED_FOR=f'192.0.2.{i}') for i in range(3)]
        self.assertEqual([r.status_code for r in results],[401,401,429])

    @override_settings(TRUSTED_PROXY_CIDRS=['10.0.0.0/8'])
    def test_proxy_chain_stops_at_first_untrusted_hop(self):
        from common.rate_limits import client_ip
        from django.test import RequestFactory
        request=RequestFactory().get('/',REMOTE_ADDR='10.0.0.2',HTTP_X_FORWARDED_FOR='192.0.2.66, 198.51.100.2, 10.0.0.1')
        self.assertEqual(client_ip(request),'198.51.100.2')
        request.META['REMOTE_ADDR']='198.51.100.3'
        self.assertEqual(client_ip(request),'198.51.100.3')

    @override_settings(LOGIN_IP_RATE='2/minute',LOGIN_ACCOUNT_RATE='2/minute')
    def test_admin_login_is_throttled(self):
        from django.test import Client
        client=Client()
        from unittest.mock import patch
        # Keep all attempts in one fixed rate-limit window, including slow CI.
        with patch('common.rate_limits.time.time', return_value=1800000015):
            for expected in (200,200,429):
                response=client.post('/admin/login/',{'username':'unknown@example.invalid','password':'bad'})
                self.assertEqual(response.status_code,expected)
            self.assertIn('Retry-After',response)

    def test_cache_outage_fails_closed(self):
        from unittest.mock import patch
        with patch('common.rate_limits.cache.add',side_effect=ConnectionError('private cache URL')):
            response=self.login()
        self.assertEqual(response.status_code,503)
        self.assertNotIn('private',str(response.data))

    @override_settings(ENABLE_CONSOLIDATION=True)
    def test_member_and_mapping_put_patch_cannot_reparent(self):
        from apps.consolidation.models import ConsolidationAccountMapping
        target,_=self.graph_fixture()
        local=Account.objects.create(organisation=self.a,created_by=self.user,code='L',name='Local',account_type='asset',account_class='current_asset')
        member=ConsolidationGroupMember.objects.create(group=self.group,organisation=self.a,effective_from='2026-01-01')
        mapping=ConsolidationAccountMapping.objects.create(group=self.group,organisation=self.a,source_account=local,consolidation_account=target,effective_from='2026-01-01')
        foreign_group=ConsolidationGroup.objects.create(parent_organisation=self.b,name='Foreign',reporting_currency_id='GHS',created_by=self.other)
        for endpoint,obj,base in [('consolidation-members',member,{'group':str(self.group.pk),'organisation':str(self.a.pk),'effective_from':'2026-01-01'}),('consolidation-mappings',mapping,{'group':str(self.group.pk),'organisation':str(self.a.pk),'source_account':str(local.pk),'consolidation_account':str(target.pk),'effective_from':'2026-01-01'})]:
            for method in ('put','patch'):
                for field,value in [('group',foreign_group.pk),('organisation',self.b.pk)]:
                    with self.subTest(endpoint=endpoint,method=method,field=field):
                        response=getattr(self.client,method)(f'/api/v1/{endpoint}/{obj.pk}/',{**base,field:str(value)},format='json')
                        self.assertEqual(response.status_code,400)
                        obj.refresh_from_db();self.assertEqual(obj.group_id,self.group.pk);self.assertEqual(obj.organisation_id,self.a.pk)

    @override_settings(ENABLE_CONSOLIDATION=True)
    def test_report_rejects_snapshot_attached_through_foreign_group(self):
        from apps.consolidation.models import ConsolidationSnapshot
        _,period=self.graph_fixture()
        foreign_group=ConsolidationGroup.objects.create(parent_organisation=self.b,name='Foreign',reporting_currency_id='GHS',created_by=self.other)
        ConsolidationSnapshot.objects.create(group=foreign_group,period=period,organisation=self.a,source_currency='GHS',reporting_currency='GHS')
        self.assertEqual(self.client.get(f'/api/v1/consolidation-reports/trial-balance/?period={period.pk}').status_code,400)

    def test_invalid_journal_filter_ids_and_dates_are_controlled(self):
        for parameter in ('account_id=bad','start_date=bad','end_date=bad'):
            self.assertEqual(self.client.get(f'/api/v1/journals/?{parameter}').status_code,400)

    def test_password_reset_invalidates_access_and_refresh(self):
        from django.contrib.auth.tokens import default_token_generator
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode
        tokens=self.login().data
        response=self.client.post('/api/v1/auth/password-reset/confirm/',{'uid':urlsafe_base64_encode(force_bytes(self.user.pk)),'token':default_token_generator.make_token(self.user),'new_password':'Another-password-987!','confirm_password':'Another-password-987!'},format='json')
        self.assertEqual(response.status_code,200)
        self.assertEqual(self.client.post('/api/v1/auth/token/refresh/',{'refresh':tokens['refresh']},format='json').status_code,401)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        self.assertEqual(self.client.get('/api/v1/auth/me/').status_code,401)

    def test_fx_revaluation_validates_even_unused_foreign_accounts(self):
        from apps.fx.services import revalue_receivables
        from common.exceptions import BusinessRuleError
        from apps.fx.models import FXRevaluation
        from apps.accounting.models import JournalEntry
        control=Account.objects.create(organisation=self.a,created_by=self.user,code='AR',name='AR',account_type='asset',account_class='receivable')
        loss=Account.objects.create(organisation=self.a,created_by=self.user,code='LOSS',name='Loss',account_type='expense',account_class='other_expense')
        with self.assertRaises(BusinessRuleError):
            revalue_receivables(organisation=self.a,as_of_date='2026-01-01',foreign_currency='GHS',foreign_amount=1,old_base_amount=1,control_account=control,gain_account=self.foreign,loss_account=loss,user=self.user)
        self.assertFalse(FXRevaluation.objects.exists());self.assertFalse(JournalEntry.objects.exists())
