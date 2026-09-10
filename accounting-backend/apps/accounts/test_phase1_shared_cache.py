"""Exercise atomic cache limits in separate Django worker processes."""
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from unittest import skipUnless
from django.conf import settings
from django.core.cache import cache
from django.test import SimpleTestCase


@skipUnless(settings.CACHES['default']['BACKEND']=='django.core.cache.backends.redis.RedisCache','Requires disposable shared Redis DJANGO_CACHE_URL')
class SharedCacheProcessTests(SimpleTestCase):
    def test_independent_workers_share_atomic_login_counters(self):
        cache.clear()
        code='''import django
from unittest.mock import patch
django.setup()
from django.test import RequestFactory, override_settings
from common.rate_limits import consume_login_limits
with override_settings(LOGIN_IP_RATE="100/minute", LOGIN_ACCOUNT_RATE="5/minute"):
 with patch("common.rate_limits.time.time",return_value=120.0):
  print(consume_login_limits(RequestFactory().post("/",REMOTE_ADDR="192.0.2.55"),"worker@example.invalid"))
'''
        def attempt(_):
            result=subprocess.run([sys.executable,'-c',code],env={**os.environ,'DJANGO_SETTINGS_MODULE':'config.settings','PYTHONDONTWRITEBYTECODE':'1'},cwd=settings.BASE_DIR,capture_output=True,text=True,timeout=20)
            self.assertEqual(result.returncode,0,'Shared-cache worker failed')
            return int(result.stdout.strip())
        with ThreadPoolExecutor(max_workers=8) as pool:
            results=list(pool.map(attempt,range(8)))
        self.assertEqual(results.count(0),5)
        self.assertEqual(results.count(60),3)
