from django.conf import settings
from django.core.checks import Error, register, Tags
from .identity import require_registration_configuration


@register(Tags.security, deploy=True)
def public_registration_configuration(app_configs, **kwargs):
    if not settings.DEBUG and settings.REGISTRATION_ENABLED:
        try:
            require_registration_configuration()
        except Exception:
            return [Error('Public registration requires approved policy URLs/versions, an HTTPS frontend origin and configured production SMTP.', id='accounts.E005')]
    return []
