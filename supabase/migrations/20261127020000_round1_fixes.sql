-- Round-1 audit fixes: #555, #557, #559 (#556 and #560 are client-only).

-- ---------------------------------------------------------------------------
-- #555: the party view of lesson issue reports is read-only and runs as the caller.
-- Base-table RLS (online_lesson_issue_reports_party_read / _admin_table_read) and the
-- column grant (no resolved_by, no admin_notes) now decide what a caller sees.
-- Reports are created only through report_online_lesson_issue().
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.online_lesson_issue_reports_party;
CREATE VIEW public.online_lesson_issue_reports_party
WITH (security_invoker = true) AS
SELECT
  r.id,
  r.booking_id,
  r.reported_by,
  r.reporter_role,
  r.category,
  r.description,
  r.status,
  r.priority,
  r.minor_involved,
  r.created_at,
  r.resolved_at
FROM public.online_lesson_issue_reports r
WHERE
  r.reported_by = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.providers p ON p.id = b.provider_id
    WHERE b.id = r.booking_id
      AND (b.customer_id = (SELECT auth.uid()) OR p.profile_id = (SELECT auth.uid()))
  )
  OR public.has_role((SELECT auth.uid()), 'admin');

REVOKE ALL ON public.online_lesson_issue_reports_party FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.online_lesson_issue_reports_party TO authenticated;
GRANT SELECT ON public.online_lesson_issue_reports_party TO service_role;

-- Default privileges also gave clients TRUNCATE/REFERENCES/TRIGGER on the base table.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.online_lesson_issue_reports FROM PUBLIC, anon, authenticated;

-- Same hygiene for the admin identity-conflicts view: read-only, admins read it via RLS.
DO $$
BEGIN
  IF to_regclass('public.admin_identity_conflicts') IS NOT NULL THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
      ON public.admin_identity_conflicts FROM PUBLIC, anon, authenticated;
    REVOKE SELECT ON public.admin_identity_conflicts FROM PUBLIC, anon;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- #557: providers (and admins) read the transfer reference from its own column.
-- `note` stays admin-only: it can carry the admin's free-text note after the reference.
-- ---------------------------------------------------------------------------
ALTER TABLE public.provider_ledger_entries
  ADD COLUMN IF NOT EXISTS reference text;

GRANT SELECT (reference) ON public.provider_ledger_entries TO authenticated;

-- Stamps the reference given to the transfer RPCs below onto the row they insert.
CREATE OR REPLACE FUNCTION public.tg_provider_ledger_set_reference()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ref text := NULLIF(btrim(current_setting('app.ledger_reference', true)), '');
BEGIN
  IF NEW.reference IS NULL AND v_ref IS NOT NULL
     AND NEW.kind IN ('payout_sent', 'debt_payment_received') THEN
    NEW.reference := v_ref;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_provider_ledger_set_reference() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_provider_ledger_set_reference ON public.provider_ledger_entries;
CREATE TRIGGER trg_provider_ledger_set_reference
  BEFORE INSERT ON public.provider_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_provider_ledger_set_reference();

