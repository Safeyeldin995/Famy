-- Reconcile monitoring table privileges with the Production hardening applied
-- 2026-09-28. Forward-only and idempotent: do not rewrite historical migrations
-- and do not change schema-wide default privileges.
--
-- Production applied names/versions (do not repair history to match these):
--   error_logs_monitoring                  20260928070210
--   error_logs_client_privileges_hardening 20260928070424
--   featured_promo_codes                   20260928070446
--   error_log_client_rate_limits_hardened  20260928070732
-- Repository counterparts remain 20260824150000 / 20260826150000 /
-- 20260827120000 plus this new forward migration.
--
-- Default public-schema table ACLs granted anon/authenticated TRUNCATE, which
-- RLS does not protect. Reproduce the exact live table ACLs only.

REVOKE ALL PRIVILEGES ON TABLE public.error_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.error_logs TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.error_logs TO service_role;

REVOKE ALL PRIVILEGES ON TABLE public.error_log_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.error_log_rate_limits TO service_role;

REVOKE ALL ON FUNCTION public.error_log_client_rate_limit_allow(text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.error_log_client_rate_limit_allow(text, int, int) TO service_role;
