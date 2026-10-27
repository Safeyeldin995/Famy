# Supabase security advisor notes

## Dashboard toggles (Product Owner)

In the Supabase project dashboard:

1. **Authentication → Attack Protection → Leaked password protection** — enable (HaveIBeenPwned check on sign-up and password change).

## Intentional database posture

- **`pg_net` in `public`**: left in place so existing `pg_cron` jobs and SQL that call `net.http_*` without a schema prefix keep working. Moving the extension requires a coordinated migration of cron definitions and function bodies.
- **RLS with no policies** on `booking_reminders`, `error_log_rate_limits`, `otp_verifications`, `password_setup_authorizations`, and `paymob_webhook_events`: service-role and server paths only; PostgREST clients are denied by default.

Remediation migration: `20261027120000_supabase_security_advisor_remediation.sql`.
