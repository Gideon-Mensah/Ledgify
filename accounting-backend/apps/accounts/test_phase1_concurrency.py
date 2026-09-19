"""Production concurrency checks; run with an isolated PostgreSQL DATABASE_URL."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import close_old_connections, connection
from django.test import TransactionTestCase, skipUnlessDBFeature
from rest_framework.test import APIClient


@skipUnlessDBFeature('has_select_for_update')
class TokenConcurrencyTests(TransactionTestCase):
    def setUp(self):
        cache.clear()
        self.user=get_user_model().objects.create_user(is_email_verified=True, username='race',email='race@example.invalid',password='Race-password-839!')
        self.tokens=APIClient().post('/api/v1/auth/token/',{'email':self.user.email,'password':'Race-password-839!'},format='json').data

    def simultaneous(self, operations):
        barrier=Barrier(len(operations))
        def run(operation):
            close_old_connections()
            try:
                client=APIClient()
                barrier.wait(timeout=10)
                return operation(client)
            finally:
                connection.close()
        with ThreadPoolExecutor(max_workers=len(operations)) as pool:
            return list(pool.map(run,operations))

    def test_simultaneous_logout_and_refresh_leave_no_usable_successor(self):
        def logout(client):
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.tokens['access']}")
            return client.post('/api/v1/auth/logout/',{'refresh':self.tokens['refresh']},format='json')
        def refresh(client):return client.post('/api/v1/auth/token/refresh/',{'refresh':self.tokens['refresh']},format='json')
        logout_response,refresh_response=self.simultaneous([logout,refresh])
        self.assertEqual(logout_response.status_code,204)
        self.assertIn(refresh_response.status_code,(200,401))
        client=APIClient()
        self.assertEqual(refresh(client).status_code,401)
        if refresh_response.status_code==200:
            self.assertEqual(client.post('/api/v1/auth/token/refresh/',{'refresh':refresh_response.data['refresh']},format='json').status_code,401)
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {refresh_response.data['access']}")
            self.assertEqual(client.get('/api/v1/auth/me/').status_code,401)

    def test_simultaneous_rotation_issues_exactly_one_successor(self):
        def refresh(client):return client.post('/api/v1/auth/token/refresh/',{'refresh':self.tokens['refresh']},format='json')
        responses=self.simultaneous([refresh,refresh])
        self.assertEqual(sorted(response.status_code for response in responses),[200,401])
