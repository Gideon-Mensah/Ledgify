import uuid
class RequestIDMiddleware:
 def __init__(self,get_response):self.get_response=get_response
 def __call__(self,request):
  request.request_id=request.headers.get("X-Request-ID") or str(uuid.uuid4());response=self.get_response(request);response["X-Request-ID"]=request.request_id;return response


class AdminLoginThrottleMiddleware:
    """Use the same IP/account budgets for admin and API sign-in attempts."""
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        from django.http import JsonResponse
        from django.urls import reverse
        from common.rate_limits import consume_login_limits, ThrottleUnavailable
        if request.method == 'POST' and request.path == reverse('admin:login'):
            try:
                wait = consume_login_limits(request, request.POST.get('username', ''))
            except ThrottleUnavailable:
                return JsonResponse({'detail': 'Sign-in is temporarily unavailable. Please try again later.'}, status=503)
            if wait:
                response = JsonResponse({'detail': 'Too many sign-in attempts. Please try again later.'}, status=429)
                response['Retry-After'] = str(wait)
                return response
        return self.get_response(request)
