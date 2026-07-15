-- Famy Patch 4 / Module 2 audit fixes. Additive only — 20260716020000 is
-- already applied and is left untouched; this migration only issues
-- CREATE OR REPLACE on functions it defined and adds new indexes.
--
-- Confirmed defects fixed here (verified empirically against the linked
-- database with `supabase db query --linked` before and after):
--
-- 1) CRITICAL correctness bug: tg_audit_changes' diff computation used
--    `v_new - (SELECT jsonb_object_agg(...))`, i.e. `jsonb - jsonb`. That
--    operator does not exist in Postgres (confirmed via
--    `SELECT '{}'::jsonb - '{}'::jsonb` -> "42883: operator does not
--    exist: jsonb - jsonb"). Since tg_audit_changes runs AFTER UPDATE and
--    an exception there aborts the whole triggering UPDATE, every UPDATE
--    on every audited table — including the brand new
--    admin_set_provider_service_status / admin_set_provider_verification /
--    admin_retry_notification RPCs from 20260716020000 — would fail at the
--    moment it actually changed a row. Replaced with an equivalent built
--    from jsonb_each() + IS DISTINCT FROM, verified to return the correct
--    changed-keys-only object.
--
-- 2) Sanitization only stripped top-level JSON keys (`v_old - v_deny_keys`
--    only inspects the row's own top-level columns). A secret nested
--    inside a jsonb column (e.g. payments.metadata.api_key, or a
--    payment_methods.public_config sub-object — the existing CHECK
--    constraint on that column is also top-level-only) would have been
--    written to audit_logs unredacted. Replaced with a recursive redactor
--    applied to old/new/diff.
-- ============================================================

CREATE OR REPLACE FUNCTION public.audit_redact_jsonb(p_value jsonb, p_deny_keys text[])
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_result jsonb;
  v_key text;
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  ELSIF jsonb_typeof(p_value) = 'object' THEN
    v_result := '{}'::jsonb;
    FOR v_key IN SELECT jsonb_object_keys(p_value) LOOP
      IF lower(v_key) = ANY(p_deny_keys) THEN
        CONTINUE;
      END IF;
      v_result := v_result || jsonb_build_object(v_key, public.audit_redact_jsonb(p_value -> v_key, p_deny_keys));
    END LOOP;
    RETURN v_result;
  ELSIF jsonb_typeof(p_value) = 'array' THEN
    SELECT COALESCE(jsonb_agg(public.audit_redact_jsonb(elem, p_deny_keys)), '[]'::jsonb)
      INTO v_result
      FROM jsonb_array_elements(p_value) AS elem;
    RETURN v_result;
  ELSE
    RETURN p_value;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.audit_redact_jsonb(jsonb, text[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_audit_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_diff jsonb;
  v_id uuid;
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_booking_id uuid;
  v_reason text;
  v_correlation_id uuid;
  v_deny_keys CONSTANT text[] := ARRAY[
    'password', 'password_hash', 'access_token', 'refresh_token', 'service_role_key',
    'api_key', 'secret', 'secret_key', 'private_key', 'token', 'client_secret',
    'authorization', 'auth_token', 'session_token'
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

  -- booking_id/reason are read from the raw (pre-redaction) row — neither
  -- is ever a deny-listed key, and resolving them first keeps this
  -- independent of the redaction step below.
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

  -- Changed-keys-only object: for every key in the new row whose value is
  -- distinct from the old row's value at that key. (jsonb - jsonb is not a
  -- valid Postgres operator; the previous expression using it would raise
  -- "42883: operator does not exist" on every UPDATE and abort the
  -- triggering statement.)
  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(jsonb_object_agg(t.key, t.value), '{}'::jsonb)
      INTO v_diff
      FROM jsonb_each(v_new) AS t(key, value)
      WHERE (v_old -> t.key) IS DISTINCT FROM t.value;
  ELSE
    v_diff := NULL;
  END IF;

  IF public.has_role(v_actor, 'admin') THEN v_actor_role := 'admin';
  ELSIF public.has_role(v_actor, 'provider') THEN v_actor_role := 'provider';
  ELSIF public.has_role(v_actor, 'customer') THEN v_actor_role := 'customer';
  ELSE v_actor_role := NULL;
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

  v_old := public.audit_redact_jsonb(v_old, v_deny_keys);
  v_new := public.audit_redact_jsonb(v_new, v_deny_keys);
  v_diff := public.audit_redact_jsonb(v_diff, v_deny_keys);

  INSERT INTO public.audit_logs(
    actor_id, actor_role, action, entity, entity_id, booking_id, reason, correlation_id, old_values, new_values, diff
  )
  VALUES (
    v_actor, v_actor_role, TG_OP, TG_TABLE_NAME, v_id, v_booking_id, v_reason, v_correlation_id, v_old, v_new, v_diff
  );
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_audit_changes() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3) Operations dashboard (admin_operations_summary) filters that had no
-- supporting index: payments.status, provider_requirement_fulfillments.status,
-- notification_outbox.status, provider_services.flagged_for_review. The
-- other five queues already had a usable index (bookings.status;
-- provider_services.status; disputes/no_show_reports/support_tickets each
-- have a partial unique index whose predicate matches the queue's WHERE
-- clause exactly).
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);
CREATE INDEX IF NOT EXISTS idx_prf_status ON public.provider_requirement_fulfillments(status);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_status ON public.notification_outbox(status);
CREATE INDEX IF NOT EXISTS idx_provider_services_flagged ON public.provider_services(flagged_for_review) WHERE flagged_for_review = true;
