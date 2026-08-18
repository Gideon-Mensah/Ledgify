# Secret rotation

Use the deployment secret manager and dual-credential/provider rollover where available. Rotate database, SMTP, AI and storage credentials by issuing a new credential, updating staging, validating, updating production, then revoking the old credential. Rotate Sentry DSN/token in its provider and confirm redaction.

Rotating `DJANGO_SECRET_KEY` invalidates signed sessions/tokens and may log users out; schedule and communicate it. JWT signing currently follows Django secret configuration, so refresh/access tokens must be considered revoked. Never place replacement values in Git, CI logs, shell history or frontend `VITE_` variables. Record owner, timestamp and verification without recording the secret.
