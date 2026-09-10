"""Shared fixed-window login limits. Cache keys never contain account identifiers."""
import hashlib
import ipaddress
import math
import time
from django.conf import settings
from django.core.cache import cache
from rest_framework.exceptions import APIException


class ThrottleUnavailable(APIException):
    status_code = 503
    default_detail = 'Sign-in is temporarily unavailable. Please try again later.'


def client_ip(request):
    peer = request.META.get('REMOTE_ADDR', '')
    try:
        address = ipaddress.ip_address(peer)
    except ValueError:
        return 'unknown'
    trusted = [ipaddress.ip_network(cidr) for cidr in settings.TRUSTED_PROXY_CIDRS]
    if not any(address in network for network in trusted):
        return str(address)
    # Walk from the trusted peer towards the client, stopping at the first
    # untrusted hop. The ingress must append/replace X-Forwarded-For.
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if len(forwarded) > 4096:
        return str(address)
    for value in reversed(forwarded.split(',')):
        if not any(address in network for network in trusted):
            break
        try:
            address = ipaddress.ip_address(value.strip())
        except ValueError:
            return str(ipaddress.ip_address(peer))
    return str(address)


def normalise_identifier(value):
    return str(value or '').strip().casefold()[:254]


def consume_login_limits(request, identifier):
    now = time.time()
    wait = 0
    limits = [('ip', client_ip(request), settings.LOGIN_IP_RATE),
              ('account', normalise_identifier(identifier), settings.LOGIN_ACCOUNT_RATE)]
    for scope, identity, rate in limits:
        count, unit = rate.split('/')
        seconds = {'s':1, 'm':60, 'h':3600, 'd':86400}[unit[0]]
        window = int(now // seconds)
        digest = hashlib.sha256(identity.encode()).hexdigest()
        key = f'login:{scope}:{digest}:{window}'
        try:
            if cache.add(key, 1, timeout=seconds + 1):
                attempts = 1
            else:
                attempts = cache.incr(key)
        except Exception:
            # Fail closed without logging request data or cache credentials.
            raise ThrottleUnavailable() from None
        if attempts > int(count):
            wait = max(wait, math.ceil((window + 1) * seconds - now))
    return wait
