"""Do not export identity request bodies, tokens or stack locals to monitoring."""
from urllib.parse import urlsplit

IDENTITY_PATHS = ('/auth/', '/onboarding/', '/invitation-acceptance/', '/organisation-invitations/')


def scrub_identity_event(event, hint=None):
    request = event.get('request') or {}
    path = urlsplit(str(request.get('url', ''))).path
    transaction = str(event.get('transaction', ''))
    if any(part in path or part in transaction for part in IDENTITY_PATHS):
        return None
    # SDK breadcrumbs and stack locals can outlive the identity request itself.
    event.pop('breadcrumbs', None)
    for container in [event.get('exception', {}), event.get('threads', {})]:
        for value in container.get('values', []):
            for frame in value.get('stacktrace', {}).get('frames', []):
                frame.pop('vars', None)
    request.pop('data', None)
    request.pop('cookies', None)
    request.pop('headers', None)
    request.pop('query_string', None)
    return event
