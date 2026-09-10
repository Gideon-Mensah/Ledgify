from rest_framework.throttling import BaseThrottle
from common.rate_limits import consume_login_limits


class LoginRateThrottle(BaseThrottle):
    def allow_request(self, request, view):
        self.retry_after = consume_login_limits(request, request.data.get('email', ''))
        return self.retry_after == 0

    def wait(self):
        return self.retry_after
