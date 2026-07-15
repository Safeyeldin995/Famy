-- Famy Patch 4 / Module 2: Admin Operations and Immutable Audit Trail.
-- Additive only. Extends the existing audit_logs table/tg_audit_changes
-- trigger (20260627001502 / 20260627164829) instead of building a parallel
-- audit system, wires the same generic trigger onto tables that were never
-- covered (provider_services, services, payments, zones, zone_services,
-- zone_providers, notification_outbox), and adds a small set of
-- SECURITY DEFINER RPCs for the two admin actions that previously wrote
-- directly to a table with no way to require/attach a reason.

-- ============================================================
-- 1) audit_logs: additive columns for actor_role, booking_id, reason and a
-- per-transaction correlation_id, plus filter indexes for the audit UI.
-- ============================================================
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_role text,
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS correlation_id uuid;

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_booking ON public.audit_logs(booking_id) WHERE booking_id IS NOT NULL;

-- Immutable: no UPDATE/DELETE for anyone, including service_role — triggers
-- fire regardless of role/grant. Authenticated already has no INSERT/UPDATE/
-- DELETE grant on this table (only SELECT, gated to admin by audit_admin
-- below); every row is created by tg_audit_changes running as the function
-- owner. This trigger closes the remaining gap: nothing can ever edit or
-- remove a row that already exists, not even a service-role migration.
CREATE OR REPLACE FUNCTION public.tg_block_audit_log_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit log records are immutable.' USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_audit_log_mutation();