-- Re-derived from 20261115130000_provider_wallet_payout.sql; only the reference lines are new.
CREATE OR REPLACE FUNCTION public.admin_record_provider_debt_payment(
  p_provider_id uuid,
  p_amount numeric,
  p_reference text,
  p_reason text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_net numeric;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_reference IS NULL OR btrim(p_reference) = ''
     OR p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Amount, reference and reason are required' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('famy_provider_wallet:' || p_provider_id::text, 0));
  SELECT COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END), 0)
    INTO v_net
  FROM public.provider_ledger_entries e
  WHERE e.provider_id = p_provider_id;

  IF p_amount > -v_net THEN
    RAISE EXCEPTION 'Payment is more than this provider owes Famy' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.audit_reason', btrim(p_reason), true);
  PERFORM set_config('app.ledger_reference', btrim(p_reference), true);
  v_id := public.ledger_insert_entry(
    p_provider_id, NULL, 'debt_payment_received', 'credit', p_amount,
    'manual_transfer', concat('ref:', btrim(p_reference), ' ', coalesce(btrim(p_note), '')), auth.uid(), NULL
  );
  PERFORM set_config('app.ledger_reference', '', true);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_record_provider_debt_payment(uuid, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_record_provider_debt_payment(uuid, numeric, text, text, text) TO authenticated;

-- Re-derived from 20261123230200_codex_p1_round2.sql; only the reference lines are new.
CREATE OR REPLACE FUNCTION public.admin_record_provider_payout(
  p_provider_id uuid,
  p_amount numeric,
  p_reference text,
  p_reason text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_net numeric;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_reference IS NULL OR btrim(p_reference) = ''
     OR p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Amount, reference and reason are required' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('famy_provider_wallet:' || p_provider_id::text, 0));

  SELECT COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END), 0)
    INTO v_net
  FROM public.provider_ledger_entries e
  WHERE e.provider_id = p_provider_id;

  IF p_amount > GREATEST(v_net, 0) THEN
    RAISE EXCEPTION 'Payout exceeds payable balance after lesson-report holds' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.audit_reason', btrim(p_reason), true);
  PERFORM set_config('app.ledger_reference', btrim(p_reference), true);
  v_id := public.ledger_insert_entry(
    p_provider_id, NULL, 'payout_sent', 'debit', p_amount,
    'manual_transfer', concat('ref:', btrim(p_reference), ' ', coalesce(btrim(p_note), '')), auth.uid(), NULL
  );
  PERFORM set_config('app.ledger_reference', '', true);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_record_provider_payout(uuid, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_record_provider_payout(uuid, numeric, text, text, text) TO authenticated;

-- Backfill the reference on existing transfers. The only client (the admin wallet form)
-- never sends p_note, so the text after "ref:" is the reference alone.
ALTER TABLE public.provider_ledger_entries DISABLE TRIGGER trg_provider_ledger_immutable;
UPDATE public.provider_ledger_entries
SET reference = NULLIF(btrim(substring(note FROM 5)), '')
WHERE reference IS NULL
  AND kind IN ('payout_sent', 'debt_payment_received')
  AND note LIKE 'ref:%';
ALTER TABLE public.provider_ledger_entries ENABLE TRIGGER trg_provider_ledger_immutable;

-- ---------------------------------------------------------------------------
-- #559: pin search_path on functions that had none (bodies unchanged).
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.admin_mask_phone(text) SET search_path = public;
ALTER FUNCTION public.famy_normalize_parent_email(text) SET search_path = public;
ALTER FUNCTION public.famy_profile_phone_digits(text) SET search_path = public;
ALTER FUNCTION public.famy_valid_parent_email(text) SET search_path = public;
ALTER FUNCTION public.online_session_refund_reference(uuid, text) SET search_path = public;
ALTER FUNCTION public.payment_checkout_funded_total(public.payments) SET search_path = public;

-- Trigger functions run from their triggers; nobody calls them through the API.
REVOKE EXECUTE ON FUNCTION public.tg_booking_review_request_notify() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_customer_wallet_credit_notify() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_payment_status_notify() FROM PUBLIC, anon, authenticated;

-- pg_net stays in the public schema: pg_cron jobs (push dispatch, the online presence
-- poller) call net.http_post, and moving the extension would break those jobs.

-- ---------------------------------------------------------------------------
-- #560: signed-out visitors browse online tutors on the web (read-only).
-- Same card fields and eligibility as search_marketplace_providers in online mode,
-- limited to tutoring; no address, no caller identity. Booking still needs sign-in.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guest_search_online_tutors(
  p_service_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, full_name text, avatar_url text, bio_en text, bio_ar text,
  hourly_rate numeric, years_experience integer, languages text[], city text,
  is_top_pro boolean, is_verified boolean, response_time_min integer,
  service_id uuid, service_slug text, service_name_en text, service_name_ar text,
  category_slug text, rating_avg numeric, rating_count bigint, trust_score numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (p.id, s.id)
    p.id,
    pr.full_name,
    pr.avatar_url,
    p.bio_en,
    p.bio_ar,
    e.effective_price,
    p.years_experience,
    p.languages,
    p.city,
    p.is_top_pro,
    p.is_verified,
    p.response_time_min,
    s.id,
    s.slug,
    s.name_en,
    s.name_ar,
    c.slug,
    COALESCE(rs.rating_avg, 0),
    COALESCE(rs.rating_count, 0)::bigint,
    COALESCE(ts.score, 0)
  FROM public.providers p
  JOIN LATERAL public.marketplace_eligibility_internal(
    p.id, p_service_id, NULL, 'online'
  ) e ON e.is_eligible
  JOIN public.profiles pr ON pr.id = p.profile_id
  JOIN public.services s ON s.id = e.service_id
  JOIN public.categories c ON c.id = s.category_id
  LEFT JOIN public.ratings_summary rs ON rs.provider_id = p.id
  LEFT JOIN public.trust_scores ts ON ts.provider_id = p.id
  WHERE c.slug = 'tutoring'
    AND public.is_phase1_category_slug(c.slug)
    AND NOT public.provider_cash_debt_blocked_core(p.id)
  ORDER BY p.id, s.id, p.is_top_pro DESC, COALESCE(rs.rating_avg, 0) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.guest_search_online_tutors(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_search_online_tutors(uuid) TO anon, authenticated, service_role;
