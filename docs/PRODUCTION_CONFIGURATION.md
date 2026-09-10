# Ledgify production configuration

Production deployments must supply environment variables; no production secret or domain belongs in source control.

| Variable | Required production value |
|---|---|
| `DJANGO_SECRET_KEY` | Long, random, unique secret |
| `DJANGO_DEBUG` | `false` |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated API hostnames |
| `CORS_ALLOWED_ORIGINS` | Comma-separated HTTPS frontend origins |
| `CSRF_TRUSTED_ORIGINS` | Comma-separated trusted HTTPS origins |
| `DATABASE_URL` | Managed PostgreSQL URL; required when DEBUG is false |
| `DJANGO_CACHE_URL` | Private shared Redis URL; required when DEBUG is false; separate staging/production |
| `ENABLE_CONSOLIDATION` | `false` for the first launch |
| `VITE_ENABLE_CONSOLIDATION` | Frontend build variable: `false` |
| `DRF_LOGIN_RATE` / `LOGIN_ACCOUNT_RATE` | Default `10/minute` each, IP and account respectively |
| `TRUSTED_PROXY_CIDRS` | Verified ingress networks only; empty ignores forwarded IPs |
| `EMAIL_BACKEND` | Production email backend |
| `EMAIL_HOST` / `EMAIL_PORT` | Provider SMTP endpoint |
| `EMAIL_HOST_USER` / `EMAIL_HOST_PASSWORD` | Provider credentials |
| `EMAIL_USE_TLS` | Normally `true` for SMTP submission |
| `DEFAULT_FROM_EMAIL` | Verified sender address |

After HTTPS and the reverse proxy are operational, set:

- `DJANGO_SECURE_SSL_REDIRECT=true`
- `DJANGO_SESSION_COOKIE_SECURE=true`
- `DJANGO_CSRF_COOKIE_SECURE=true`
- `DJANGO_SECURE_HSTS_SECONDS=31536000` only after HTTPS is confirmed on every route
- `DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS=true` only when every subdomain is HTTPS
- `DJANGO_SECURE_HSTS_PRELOAD=true` only after the domain satisfies preload requirements
- `DJANGO_TRUST_PROXY_SSL_HEADER=true` only when a trusted proxy overwrites `X-Forwarded-Proto`

`DATABASE_URL` selects the implemented PostgreSQL adapter; SQLite is available only with DEBUG enabled. Production infrastructure still needs verified TLS termination, DNS/domains, proxy trust boundaries, email delivery, backups and secret delivery. Follow `PHASE1_SECURITY.md` for Redis, migrations and session revocation rollout.