-- ============================================================
-- 2) tg_audit_changes: extend the existing generic trigger (used by every
-- trg_audit_* trigger below and by every one already wired in prior
-- migrations) to also populate actor_role, booking_id, reason and
-- correlation_id. CREATE OR REPLACE keeps the same signature/OID, so every
-- existing trg_audit_* trigger picks up the new behavior automatically —
-- no other migration file is touched.
--
-- reason resolution order: an explicit app.audit_reason set by an RPC in
-- the same transaction (see admin_set_provider_verification /
-- admin_set_provider_service_status below) wins; otherwise it falls back to
-- whichever known reason/notes column is present on the row, which already
-- covers admin_resolve_dispute / admin_resolve_no_show / support ticket
-- resolution / payment rejection (all pre-existing columns).
--
-- correlation_id: a fresh id is generated once per transaction (session
-- variable is_local=true, so it resets when the transaction ends) and
-- reused by every audit row inserted within it — e.g. an admin resolving a
-- dispute touches both `disputes` and `bookings` in one RPC call and gets
-- one shared correlation_id across both resulting audit rows.
--
-- Sensitive-field sanitization: a deny-list of key names is stripped from
-- before/after JSON before it is ever written, regardless of which table
-- fired the trigger — defense in depth even though no current table stores
-- secrets in these columns (payment_methods.public_config already has its
-- own CHECK constraint blocking these same keys at the source).
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_audit_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_id uuid;
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_booking_id uuid;
  v_reason text;
  v_correlation_id uuid;
  v_deny_keys CONSTANT text[] := ARRAY[
    'password', 'password_hash', 'access_token', 'refresh_token', 'service_role_key',
    'api_key', 'secret', 'secret_key', 'private_key', 'token', 'client_secret'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW); v_id := NEW.id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW); v_id := NEW.id;
    IF v_old = v_new THEN RETURN NEW; END IF;
  ELSE
    v_old := to_jsonb(OLD); v_id := OLD.id;
  END IF;

  IF v_old IS NOT NULL THEN v_old := v_old - v_deny_keys; END IF;
  IF v_new IS NOT NULL THEN v_new := v_new - v_deny_keys; END IF;

  IF public.has_role(v_actor, 'admin') THEN v_actor_role := 'admin';
  ELSIF public.has_role(v_actor, 'provider') THEN v_actor_role := 'provider';
  ELSIF public.has_role(v_actor, 'customer') THEN v_actor_role := 'customer';
  ELSE v_actor_role := NULL;
  END IF;

  IF TG_TABLE_NAME = 'bookings' THEN
    v_booking_id := v_id;
  ELSE
    v_booking_id := COALESCE((v_new->>'booking_id')::uuid, (v_old->>'booking_id')::uuid);
  END IF;

  v_reason := NULLIF(btrim(current_setting('app.audit_reason', true)), '');
  IF v_reason IS NULL THEN
    v_reason := COALESCE(
      v_new->>'reason', v_new->>'admin_notes', v_new->>'resolution_notes',
      v_new->>'rejection_reason', v_new->>'review_notes', v_new->>'cancellation_reason',
      v_old->>'reason', v_old->>'admin_notes', v_old->>'resolution_notes',
      v_old->>'rejection_reason', v_old->>'review_notes'
    );
  END IF;

  BEGIN
    v_correlation_id := NULLIF(current_setting('app.audit_correlation_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_correlation_id := NULL;
  END;
  IF v_correlation_id IS NULL THEN
    v_correlation_id := gen_random_uuid();
    PERFORM set_config('app.audit_correlation_id', v_correlation_id::text, true);
  END IF;

  INSERT INTO public.audit_logs(
    actor_id, actor_role, action, entity, entity_id, booking_id, reason, correlation_id, old_values, new_values, diff
  )
  VALUES (
    v_actor, v_actor_role, TG_OP, TG_TABLE_NAME, v_id, v_booking_id, v_reason, v_correlation_id, v_old, v_new,
    CASE WHEN TG_OP = 'UPDATE' THEN v_new - (SELECT jsonb_object_agg(k, v_old->k) FROM jsonb_object_keys(v_old) k WHERE v_old->k = v_new->k) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_audit_changes() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3) Wire the (now richer) generic audit trigger onto sensitive tables that
-- had no audit coverage at all: provider-service approval, service pricing,
-- payments, zones/coverage. provider_requirement_fulfillments (evidence
-- review), support_tickets/disputes/no_show_reports (cases) and
-- payment_methods/promo_codes/notification_campaigns already have one.
-- ============================================================
DROP TRIGGER IF EXISTS trg_audit_provider_services ON public.provider_services;
CREATE TRIGGER trg_audit_provider_services AFTER INSERT OR UPDATE OR DELETE ON public.provider_services
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

DROP TRIGGER IF EXISTS trg_audit_services ON public.services;
CREATE TRIGGER trg_audit_services AFTER INSERT OR UPDATE OR DELETE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

DROP TRIGGER IF EXISTS trg_audit_payments ON public.payments;
CREATE TRIGGER trg_audit_payments AFTER INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

DROP TRIGGER IF EXISTS trg_audit_zones ON public.zones;
CREATE TRIGGER trg_audit_zones AFTER INSERT OR UPDATE OR DELETE ON public.zones
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

DROP TRIGGER IF EXISTS trg_audit_zone_services ON public.zone_services;
CREATE TRIGGER trg_audit_zone_services AFTER INSERT OR DELETE ON public.zone_services
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

DROP TRIGGER IF EXISTS trg_audit_zone_providers ON public.zone_providers;
CREATE TRIGGER trg_audit_zone_providers AFTER INSERT OR DELETE ON public.zone_providers
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

DROP TRIGGER IF EXISTS trg_audit_notification_outbox ON public.notification_outbox;
CREATE TRIGGER trg_audit_notification_outbox AFTER UPDATE ON public.notification_outbox
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

-- ============================================================
-- 4) provider_services: add the missing rejection_reason column, and move
-- provider-service approval/rejection behind a SECURITY DEFINER RPC so a
-- reason can be required and recorded without trusting the client. The
-- existing tg_guard_provider_services trigger (admin-only status changes,
-- mandatory-requirement gate) is untouched and still runs on this UPDATE.
-- ============================================================
ALTER TABLE public.provider_services ADD COLUMN IF NOT EXISTS rejection_reason text;

CREATE OR REPLACE FUNCTION public.admin_set_provider_service_status(
  p_id uuid, p_status text, p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid provider service status.' USING ERRCODE = '23514';
  END IF;
  IF p_status = 'rejected' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'A reason is required to reject a provider service request.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.audit_reason', COALESCE(btrim(p_reason), ''), true);

  UPDATE public.provider_services
  SET status = p_status,
      rejection_reason = CASE WHEN p_status = 'rejected' THEN btrim(p_reason) ELSE NULL END
  WHERE id = p_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Provider service not found.' USING ERRCODE = '42501'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_provider_service_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_provider_service_status(uuid, text, text) TO authenticated;

-- ============================================================
-- 5) providers: same treatment for initial application approval/rejection
-- (is_verified/is_active together, matching the existing useSetProviderVerified
-- behavior). Suspending an already-verified provider is a separate, existing
-- action (useSetProviderActive) and is left as-is — still fully audited via
-- trg_audit_providers, just without a mandatory reason.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_set_provider_verification(
  p_provider_id uuid, p_verified boolean, p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF NOT p_verified AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'A reason is required to reject a provider application.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.audit_reason', COALESCE(btrim(p_reason), ''), true);

  UPDATE public.providers SET is_verified = p_verified, is_active = p_verified WHERE id = p_provider_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Provider not found.' USING ERRCODE = '42501'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_provider_verification(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_provider_verification(uuid, boolean, text) TO authenticated;

