-- Supabase security advisor remediation (Production 2026-10-27).
-- Forward-only: REVOKE/GRANT, ALTER FUNCTION search_path, guarded RPC body refresh.
-- No DROP, no data changes.
--
-- pg_net remains in schema public on purpose: moving it breaks pg_cron HTTP calls
-- that reference net.http_* without a schema prefix. Revisit in a dedicated migration.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Trigger helpers must not be callable via PostgREST /rpc (triggers still fire).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name,
           p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname LIKE 'tg\_%' ESCAPE '\'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
      r.schema_name,
      r.function_name,
      r.args
    );
  END LOOP;
END $$;

-- resolve_zone: keep anon + authenticated (public service-area / travel-fee lookup).
-- Reads active zones only; no PII.
REVOKE ALL ON FUNCTION public.resolve_zone(double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_zone(double precision, double precision) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Admin-only zone overlap RPC (was missing has_role guard).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_zone_overlap(p_polygon jsonb, p_exclude_zone_id uuid DEFAULT NULL)
RETURNS TABLE (zone_id uuid, name_en text, name_ar text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT z.id, z.name_en, z.name_ar
  FROM public.zones z
  WHERE z.is_active
    AND z.boundary_type = 'polygon'
    AND (p_exclude_zone_id IS NULL OR z.id <> p_exclude_zone_id)
    AND (
      EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_polygon) v
        WHERE public.point_in_polygon((v ->> 'lat')::double precision, (v ->> 'lng')::double precision, z.polygon)
      )
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(z.polygon) v
        WHERE public.point_in_polygon((v ->> 'lat')::double precision, (v ->> 'lng')::double precision, p_polygon)
      )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.check_zone_overlap(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_zone_overlap(jsonb, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Pin search_path on functions the advisor flagged as mutable.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name,
           p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
        WHERE cfg LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = public',
      r.schema_name,
      r.function_name,
      r.args
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4) RLS enabled, no client policy — intentional deny-all for PostgREST clients.
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.booking_reminders IS
  'Server/worker only (service_role). RLS ON with no anon/authenticated policies: PostgREST clients are denied by default.';

COMMENT ON TABLE public.error_log_rate_limits IS
  'Server/edge only (service_role). RLS ON with no client policies: intentional deny-all for anon/authenticated.';

COMMENT ON TABLE public.otp_verifications IS
  'Auth edge functions only (service_role). RLS ON with no client policies: clients must not read or write OTP rows.';

COMMENT ON TABLE public.password_setup_authorizations IS
  'Auth edge functions only (service_role). RLS ON with no client policies: password-setup tokens are server-side only.';

COMMENT ON TABLE public.paymob_webhook_events IS
  'Paymob webhook handler only (service_role). RLS ON with no client policies: idempotency ledger is not client-accessible.';

COMMIT;
