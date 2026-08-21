# Domain and TLS setup

Choose final names such as `app.example.com` and `api.example.com`. Configure DNS to the frontend/ingress and API ingress, issue automatically renewed certificates, and redirect HTTP to HTTPS. The trusted reverse proxy must overwrite `X-Forwarded-Proto`; only then enable `DJANGO_TRUST_PROXY_SSL_HEADER`.

Set `DJANGO_ALLOWED_HOSTS=api.example.com`, `CORS_ALLOWED_ORIGINS=https://app.example.com`, `CSRF_TRUSTED_ORIGINS=https://app.example.com` and the frontend API URL. Verify SPA fallback, `/api/` proxy, `/health/`, `/ready/`, body limits and security headers. After every endpoint is HTTPS, enable secure cookies, redirect and HSTS; introduce preload only after domain/subdomain review. Never test HSTS on localhost.