-- ============================================================
-- 6) notification_outbox: it currently has zero RLS policies for
-- `authenticated` (by design — see 20260714235000), so admin cannot read it
-- at all. Add an admin-only read policy plus a retry RPC; the retry itself
-- is a normal UPDATE so trg_audit_notification_outbox (above) records it.
-- ============================================================
DROP POLICY IF EXISTS "notification_outbox_admin_read" ON public.notification_outbox;
CREATE POLICY "notification_outbox_admin_read" ON public.notification_outbox FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.admin_retry_notification(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.notification_outbox
  SET status = 'queued', next_attempt_at = now(), attempts = 0, processing_started_at = NULL, last_error_safe = NULL
  WHERE id = p_id AND status IN ('failed', 'dead');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification is not in a retryable state.' USING ERRCODE = '23514';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_retry_notification(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_retry_notification(uuid) TO authenticated;

-- ============================================================
-- 7) admin_operations_summary — one round trip for every operations queue
-- count + oldest-pending age, all server-side (no full-table client loads).
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_operations_summary()
RETURNS TABLE (queue text, item_count bigint, oldest_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT 'pending_provider_services'::text, count(*), min(created_at) FROM public.provider_services WHERE status = 'pending'
  UNION ALL
  SELECT 'pending_requirement_reviews', count(*), min(created_at) FROM public.provider_requirement_fulfillments WHERE status = 'pending'
  UNION ALL
  SELECT 'flagged_provider_pricing', count(*), min(created_at) FROM public.provider_services WHERE flagged_for_review = true
  UNION ALL
  SELECT 'open_disputes', count(*), min(created_at) FROM public.disputes WHERE status IN ('open', 'info_requested')
  UNION ALL
  SELECT 'open_no_show_reports', count(*), min(created_at) FROM public.no_show_reports WHERE status IN ('open', 'info_requested')
  UNION ALL
  SELECT 'open_support_tickets', count(*), min(created_at) FROM public.support_tickets WHERE status IN ('open', 'pending')
  UNION ALL
  SELECT 'stuck_completion_requests', count(*), min(completion_requested_at) FROM public.bookings WHERE status = 'completion_requested'
  UNION ALL
  SELECT 'payments_needing_review', count(*), min(created_at) FROM public.payments WHERE status IN ('pending_review', 'failed')
  UNION ALL
  SELECT 'notification_delivery_failures', count(*), min(created_at) FROM public.notification_outbox WHERE status IN ('failed', 'dead');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_operations_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_operations_summary() TO authenticated;
