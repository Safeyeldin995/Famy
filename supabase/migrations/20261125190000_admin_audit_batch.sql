-- Admin audit batch: list RPCs, promo scope, online issue resolves, finance filters,
-- work-queue counts, payment queue counts, booking_expiry guard.

-- ---------------------------------------------------------------------------
-- 1) Promo code category/service scope (admin, atomic)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_promo_code_scope(
  p_promo_code_id uuid,
  p_category_ids uuid[],
  p_service_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text;
  v_category_ids uuid[] := COALESCE(p_category_ids, ARRAY[]::uuid[]);
  v_service_ids uuid[] := COALESCE(p_service_ids, ARRAY[]::uuid[]);
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_promo_code_id IS NULL THEN
    RAISE EXCEPTION 'Promo code id is required.' USING ERRCODE = '23514';
  END IF;

  SELECT pc.applicable_scope
  INTO v_scope
  FROM public.promo_codes pc
  WHERE pc.id = p_promo_code_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promo code not found.' USING ERRCODE = '42501';
  END IF;

  IF v_scope = 'categories' THEN
    IF COALESCE(array_length(v_category_ids, 1), 0) < 1 THEN
      RAISE EXCEPTION 'At least one category is required for category-scoped promo codes.' USING ERRCODE = '23514';
    END IF;
  ELSIF v_scope = 'services' THEN
    IF COALESCE(array_length(v_service_ids, 1), 0) < 1 THEN
      RAISE EXCEPTION 'At least one service is required for service-scoped promo codes.' USING ERRCODE = '23514';
    END IF;
  ELSIF v_scope = 'all' THEN
    IF COALESCE(array_length(v_category_ids, 1), 0) > 0
       OR COALESCE(array_length(v_service_ids, 1), 0) > 0 THEN
      RAISE EXCEPTION 'All-scope promo codes cannot have category or service restrictions.' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid promo applicable scope.' USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.promo_code_categories WHERE promo_code_id = p_promo_code_id;
  DELETE FROM public.promo_code_services WHERE promo_code_id = p_promo_code_id;

  IF COALESCE(array_length(v_category_ids, 1), 0) > 0 THEN
    INSERT INTO public.promo_code_categories (promo_code_id, category_id)
    SELECT p_promo_code_id, cid
    FROM unnest(v_category_ids) AS cid;
  END IF;

  IF COALESCE(array_length(v_service_ids, 1), 0) > 0 THEN
    INSERT INTO public.promo_code_services (promo_code_id, service_id)
    SELECT p_promo_code_id, sid
    FROM unnest(v_service_ids) AS sid;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_promo_code_scope(uuid, uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_promo_code_scope(uuid, uuid[], uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Paginated admin customer directory
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_customers_list(
  p_query text,
  p_filter text,
  p_limit int,
  p_offset int
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_query text := btrim(COALESCE(p_query, ''));
  v_filter text := lower(btrim(COALESCE(p_filter, 'all')));
  v_limit int := GREATEST(1, LEAST(COALESCE(p_limit, 50), 300));
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF v_filter NOT IN ('all', 'active', 'suspended', 'has_bookings', 'no_bookings') THEN
    RAISE EXCEPTION 'Invalid customer filter.' USING ERRCODE = '23514';
  END IF;

  WITH booking_stats AS (
    SELECT
      b.customer_id,
      count(*)::int AS total_bookings,
      count(*) FILTER (WHERE b.status = 'completed')::int AS completed_bookings,
      count(*) FILTER (WHERE b.status IN ('cancelled', 'no_show'))::int AS cancelled_bookings
    FROM public.bookings b
  GROUP BY b.customer_id
  ),
  spent AS (
    SELECT
      pay.customer_id,
      COALESCE(SUM(pay.amount), 0) AS total_spent
    FROM public.payments pay
    WHERE pay.status = 'captured'
    GROUP BY pay.customer_id
  ),
  base AS (
    SELECT
      pr.*,
      COALESCE(bs.total_bookings, 0) AS total_bookings,
      COALESCE(bs.completed_bookings, 0) AS completed_bookings,
      COALESCE(bs.cancelled_bookings, 0) AS cancelled_bookings,
      COALESCE(sp.total_spent, 0) AS total_spent
    FROM public.profiles pr
    INNER JOIN public.admin_customer_identity_ids() aci ON aci.user_id = pr.id
    LEFT JOIN booking_stats bs ON bs.customer_id = pr.id
    LEFT JOIN spent sp ON sp.customer_id = pr.id
    WHERE
      (v_filter = 'all')
      OR (v_filter = 'active' AND pr.is_suspended IS NOT TRUE)
      OR (v_filter = 'suspended' AND pr.is_suspended IS TRUE)
      OR (v_filter = 'has_bookings' AND COALESCE(bs.total_bookings, 0) > 0)
      OR (v_filter = 'no_bookings' AND COALESCE(bs.total_bookings, 0) = 0)
  ),
  filtered AS (
    SELECT *
    FROM base b
    WHERE v_query = ''
       OR COALESCE(b.full_name, '') ILIKE '%' || v_query || '%'
       OR COALESCE(b.phone, '') ILIKE '%' || v_query || '%'
       OR b.id::text ILIKE '%' || v_query || '%'
  ),
  page AS (
    SELECT *
    FROM filtered f
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE((
      SELECT jsonb_agg(
        to_jsonb(pg) - 'total_bookings' - 'completed_bookings' - 'cancelled_bookings' - 'total_spent'
        || jsonb_build_object(
          'totalBookings', pg.total_bookings,
          'completedBookings', pg.completed_bookings,
          'cancelledBookings', pg.cancelled_bookings,
          'totalSpent', pg.total_spent
        )
        ORDER BY pg.created_at DESC, pg.id DESC
      )
      FROM page pg
    ), '[]'::jsonb)
  INTO v_total, v_items;

  RETURN jsonb_build_object('total', v_total, 'items', v_items);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_customers_list(text, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_customers_list(text, text, int, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Paginated admin provider directory
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_providers_list(
  p_query text,
  p_filter text,
  p_queue text,
  p_limit int,
  p_offset int
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_query text := btrim(COALESCE(p_query, ''));
  v_filter text := lower(btrim(COALESCE(p_filter, 'all')));
  v_queue text := NULLIF(btrim(COALESCE(p_queue, '')), '');
  v_limit int := GREATEST(1, LEAST(COALESCE(p_limit, 50), 300));
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF v_filter NOT IN ('all', 'pending', 'verified', 'suspended') THEN
    RAISE EXCEPTION 'Invalid provider filter.' USING ERRCODE = '23514';
  END IF;

  WITH base AS (
    SELECT
      p.*,
      to_jsonb(pr) AS profile,
      CASE WHEN rs.provider_id IS NOT NULL THEN to_jsonb(rs) END AS ratings,
      CASE WHEN ts.provider_id IS NOT NULL THEN to_jsonb(ts) END AS trust
    FROM public.providers p
    INNER JOIN public.admin_provider_identity_ids() api ON api.provider_id = p.id
    INNER JOIN public.profiles pr ON pr.id = p.profile_id
    LEFT JOIN public.ratings_summary rs ON rs.provider_id = p.id
    LEFT JOIN public.trust_scores ts ON ts.provider_id = p.id
    WHERE
      CASE
        WHEN v_queue IS NULL THEN true
        ELSE p.id IN (
          SELECT wq.provider_id
          FROM public.admin_work_queue_provider_ids(v_queue) wq
        )
      END
      AND (
        v_filter = 'all'
        OR (v_filter = 'pending'
          AND p.is_verified IS NOT TRUE
          AND p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW', 'NEEDS_CHANGES'))
        OR (v_filter = 'verified' AND p.is_verified IS TRUE AND p.is_active IS TRUE)
        OR (v_filter = 'suspended' AND p.is_active IS FALSE AND p.is_verified IS TRUE)
      )
  ),
  filtered AS (
    SELECT *
    FROM base b
    WHERE v_query = ''
       OR COALESCE(b.profile->>'full_name', '') ILIKE '%' || v_query || '%'
       OR COALESCE(b.profile->>'phone', '') ILIKE '%' || v_query || '%'
       OR b.id::text ILIKE '%' || v_query || '%'
  ),
  page AS (
    SELECT *
    FROM filtered f
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE((
      SELECT jsonb_agg(
        (to_jsonb(pg) - 'profile' - 'ratings' - 'trust')
        || jsonb_build_object(
          'profile', pg.profile,
          'ratings', pg.ratings,
          'trust', pg.trust
        )
        ORDER BY pg.created_at DESC, pg.id DESC
      )
      FROM page pg
    ), '[]'::jsonb)
  INTO v_total, v_items;

  RETURN jsonb_build_object('total', v_total, 'items', v_items);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_providers_list(text, text, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_providers_list(text, text, text, int, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Paginated admin payments list
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_payments_list(
  p_query text,
  p_status text,
  p_limit int,
  p_offset int
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_query text := btrim(COALESCE(p_query, ''));
  v_status text := NULLIF(btrim(COALESCE(p_status, '')), '');
  v_limit int := GREATEST(1, LEAST(COALESCE(p_limit, 50), 300));
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  WITH payment_rows AS (
    SELECT
      pay.*,
      b.id AS booking_row_id,
      b.status AS booking_status,
      cp.id AS customer_profile_id,
      cp.full_name AS customer_name,
      cp.phone AS customer_phone,
      pro.id AS provider_row_id,
      pp.full_name AS provider_name
    FROM public.payments pay
    INNER JOIN public.bookings b ON b.id = pay.booking_id
    INNER JOIN public.profiles cp ON cp.id = b.customer_id
    INNER JOIN public.providers pro ON pro.id = b.provider_id
    INNER JOIN public.profiles pp ON pp.id = pro.profile_id
    WHERE v_status IS NULL OR pay.status::text = v_status
  ),
  filtered AS (
    SELECT pr.*
    FROM payment_rows pr
    WHERE v_query = ''
       OR COALESCE(pr.customer_name, '') ILIKE '%' || v_query || '%'
       OR COALESCE(pr.provider_name, '') ILIKE '%' || v_query || '%'
       OR COALESCE(pr.customer_phone, '') ILIKE '%' || v_query || '%'
       OR pr.id::text ILIKE '%' || v_query || '%'
       OR pr.booking_id::text ILIKE '%' || v_query || '%'
  ),
  page AS (
    SELECT *
    FROM filtered f
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE((
      SELECT jsonb_agg(
        (to_jsonb(pg) - 'booking_row_id' - 'booking_status'
          - 'customer_profile_id' - 'customer_name' - 'customer_phone'
          - 'provider_row_id' - 'provider_name')
        || jsonb_build_object(
          'booking', jsonb_build_object(
            'id', pg.booking_id,
            'status', pg.booking_status,
            'customer', jsonb_build_object(
              'id', pg.customer_profile_id,
              'full_name', pg.customer_name,
              'phone', pg.customer_phone
            ),
            'provider', jsonb_build_object(
              'id', pg.provider_row_id,
              'profile', jsonb_build_object('full_name', pg.provider_name)
            )
          )
        )
        ORDER BY pg.created_at DESC, pg.id DESC
      )
      FROM page pg
    ), '[]'::jsonb)
  INTO v_total, v_items;

  RETURN jsonb_build_object('total', v_total, 'items', v_items);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_payments_list(text, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payments_list(text, text, int, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5–6) Resolve online lesson issues and session admin reviews
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_resolve_online_lesson_issue(
  p_id uuid,
  p_status text,
  p_admin_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('resolved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid issue status.' USING ERRCODE = '23514';
  END IF;
  IF p_admin_notes IS NULL OR btrim(p_admin_notes) = '' THEN
    RAISE EXCEPTION 'Admin notes are required to close an issue.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.online_lesson_issue_reports r
  SET
    status = p_status,
    admin_notes = btrim(p_admin_notes),
    resolved_at = now(),
    resolved_by = auth.uid()
  WHERE r.id = p_id
    AND r.status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open online lesson issue not found.' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_resolve_online_lesson_issue(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_online_lesson_issue(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_resolve_online_session_review(
  p_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Invalid review status.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.online_session_admin_reviews r
  SET
    status = p_status,
    resolved_at = now()
  WHERE r.id = p_id
    AND r.status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open online session review not found.' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_resolve_online_session_review(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_online_session_review(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7–8) Finance dashboard: non-zero provider population only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_finance_summary(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_methods jsonb;
  v_platform_share numeric;
  v_owed_to numeric;
  v_owed_by numeric;
  v_pending_count bigint;
  v_pending_amount numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RAISE EXCEPTION 'Invalid period' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(jsonb_object_agg(x.bucket, x.amt), '{}'::jsonb)
  INTO v_methods
  FROM (
    SELECT
      CASE
        WHEN COALESCE(p.payment_method_type, '') = 'cash'
          OR COALESCE(p.payment_method_code, p.method::text, '') IN ('cash', 'cash_on_delivery')
          THEN 'cash'
        WHEN COALESCE(p.payment_method_code, p.method::text, '') = 'paymob'
          OR COALESCE(p.payment_method_type, '') = 'online'
          THEN 'gateway'
        WHEN COALESCE(p.payment_method_type, '') = 'manual_transfer'
          OR COALESCE(p.payment_method_code, p.method::text, '') IN ('instapay', 'manual_transfer')
          THEN 'transfer'
        ELSE COALESCE(NULLIF(COALESCE(p.payment_method_code, p.method::text), ''), 'unknown')
      END AS bucket,
      SUM(p.amount) AS amt
    FROM public.payments p
    INNER JOIN public.bookings b ON b.id = p.booking_id
    WHERE p.status = 'captured'
      AND b.status = 'completed'
      AND b.completed_at >= p_from
      AND b.completed_at < p_to
    GROUP BY 1
  ) x;

  SELECT COALESCE(SUM(x.share), 0)
  INTO v_platform_share
  FROM (
    SELECT e.amount AS share
    FROM public.provider_ledger_entries e
    JOIN public.bookings b ON b.id = e.booking_id
    WHERE e.kind = 'cash_collected_platform_share'
      AND e.direction = 'debit'
      AND b.status = 'completed'
      AND b.completed_at >= p_from
      AND b.completed_at < p_to
    UNION ALL
    SELECT GREATEST(b.price_total - b.price_provider_net, 0) AS share
    FROM public.provider_ledger_entries e
    JOIN public.bookings b ON b.id = e.booking_id
    WHERE e.kind = 'online_provider_share'
      AND e.direction = 'credit'
      AND b.status = 'completed'
      AND b.completed_at >= p_from
      AND b.completed_at < p_to
      AND b.price_provider_net IS NOT NULL
      AND b.price_total IS NOT NULL
  ) x;

  SELECT
    COALESCE(SUM(GREATEST(b.net, 0)), 0),
    COALESCE(SUM(GREATEST(-b.net, 0)), 0)
  INTO v_owed_to, v_owed_by
  FROM public.providers p
  CROSS JOIN LATERAL public.provider_balance(p.id) b
  WHERE abs(b.net) > 0.00001
     OR b.cash_held_for_platform > 0;

  SELECT count(*)::bigint, COALESCE(SUM(s.amount), 0)
  INTO v_pending_count, v_pending_amount
  FROM public.provider_settlements s
  WHERE s.status = 'pending';

  RETURN jsonb_build_object(
    'totals_by_method', COALESCE(v_methods, '{}'::jsonb),
    'platform_share', v_platform_share,
    'owed_to_providers', v_owed_to,
    'owed_by_providers', v_owed_by,
    'pending_settlement_count', v_pending_count,
    'pending_settlement_amount', v_pending_amount,
    'period_from', p_from,
    'period_to', p_to
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_finance_summary(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_finance_summary(timestamptz, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_finance_provider_rows()
RETURNS TABLE (
  provider_id uuid,
  full_name text,
  net numeric,
  cash_held numeric,
  at_limit boolean,
  last_settlement_at timestamptz,
  last_settlement_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    pr.full_name,
    b.net,
    b.cash_held_for_platform,
    public.provider_cash_debt_blocked(p.id),
    ls.settled_at,
    ls.status
  FROM public.providers p
  JOIN public.profiles pr ON pr.id = p.profile_id
  CROSS JOIN LATERAL public.provider_balance(p.id) b
  LEFT JOIN LATERAL (
    SELECT s.settled_at, s.status
    FROM public.provider_settlements s
    WHERE s.provider_id = p.id
    ORDER BY s.created_at DESC
    LIMIT 1
  ) ls ON true
  WHERE abs(b.net) > 0.00001
     OR b.cash_held_for_platform > 0
  ORDER BY abs(b.net) DESC, pr.full_name ASC NULLS LAST;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_finance_provider_rows() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_finance_provider_rows() TO authenticated;

-- ---------------------------------------------------------------------------
-- 9) Work queue counts (+ finance queues)
-- ---------------------------------------------------------------------------
-- Merged from main (24140000) plus #431, #502, and finance queues in this batch.
CREATE OR REPLACE FUNCTION public.admin_work_queue_counts()
RETURNS TABLE(queue text, item_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutoff timestamptz;
  v_sla_hours integer;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT s.completion_auto_from INTO v_cutoff
  FROM public.booking_expiry_settings() s;
  v_sla_hours := public.provider_review_sla_hours();

  RETURN QUERY
  SELECT 'new_applications'::text, count(*) FROM public.providers p
    WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND p.resubmitted_at IS NULL
      AND p.id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'resubmitted_applications'::text, count(*) FROM public.providers p
    WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND p.resubmitted_at IS NOT NULL
      AND p.id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'applications_over_sla'::text, count(*) FROM public.providers p
    WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW')
      AND COALESCE(p.resubmitted_at, p.submitted_at, p.created_at) < now() - (v_sla_hours || ' hours')::interval
      AND p.id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'new_service_requests'::text, count(*) FROM public.provider_services ps
    JOIN public.providers p ON p.id = ps.provider_id
    WHERE ps.status = 'pending' AND p.onboarding_status = 'APPROVED'
      AND ps.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'price_change_requests'::text, count(*) FROM public.provider_services ps
    WHERE ps.status = 'approved'
      AND (
        ps.pending_price_override IS NOT NULL
        OR ps.pending_online_price_override IS NOT NULL
      )
      AND ps.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'pending_services'::text, count(*) FROM public.provider_services ps
    WHERE ps.status = 'pending'
      AND ps.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'pending_teaching_groups'::text, count(*) FROM (
    SELECT 1 FROM public.provider_teaching_capabilities c WHERE c.status = 'pending'
      AND c.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
    GROUP BY c.provider_id, c.service_id, c.subject_id, c.curriculum_id,
      c.session_duration_min, c.session_price
  ) groups_pending
  UNION ALL
  SELECT 'pending_documents'::text, count(*) FROM public.provider_documents d
    WHERE d.status = 'pending'
      AND d.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'documents_expiring_soon'::text, count(*) FROM public.provider_documents d
    WHERE d.status = 'approved'
      AND d.expires_at IS NOT NULL
      AND d.expires_at <= now() + interval '30 days'
      AND d.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'open_cases'::text,
    (SELECT count(*) FROM public.disputes d WHERE d.status IN ('open', 'info_requested'))
    + (SELECT count(*) FROM public.support_tickets s WHERE s.status IN ('open', 'pending'))
  UNION ALL
  SELECT 'bookings_needing_action'::text,
    (SELECT count(*) FROM public.bookings b WHERE b.status IN ('disputed', 'no_show'))
    + (SELECT count(*) FROM public.online_session_admin_reviews rc WHERE rc.status = 'open')
  UNION ALL
  SELECT 'online_lesson_issue_reports'::text,
    (SELECT count(*) FROM public.online_lesson_issue_reports r WHERE r.status = 'open')
  UNION ALL
  SELECT 'ugc_reports'::text,
    (SELECT count(*) FROM public.ugc_reports u WHERE u.status = 'open')
  UNION ALL
  SELECT 'payments_pending_review'::text, count(*) FROM public.payments pay
    WHERE pay.status = 'pending_review'
  UNION ALL
  SELECT 'bookings_lifecycle_attention'::text, count(*) FROM public.bookings b
    WHERE
      (b.status = 'confirmed' AND b.end_at < now())
      OR (b.status = 'arrived' AND b.status_changed_at < now() - interval '30 minutes')
      OR (b.status = 'completion_requested'
          AND b.completion_requested_at IS NOT NULL
          AND b.completion_requested_at < v_cutoff
          AND b.completion_requested_at < now() - interval '12 hours')
      OR (b.status = 'in_progress' AND now() > b.start_at + (b.end_at - b.start_at) + interval '2 hours')
  UNION ALL
  SELECT 'pending_settlements'::text,
    (SELECT count(*) FROM public.provider_settlements s WHERE s.status = 'pending')
  UNION ALL
  SELECT 'providers_at_cash_limit'::text,
    (
      SELECT count(*)
      FROM public.providers p
      WHERE p.onboarding_status = 'APPROVED'
        AND public.provider_cash_debt_blocked(p.id)
        AND p.id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
    );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_work_queue_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_work_queue_counts() TO authenticated;

-- ---------------------------------------------------------------------------
-- 10) Payment queue counts (#503 base + fee/unmapped in needs_action)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_payment_queue_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_refunds bigint;
  v_receipts bigint;
  v_cash bigint;
  v_needs_action bigint;
  v_fee_payments bigint;
  v_unmapped bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;

  WITH situated AS (
    SELECT public.admin_payment_situation(
      p.status::text,
      p.payment_method_type,
      p.method::text,
      p.proof_path,
      b.status::text,
      EXISTS (
        SELECT 1
        FROM public.provider_ledger_entries e
        WHERE e.booking_id = p.booking_id
          AND e.kind = 'cash_collected_platform_share'
      ),
      p.metadata
    ) AS situation
    FROM public.payments p
    JOIN public.bookings b ON b.id = p.booking_id
  )
  SELECT
    count(*) FILTER (WHERE situation = 'refundDue'),
    count(*) FILTER (WHERE situation = 'review'),
    count(*) FILTER (WHERE situation = 'cashUnconfirmed'),
    count(*) FILTER (WHERE situation IN ('refundDue', 'review', 'cashUnconfirmed', 'paymobNeedsAction'))
  INTO v_refunds, v_receipts, v_cash, v_needs_action
  FROM situated;

  SELECT count(*)
  INTO v_fee_payments
  FROM public.customer_debt_settlements s
  WHERE s.status = 'pending_review';

  SELECT count(*)
  INTO v_unmapped
  FROM public.paymob_unmapped_captures u
  WHERE u.needs_admin_review AND u.reconciled_payment_id IS NULL;

  v_needs_action := COALESCE(v_needs_action, 0)
    + COALESCE(v_fee_payments, 0)
    + COALESCE(v_unmapped, 0);

  RETURN jsonb_build_object(
    'refunds_due', COALESCE(v_refunds, 0),
    'receipts_ready', COALESCE(v_receipts, 0),
    'cash_to_confirm', COALESCE(v_cash, 0),
    'needs_action', COALESCE(v_needs_action, 0),
    'fee_payments', COALESCE(v_fee_payments, 0)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_payment_queue_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payment_queue_counts() TO authenticated;

-- ---------------------------------------------------------------------------
-- 11) settings guard: booking_expiry
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_validate_settings_booking_expiry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ttl numeric;
  v_min numeric;
BEGIN
  IF NEW.key IS DISTINCT FROM 'booking_expiry' THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.value) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'booking_expiry settings value must be an object.' USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(NEW.value->'pending_ttl_hours') = 'number' THEN
    v_ttl := (NEW.value->>'pending_ttl_hours')::numeric;
  END IF;
  IF jsonb_typeof(NEW.value->'min_hours_before_start') = 'number' THEN
    v_min := (NEW.value->>'min_hours_before_start')::numeric;
  END IF;

  IF v_ttl IS NOT NULL AND v_ttl < 1 THEN
    RAISE EXCEPTION 'booking_expiry.pending_ttl_hours must be at least 1.' USING ERRCODE = '23514';
  END IF;
  IF v_min IS NOT NULL AND v_min < 0 THEN
    RAISE EXCEPTION 'booking_expiry.min_hours_before_start must be at least 0.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_validate_settings_booking_expiry() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_validate_settings_booking_expiry ON public.settings;
CREATE TRIGGER tg_validate_settings_booking_expiry
  BEFORE INSERT OR UPDATE ON public.settings
  FOR EACH ROW
  WHEN (NEW.key = 'booking_expiry')
  EXECUTE FUNCTION public.tg_validate_settings_booking_expiry();

-- ---------------------------------------------------------------------------
-- 12) booking_expiry_settings: TTL below 1 is invalid (default 12)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_expiry_settings()
RETURNS TABLE (
  pending_ttl_hours numeric,
  min_hours_before_start numeric,
  auto_complete_hours numeric,
  completion_auto_from timestamptz,
  confirmed_unpaid_hours_after_confirm numeric,
  confirmed_unpaid_minutes_before_start numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value jsonb;
  v_ttl numeric;
  v_min numeric;
  v_auto numeric;
  v_from timestamptz;
BEGIN
  SELECT s.value INTO v_value FROM public.settings s WHERE s.key = 'booking_expiry';
  pending_ttl_hours := NULL;
  min_hours_before_start := NULL;
  IF jsonb_typeof(v_value->'pending_ttl_hours') = 'number' THEN
    pending_ttl_hours := (v_value->>'pending_ttl_hours')::numeric;
  END IF;
  IF jsonb_typeof(v_value->'min_hours_before_start') = 'number' THEN
    min_hours_before_start := (v_value->>'min_hours_before_start')::numeric;
  END IF;
  IF jsonb_typeof(v_value->'auto_complete_hours') = 'number' THEN
    v_auto := (v_value->>'auto_complete_hours')::numeric;
  END IF;
  IF jsonb_typeof(v_value->'completion_auto_from') = 'string' THEN
    BEGIN
      v_from := (v_value->>'completion_auto_from')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_from := NULL;
    END;
  END IF;
  pending_ttl_hours :=
    CASE WHEN pending_ttl_hours IS NOT NULL AND pending_ttl_hours >= 1 THEN pending_ttl_hours ELSE 12 END;
  min_hours_before_start :=
    CASE WHEN min_hours_before_start IS NOT NULL AND min_hours_before_start >= 0
      THEN min_hours_before_start ELSE 2 END;
  auto_complete_hours := CASE
    WHEN v_auto IS NULL THEN 6
    ELSE LEAST(24, GREATEST(1, v_auto))
  END;
  completion_auto_from := COALESCE(v_from, now());
  confirmed_unpaid_hours_after_confirm :=
    COALESCE((v_value->>'confirmed_unpaid_hours_after_confirm')::numeric, 2);
  confirmed_unpaid_minutes_before_start :=
    COALESCE((v_value->>'confirmed_unpaid_minutes_before_start')::numeric, 60);
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.booking_expiry_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_expiry_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.booking_expiry_settings() TO service_role;

NOTIFY pgrst, 'reload schema';