# Ledgify production configuration

Production deployments must supply environment variables; no production secret or domain belongs in source control.

| Variable | Required production value |
|---|---|
| `DJANGO_SECRET_KEY` | Long, random, unique secret |
| `DJANGO_DEBUG` | `false` |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated API hostnames |
| `CORS_ALLOWED_ORIGINS` | Comma-separated HTTPS frontend origins |
| `CSRF_TRUSTED_ORIGINS` | Comma-separated trusted HTTPS origins |
| `DATABASE_URL` | Managed production database URL when the deployment database adapter is configured |
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

`DATABASE_URL` is documented as the deployment contract but the current development settings still use SQLite. Milestone 16 must select and configure the production database adapter, TLS termination, DNS/domains, proxy trust boundary, email provider, backups, and secret delivery.
