import hashlib
import math
import time
from django.conf import settings
from django.core.cache import cache
from rest_framework.throttling import BaseThrottle
from common.rate_limits import client_ip, ThrottleUnavailable


def consume_limits(namespace, limits):
    now, wait = time.time(), 0
    for scope, value, rate in limits:
        count, unit = rate.split('/')
        seconds = {'s':1, 'm':60, 'h':3600, 'd':86400}[unit[0]]
        key = f'identity:{namespace}:{scope}:{hashlib.sha256(str(value).encode()).hexdigest()}:{int(now // seconds)}'
        try:
            attempts = 1 if cache.add(key, 1, timeout=seconds + 1) else cache.incr(key)
        except Exception:
            raise ThrottleUnavailable() from None
        if attempts > int(count):
            wait = max(wait, math.ceil((int(now // seconds) + 1) * seconds - now))
    return wait


class PublicIdentityThrottle(BaseThrottle):
    def allow_request(self, request, view):
        registration = getattr(view, 'registration', False)
        rates = (settings.REGISTRATION_IP_RATE, settings.REGISTRATION_EMAIL_RATE) if registration else (settings.VERIFICATION_IP_RATE, settings.VERIFICATION_EMAIL_RATE)
        email = str(request.data.get('email', '')).strip().lower()[:254]
        limits = [('ip', client_ip(request), rates[0])]
        if email:
            limits.append(('email', email, rates[1]))
        self.retry_after = consume_limits('register' if registration else 'verify', limits)
        return not self.retry_after

    def wait(self):
        return self.retry_after
