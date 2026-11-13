-- Admin performance dashboard aggregates (additive, read-only).
-- Days are Cairo calendar days. Nothing here writes data.

CREATE OR REPLACE FUNCTION public.admin_growth_metrics(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 7), 365);
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
  v_first date := v_today - (v_days - 1);
  v_from timestamptz := (v_first::timestamp AT TIME ZONE 'Africa/Cairo');
  v_daily jsonb;
  v_totals jsonb;
  v_funnel jsonb;
  v_services jsonb;
  v_app jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;

  WITH days AS (
    SELECT d::date AS day
    FROM generate_series(v_first, v_today, interval '1 day') AS d
  ),
  customers AS (
    SELECT (ur.created_at AT TIME ZONE 'Africa/Cairo')::date AS day, count(*) AS n
    FROM public.user_roles ur
    WHERE ur.role = 'customer' AND ur.created_at >= v_from
    GROUP BY 1
  ),
  providers AS (
    SELECT (p.created_at AT TIME ZONE 'Africa/Cairo')::date AS day, count(*) AS n
    FROM public.providers p
    WHERE p.deleted_at IS NULL AND p.created_at >= v_from
    GROUP BY 1
  ),
  created AS (
    SELECT (b.created_at AT TIME ZONE 'Africa/Cairo')::date AS day, count(*) AS n
    FROM public.bookings b
    WHERE b.deleted_at IS NULL AND b.created_at >= v_from
    GROUP BY 1
  ),
  completed AS (
    SELECT
      (b.completed_at AT TIME ZONE 'Africa/Cairo')::date AS day,
      count(*) AS n,
      COALESCE(SUM(b.price_total), 0) AS revenue,
      COALESCE(SUM(CASE WHEN b.price_provider_net IS NOT NULL
        THEN GREATEST(b.price_total - b.price_provider_net, 0) ELSE 0 END), 0) AS share
    FROM public.bookings b
    WHERE b.deleted_at IS NULL AND b.status = 'completed' AND b.completed_at >= v_from
    GROUP BY 1
  ),
  cancelled AS (
    SELECT (b.cancelled_at AT TIME ZONE 'Africa/Cairo')::date AS day, count(*) AS n
    FROM public.bookings b
    WHERE b.deleted_at IS NULL AND b.status = 'cancelled' AND b.cancelled_at >= v_from
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'day', d.day,
      'new_customers', COALESCE(c.n, 0),
      'new_providers', COALESCE(p.n, 0),
      'bookings_created', COALESCE(cr.n, 0),
      'bookings_completed', COALESCE(co.n, 0),
      'bookings_cancelled', COALESCE(ca.n, 0),
      'revenue', COALESCE(co.revenue, 0),
      'platform_share', COALESCE(co.share, 0)
    ) ORDER BY d.day), '[]'::jsonb)
  INTO v_daily
  FROM days d
  LEFT JOIN customers c ON c.day = d.day
  LEFT JOIN providers p ON p.day = d.day
  LEFT JOIN created cr ON cr.day = d.day
  LEFT JOIN completed co ON co.day = d.day
  LEFT JOIN cancelled ca ON ca.day = d.day;

  SELECT jsonb_build_object(
    'customers_total', (SELECT count(*) FROM public.user_roles WHERE role = 'customer'),
    'providers_total', (SELECT count(*) FROM public.providers WHERE deleted_at IS NULL),
    'providers_approved', (SELECT count(*) FROM public.providers
                           WHERE deleted_at IS NULL AND onboarding_status = 'APPROVED'),
    'bookings_total', (SELECT count(*) FROM public.bookings WHERE deleted_at IS NULL),
    'rating_avg', (SELECT round(avg(r.rating)::numeric, 2) FROM public.reviews r WHERE r.deleted_at IS NULL),
    'rating_count', (SELECT count(*) FROM public.reviews r WHERE r.deleted_at IS NULL),
    'repeat_customers', (
      SELECT count(*) FROM (
        SELECT b.customer_id FROM public.bookings b
        WHERE b.deleted_at IS NULL AND b.status = 'completed'
        GROUP BY b.customer_id HAVING count(*) >= 2
      ) x
    ),
    'customers_with_booking', (
      SELECT count(DISTINCT b.customer_id) FROM public.bookings b WHERE b.deleted_at IS NULL
    )
  )
  INTO v_totals;

  SELECT COALESCE(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
  INTO v_funnel
  FROM (
    SELECT p.onboarding_status::text AS status, count(*) AS n
    FROM public.providers p
    WHERE p.deleted_at IS NULL
    GROUP BY 1
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'service_id', x.service_id, 'name_ar', x.name_ar, 'name_en', x.name_en, 'bookings', x.n
    ) ORDER BY x.n DESC), '[]'::jsonb)
  INTO v_services
  FROM (
    SELECT b.service_id, s.name_ar, s.name_en, count(*) AS n
    FROM public.bookings b
    JOIN public.services s ON s.id = b.service_id
    WHERE b.deleted_at IS NULL AND b.created_at >= v_from
    GROUP BY b.service_id, s.name_ar, s.name_en
    ORDER BY count(*) DESC
    LIMIT 5
  ) x;

  WITH devices AS (
    SELECT t.user_id, t.platform, max(t.last_seen_at) AS last_seen
    FROM public.device_push_tokens t
    WHERE t.revoked_at IS NULL
    GROUP BY t.user_id, t.platform
  ),
  users AS (
    SELECT d.user_id, d.platform, d.last_seen,
      CASE
        WHEN EXISTS (SELECT 1 FROM public.providers p WHERE p.profile_id = d.user_id AND p.deleted_at IS NULL)
          THEN 'provider'
        ELSE 'customer'
      END AS kind
    FROM devices d
  )
  SELECT jsonb_build_object(
    'customers', (SELECT count(DISTINCT user_id) FROM users WHERE kind = 'customer'),
    'providers', (SELECT count(DISTINCT user_id) FROM users WHERE kind = 'provider'),
    'android', (SELECT count(DISTINCT user_id) FROM users WHERE platform = 'android'),
    'ios', (SELECT count(DISTINCT user_id) FROM users WHERE platform = 'ios'),
    'active_7d', (SELECT count(DISTINCT user_id) FROM users WHERE last_seen >= now() - interval '7 days'),
    'active_30d', (SELECT count(DISTINCT user_id) FROM users WHERE last_seen >= now() - interval '30 days')
  )
  INTO v_app;

  RETURN jsonb_build_object(
    'days', v_days,
    'from', v_from,
    'daily', v_daily,
    'totals', v_totals,
    'provider_funnel', v_funnel,
    'top_services', v_services,
    'app', v_app
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_growth_metrics(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_growth_metrics(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
