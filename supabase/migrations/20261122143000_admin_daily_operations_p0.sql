-- Admin daily operations P0: provider statements, reports, payment queues and search.
-- Read-only and additive. All externally callable functions require an authenticated admin.

-- 1) Provider statement ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.provider_net_as_of(
  p_provider_id uuid,
  p_as_of timestamptz
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_net numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_provider_id IS NULL OR p_as_of IS NULL THEN
    RAISE EXCEPTION 'Provider and as-of time are required' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(
    SUM(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END),
    0
  )
  INTO v_net
  FROM public.provider_ledger_entries e
  WHERE e.provider_id = p_provider_id
    AND e.created_at < p_as_of;

  RETURN v_net;
END;
$$;
REVOKE ALL ON FUNCTION public.provider_net_as_of(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_net_as_of(uuid, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_provider_statement(
  p_provider_id uuid,
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
  v_provider_name text;
  v_opening numeric;
  v_closing numeric;
  v_period_net numeric;
  v_calculated_closing numeric;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_provider_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RAISE EXCEPTION 'Invalid statement period' USING ERRCODE = '23514';
  END IF;

  SELECT pr.full_name
  INTO v_provider_name
  FROM public.providers p
  JOIN public.profiles pr ON pr.id = p.profile_id
  WHERE p.id = p_provider_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider not found' USING ERRCODE = 'P0002';
  END IF;

  v_opening := public.provider_net_as_of(p_provider_id, p_from);
  v_closing := public.provider_net_as_of(p_provider_id, p_to);

  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', x.id,
        'created_at', x.created_at,
        'booking_id', x.booking_id,
        'booking_code', x.booking_code,
        'price_total', x.price_total,
        'commission', x.commission,
        'provider_share', x.provider_share,
        'kind', x.kind,
        'direction', x.direction,
        'amount', x.amount,
        'note', x.note,
        'payment_method', x.payment_method,
        'settlement_id', x.settlement_id
      )
      ORDER BY x.created_at, x.id
    ), '[]'::jsonb),
    COALESCE(SUM(CASE WHEN x.direction = 'credit' THEN x.amount ELSE -x.amount END), 0)
  INTO v_rows, v_period_net
  FROM (
    SELECT
      e.id,
      e.created_at,
      e.booking_id,
      CASE
        WHEN e.booking_id IS NULL THEN NULL
        ELSE left(upper(replace(e.booking_id::text, '-', '')), 6)
      END AS booking_code,
      b.price_total,
      CASE
        WHEN b.price_total IS NULL OR b.price_provider_net IS NULL THEN NULL
        ELSE b.price_total - b.price_provider_net
      END AS commission,
      b.price_provider_net AS provider_share,
      e.kind,
      e.direction,
      e.amount,
      e.note,
      e.payment_method,
      e.settlement_id
    FROM public.provider_ledger_entries e
    LEFT JOIN public.bookings b ON b.id = e.booking_id
    WHERE e.provider_id = p_provider_id
      AND e.created_at >= p_from
      AND e.created_at < p_to
  ) x;

  v_calculated_closing := v_opening + v_period_net;
  IF v_calculated_closing IS DISTINCT FROM v_closing THEN
    RAISE EXCEPTION 'Provider statement balance invariant failed' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'provider_id', p_provider_id,
    'provider_name', v_provider_name,
    'period_from', p_from,
    'period_to', p_to,
    'opening_balance', v_opening,
    'rows', v_rows,
    'period_net', v_period_net,
    'closing_balance', v_closing,
    'balance_check', jsonb_build_object(
      'calculated_closing', v_calculated_closing,
      'ledger_balance_as_of', public.provider_net_as_of(p_provider_id, p_to),
      'matches', v_calculated_closing = v_closing
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_provider_statement(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_provider_statement(uuid, timestamptz, timestamptz) TO authenticated;

-- 2) Reports --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_reports(
  p_from timestamptz,
  p_to timestamptz,
  p_group text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group text := lower(btrim(COALESCE(p_group, '')));
  v_step interval;
  v_buckets jsonb;
  v_totals jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RAISE EXCEPTION 'Invalid report period' USING ERRCODE = '23514';
  END IF;
  IF v_group NOT IN ('day', 'week', 'month') THEN
    RAISE EXCEPTION 'Report group must be day, week or month' USING ERRCODE = '23514';
  END IF;

  v_step := CASE v_group
    WHEN 'day' THEN interval '1 day'
    WHEN 'week' THEN interval '1 week'
    ELSE interval '1 month'
  END;

  WITH bucket_starts AS (
    SELECT gs AS local_start
    FROM generate_series(
      date_trunc(v_group, timezone('Africa/Cairo', p_from)),
      date_trunc(v_group, timezone('Africa/Cairo', p_to - interval '1 microsecond')),
      v_step
    ) gs
  ),
  booking_created AS (
    SELECT date_trunc(v_group, timezone('Africa/Cairo', b.created_at)) AS local_start,
           count(*)::bigint AS bookings_created
    FROM public.bookings b
    WHERE b.deleted_at IS NULL
      AND b.created_at >= p_from
      AND b.created_at < p_to
    GROUP BY 1
  ),
  booking_completed AS (
    SELECT date_trunc(v_group, timezone('Africa/Cairo', b.completed_at)) AS local_start,
           count(*)::bigint AS bookings_completed,
           COALESCE(sum(b.price_total), 0) AS revenue,
           COALESCE(sum(
             CASE
               WHEN b.price_total IS NOT NULL AND b.price_provider_net IS NOT NULL
                 THEN GREATEST(b.price_total - b.price_provider_net, 0)
               ELSE 0
             END
           ), 0) AS platform_commission
    FROM public.bookings b
    WHERE b.deleted_at IS NULL
      AND b.status = 'completed'
      AND b.completed_at >= p_from
      AND b.completed_at < p_to
    GROUP BY 1
  ),
  booking_cancelled AS (
    SELECT date_trunc(v_group, timezone('Africa/Cairo', b.cancelled_at)) AS local_start,
           count(*)::bigint AS bookings_cancelled
    FROM public.bookings b
    WHERE b.deleted_at IS NULL
      AND b.status = 'cancelled'
      AND b.cancelled_at >= p_from
      AND b.cancelled_at < p_to
    GROUP BY 1
  ),
  payment_received AS (
    SELECT
      date_trunc(
        v_group,
        timezone('Africa/Cairo', COALESCE(p.captured_at, p.created_at))
      ) AS local_start,
      COALESCE(sum(p.amount) FILTER (
        WHERE COALESCE(
          NULLIF(p.payment_method_type, ''),
          CASE
            WHEN p.method::text = 'cash' THEN 'cash'
            WHEN p.method::text = 'instapay' THEN 'manual_transfer'
            WHEN p.method::text IN ('card', 'paymob', 'wallet') THEN 'online'
          END
        ) = 'cash'
      ), 0) AS cash_collected,
      COALESCE(sum(p.amount) FILTER (
        WHERE COALESCE(
          NULLIF(p.payment_method_type, ''),
          CASE
            WHEN p.method::text = 'cash' THEN 'cash'
            WHEN p.method::text = 'instapay' THEN 'manual_transfer'
            WHEN p.method::text IN ('card', 'paymob', 'wallet') THEN 'online'
          END
        ) = 'online'
      ), 0) AS card_received,
      COALESCE(sum(p.amount) FILTER (
        WHERE COALESCE(
          NULLIF(p.payment_method_type, ''),
          CASE
            WHEN p.method::text = 'cash' THEN 'cash'
            WHEN p.method::text = 'instapay' THEN 'manual_transfer'
            WHEN p.method::text IN ('card', 'paymob', 'wallet') THEN 'online'
          END
        ) = 'manual_transfer'
      ), 0) AS instapay_received
    FROM public.payments p
    WHERE p.status = 'captured'
      AND COALESCE(p.captured_at, p.created_at) >= p_from
      AND COALESCE(p.captured_at, p.created_at) < p_to
    GROUP BY 1
  ),
  payment_refunded AS (
    SELECT
      date_trunc(
        v_group,
        timezone('Africa/Cairo', COALESCE(p.reviewed_at, p.updated_at, p.created_at))
      ) AS local_start,
      COALESCE(sum(
        CASE
          WHEN COALESCE(p.metadata #>> '{refund,amount_refunded}', '') ~ '^[0-9]+(\.[0-9]+)?$'
            THEN (p.metadata #>> '{refund,amount_refunded}')::numeric
          ELSE p.amount
        END
      ), 0) AS refunds_total
    FROM public.payments p
    WHERE p.status IN ('refunded', 'partially_refunded')
      AND COALESCE(p.reviewed_at, p.updated_at, p.created_at) >= p_from
      AND COALESCE(p.reviewed_at, p.updated_at, p.created_at) < p_to
    GROUP BY 1
  ),
  cancellation_fees AS (
    SELECT date_trunc(v_group, timezone('Africa/Cairo', e.created_at)) AS local_start,
           COALESCE(sum(e.amount), 0) AS cancellation_fees
    FROM public.provider_ledger_entries e
    WHERE e.kind = 'cancellation_fee_provider_share'
      AND e.direction = 'credit'
      AND e.created_at >= p_from
      AND e.created_at < p_to
    GROUP BY 1
  ),
  combined AS (
    SELECT
      bs.local_start,
      bs.local_start AT TIME ZONE 'Africa/Cairo' AS bucket_from,
      (bs.local_start + v_step) AT TIME ZONE 'Africa/Cairo' AS bucket_to,
      COALESCE(bc.bookings_created, 0) AS bookings_created,
      COALESCE(bco.bookings_completed, 0) AS bookings_completed,
      COALESCE(bca.bookings_cancelled, 0) AS bookings_cancelled,
      COALESCE(bco.revenue, 0) AS revenue,
      COALESCE(bco.platform_commission, 0) AS platform_commission,
      COALESCE(pr.cash_collected, 0) AS cash_collected,
      COALESCE(pr.card_received, 0) AS card_received,
      COALESCE(pr.instapay_received, 0) AS instapay_received,
      COALESCE(pref.refunds_total, 0) AS refunds_total,
      COALESCE(cf.cancellation_fees, 0) AS cancellation_fees
    FROM bucket_starts bs
    LEFT JOIN booking_created bc USING (local_start)
    LEFT JOIN booking_completed bco USING (local_start)
    LEFT JOIN booking_cancelled bca USING (local_start)
    LEFT JOIN payment_received pr USING (local_start)
    LEFT JOIN payment_refunded pref USING (local_start)
    LEFT JOIN cancellation_fees cf USING (local_start)
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'bucket', c.local_start::date,
        'bucket_from', c.bucket_from,
        'bucket_to', c.bucket_to,
        'bookings_created', c.bookings_created,
        'bookings_completed', c.bookings_completed,
        'bookings_cancelled', c.bookings_cancelled,
        'revenue', c.revenue,
        'platform_commission', c.platform_commission,
        'cash_collected', c.cash_collected,
        'card_received', c.card_received,
        'instapay_received', c.instapay_received,
        'refunds_total', c.refunds_total,
        'cancellation_fees', c.cancellation_fees
      )
      ORDER BY c.local_start
    ), '[]'::jsonb),
    jsonb_build_object(
      'bookings_created', COALESCE(sum(c.bookings_created), 0),
      'bookings_completed', COALESCE(sum(c.bookings_completed), 0),
      'bookings_cancelled', COALESCE(sum(c.bookings_cancelled), 0),
      'revenue', COALESCE(sum(c.revenue), 0),
      'platform_commission', COALESCE(sum(c.platform_commission), 0),
      'cash_collected', COALESCE(sum(c.cash_collected), 0),
      'card_received', COALESCE(sum(c.card_received), 0),
      'instapay_received', COALESCE(sum(c.instapay_received), 0),
      'refunds_total', COALESCE(sum(c.refunds_total), 0),
      'cancellation_fees', COALESCE(sum(c.cancellation_fees), 0)
    )
  INTO v_buckets, v_totals
  FROM combined c;

  RETURN jsonb_build_object(
    'period_from', p_from,
    'period_to', p_to,
    'group', v_group,
    'timezone', 'Africa/Cairo',
    'buckets', v_buckets,
    'totals', v_totals,
    'date_basis', jsonb_build_object(
      'bookings_created', jsonb_build_object(
        'basis', 'booking', 'timestamp', 'bookings.created_at'
      ),
      'bookings_completed', jsonb_build_object(
        'basis', 'booking', 'timestamp', 'bookings.completed_at'
      ),
      'bookings_cancelled', jsonb_build_object(
        'basis', 'booking', 'timestamp', 'bookings.cancelled_at'
      ),
      'revenue', jsonb_build_object(
        'basis', 'booking', 'timestamp', 'bookings.completed_at'
      ),
      'platform_commission', jsonb_build_object(
        'basis', 'booking', 'timestamp', 'bookings.completed_at'
      ),
      'cash_collected', jsonb_build_object(
        'basis', 'payment', 'timestamp', 'payments.captured_at, falling back to created_at'
      ),
      'card_received', jsonb_build_object(
        'basis', 'payment', 'timestamp', 'payments.captured_at, falling back to created_at'
      ),
      'instapay_received', jsonb_build_object(
        'basis', 'payment', 'timestamp', 'payments.captured_at, falling back to created_at'
      ),
      'refunds_total', jsonb_build_object(
        'basis', 'payment', 'timestamp', 'payments.reviewed_at, falling back to updated_at'
      ),
      'cancellation_fees', jsonb_build_object(
        'basis', 'payment', 'timestamp', 'provider_ledger_entries.created_at'
      )
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_reports(timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reports(timestamptz, timestamptz, text) TO authenticated;

-- 3) Payments queues ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_payment_situation(
  p_status text,
  p_payment_method_type text,
  p_method text,
  p_proof_path text,
  p_booking_status text,
  p_has_cash_ledger boolean
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text := COALESCE(p_status, '');
  v_booking text := COALESCE(p_booking_status, '');
  v_type text;
  v_closed boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;

  v_type := COALESCE(
    NULLIF(p_payment_method_type, ''),
    CASE COALESCE(p_method, '')
      WHEN 'instapay' THEN 'manual_transfer'
      WHEN 'cash' THEN 'cash'
      WHEN 'paymob' THEN 'online'
      WHEN 'card' THEN 'online'
      ELSE ''
    END
  );
  v_closed := v_booking IN ('cancelled', 'no_show');

  IF v_closed AND (
    (v_status = 'captured' AND v_type IN ('online', 'manual_transfer'))
    OR (v_status = 'pending_review' AND v_type = 'manual_transfer' AND p_proof_path IS NOT NULL)
  ) THEN
    RETURN 'refundDue';
  END IF;
  IF v_status = 'captured' THEN RETURN 'paid'; END IF;
  IF v_status = 'refunded' THEN RETURN 'refunded'; END IF;
  IF v_status = 'partially_refunded' THEN RETURN 'partiallyRefunded'; END IF;
  IF v_status = 'rejected' THEN RETURN 'rejected'; END IF;
  IF v_status = 'failed' THEN RETURN 'failed'; END IF;
  -- A transfer is reviewable only after a receipt exists. New manual transfers start in
  -- pending_review before upload, but must stay out of the admin action queue until then.
  IF v_status = 'pending_review'
     AND v_type = 'manual_transfer'
     AND p_proof_path IS NOT NULL
     AND NOT v_closed THEN
    RETURN 'review';
  END IF;

  IF v_status IN ('pending', 'pending_review', 'authorized') THEN
    IF v_closed THEN RETURN 'noPaymentDue'; END IF;
    IF v_type = 'cash' THEN
      IF v_booking <> 'completed' THEN RETURN 'cashAtVisit'; END IF;
      IF COALESCE(p_has_cash_ledger, false) THEN RETURN 'cashRecorded'; END IF;
      RETURN 'cashUnconfirmed';
    END IF;
    IF v_type = 'manual_transfer' THEN
      IF p_proof_path IS NOT NULL THEN RETURN 'review'; END IF;
      RETURN 'awaitingProof';
    END IF;
    IF v_type = 'online' THEN RETURN 'awaitingCard'; END IF;
  END IF;

  RETURN 'other';
END;
$$;
REVOKE ALL ON FUNCTION public.admin_payment_situation(text, text, text, text, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payment_situation(text, text, text, text, text, boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_payment_queue(
  p_tab text,
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
  v_tab text := lower(btrim(COALESCE(p_tab, '')));
  v_limit int := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF v_tab NOT IN ('refunds_due', 'receipts_ready', 'cash_to_confirm') THEN
    RAISE EXCEPTION 'Invalid payment queue tab' USING ERRCODE = '23514';
  END IF;

  WITH payment_rows AS (
    SELECT
      p.*,
      b.status::text AS booking_status,
      cp.full_name AS customer_name,
      b.provider_id,
      pp.id AS provider_profile_id,
      pp.full_name AS provider_name,
      EXISTS (
        SELECT 1
        FROM public.provider_ledger_entries e
        WHERE e.booking_id = p.booking_id
          AND e.kind = 'cash_collected_platform_share'
      ) AS has_cash_ledger
    FROM public.payments p
    JOIN public.bookings b ON b.id = p.booking_id
    JOIN public.profiles cp ON cp.id = b.customer_id
    JOIN public.providers pro ON pro.id = b.provider_id
    JOIN public.profiles pp ON pp.id = pro.profile_id
  ),
  situated AS (
    SELECT r.*,
      public.admin_payment_situation(
        r.status::text,
        r.payment_method_type,
        r.method::text,
        r.proof_path,
        r.booking_status,
        r.has_cash_ledger
      ) AS situation
    FROM payment_rows r
  ),
  filtered AS (
    SELECT s.*
    FROM situated s
    WHERE (v_tab = 'refunds_due' AND s.situation = 'refundDue')
       OR (v_tab = 'receipts_ready' AND s.situation = 'review')
       OR (v_tab = 'cash_to_confirm' AND s.situation = 'cashUnconfirmed')
  ),
  page AS (
    SELECT f.*
    FROM filtered f
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE((
      SELECT jsonb_agg(
        (to_jsonb(pg) - ARRAY[
          'booking_status', 'customer_name', 'provider_id',
          'provider_profile_id', 'provider_name'
        ]) || jsonb_build_object(
          'booking', jsonb_build_object(
            'id', pg.booking_id,
            'status', pg.booking_status,
            'customer', jsonb_build_object(
              'id', pg.customer_id,
              'full_name', pg.customer_name
            ),
            'provider', jsonb_build_object(
              'id', pg.provider_id,
              'profile', jsonb_build_object(
                'id', pg.provider_profile_id,
                'full_name', pg.provider_name
              )
            )
          )
        )
        ORDER BY pg.created_at DESC, pg.id DESC
      )
      FROM page pg
    ), '[]'::jsonb)
  INTO v_total, v_items;

  RETURN jsonb_build_object(
    'tab', v_tab,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'items', v_items
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_payment_queue(text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payment_queue(text, int, int) TO authenticated;

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
  v_fee_payments bigint;
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
      )
    ) AS situation
    FROM public.payments p
    JOIN public.bookings b ON b.id = p.booking_id
  )
  SELECT
    count(*) FILTER (WHERE situation = 'refundDue'),
    count(*) FILTER (WHERE situation = 'review'),
    count(*) FILTER (WHERE situation = 'cashUnconfirmed')
  INTO v_refunds, v_receipts, v_cash
  FROM situated;

  SELECT count(*)
  INTO v_fee_payments
  FROM public.customer_debt_settlements s
  WHERE s.status = 'pending_review';

  RETURN jsonb_build_object(
    'refunds_due', COALESCE(v_refunds, 0),
    'receipts_ready', COALESCE(v_receipts, 0),
    'cash_to_confirm', COALESCE(v_cash, 0),
    'fee_payments', COALESCE(v_fee_payments, 0)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_payment_queue_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payment_queue_counts() TO authenticated;

-- 4) Global admin search ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_global_search(
  p_query text,
  p_limit int DEFAULT 15,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_query text := btrim(COALESCE(p_query, ''));
  v_query_lower text;
  v_digits text;
  v_normalized_digits text;
  v_code text;
  v_limit int := GREATEST(1, LEAST(COALESCE(p_limit, 15), 50));
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_customers_total bigint := 0;
  v_providers_total bigint := 0;
  v_bookings_total bigint := 0;
  v_customers jsonb := '[]'::jsonb;
  v_providers jsonb := '[]'::jsonb;
  v_bookings jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;

  IF v_query = '' THEN
    RETURN jsonb_build_object(
      'query', v_query,
      'limit', v_limit,
      'offset', v_offset,
      'customers', jsonb_build_object('total', 0, 'items', '[]'::jsonb),
      'providers', jsonb_build_object('total', 0, 'items', '[]'::jsonb),
      'bookings', jsonb_build_object('total', 0, 'items', '[]'::jsonb)
    );
  END IF;

  v_query_lower := lower(v_query);
  v_digits := regexp_replace(v_query, '\D', '', 'g');
  v_normalized_digits := CASE
    WHEN v_digits LIKE '0020%' THEN substr(v_digits, 3)
    WHEN v_digits LIKE '0%' THEN '20' || substr(v_digits, 2)
    ELSE v_digits
  END;
  v_code := upper(replace(v_query, '-', ''));

  WITH matches AS (
    SELECT pr.id, pr.full_name, pr.phone, pr.email, pr.avatar_url, pr.created_at
    FROM public.profiles pr
    WHERE EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = pr.id
        AND ur.role = 'customer'
    )
      AND (
        strpos(lower(COALESCE(pr.full_name, '')), v_query_lower) > 0
        OR (
          v_digits <> ''
          AND (
            strpos(regexp_replace(COALESCE(pr.phone, ''), '\D', '', 'g'), v_digits) > 0
            OR strpos(
              CASE
                WHEN regexp_replace(COALESCE(pr.phone, ''), '\D', '', 'g') LIKE '0%'
                  THEN '20' || substr(regexp_replace(pr.phone, '\D', '', 'g'), 2)
                ELSE regexp_replace(COALESCE(pr.phone, ''), '\D', '', 'g')
              END,
              v_normalized_digits
            ) > 0
          )
        )
      )
  ),
  page AS (
    SELECT *
    FROM matches
    ORDER BY full_name ASC NULLS LAST, created_at DESC, id
    LIMIT v_limit OFFSET v_offset
  )
  SELECT
    (SELECT count(*) FROM matches),
    COALESCE(jsonb_agg(to_jsonb(page) ORDER BY full_name ASC NULLS LAST, created_at DESC, id), '[]'::jsonb)
  INTO v_customers_total, v_customers
  FROM page;

  WITH matches AS (
    SELECT
      p.id AS provider_id,
      pr.id AS profile_id,
      pr.full_name,
      pr.phone,
      pr.email,
      pr.avatar_url,
      p.onboarding_status,
      p.is_active,
      p.is_verified,
      p.created_at
    FROM public.providers p
    JOIN public.profiles pr ON pr.id = p.profile_id
    WHERE
      strpos(lower(COALESCE(pr.full_name, '')), v_query_lower) > 0
      OR (
        v_digits <> ''
        AND (
          strpos(regexp_replace(COALESCE(pr.phone, ''), '\D', '', 'g'), v_digits) > 0
          OR strpos(
            CASE
              WHEN regexp_replace(COALESCE(pr.phone, ''), '\D', '', 'g') LIKE '0%'
                THEN '20' || substr(regexp_replace(pr.phone, '\D', '', 'g'), 2)
              ELSE regexp_replace(COALESCE(pr.phone, ''), '\D', '', 'g')
            END,
            v_normalized_digits
          ) > 0
        )
      )
  ),
  page AS (
    SELECT *
    FROM matches
    ORDER BY full_name ASC NULLS LAST, created_at DESC, provider_id
    LIMIT v_limit OFFSET v_offset
  )
  SELECT
    (SELECT count(*) FROM matches),
    COALESCE(
      jsonb_agg(to_jsonb(page) ORDER BY full_name ASC NULLS LAST, created_at DESC, provider_id),
      '[]'::jsonb
    )
  INTO v_providers_total, v_providers
  FROM page;

  WITH matches AS (
    SELECT
      b.id,
      left(upper(replace(b.id::text, '-', '')), 6) AS booking_code,
      b.status,
      b.customer_id,
      cp.full_name AS customer_name,
      b.provider_id,
      pp.full_name AS provider_name,
      b.start_at,
      b.created_at
    FROM public.bookings b
    JOIN public.profiles cp ON cp.id = b.customer_id
    JOIN public.providers p ON p.id = b.provider_id
    JOIN public.profiles pp ON pp.id = p.profile_id
    WHERE strpos(lower(b.id::text), v_query_lower) > 0
       OR (
         v_code ~ '^[0-9A-F]{1,32}$'
         AND upper(replace(b.id::text, '-', '')) LIKE v_code || '%'
       )
       OR strpos(lower(COALESCE(cp.full_name, '')), v_query_lower) > 0
       OR strpos(lower(COALESCE(pp.full_name, '')), v_query_lower) > 0
  ),
  page AS (
    SELECT *
    FROM matches
    ORDER BY created_at DESC, id
    LIMIT v_limit OFFSET v_offset
  )
  SELECT
    (SELECT count(*) FROM matches),
    COALESCE(jsonb_agg(to_jsonb(page) ORDER BY created_at DESC, id), '[]'::jsonb)
  INTO v_bookings_total, v_bookings
  FROM page;

  RETURN jsonb_build_object(
    'query', v_query,
    'limit', v_limit,
    'offset', v_offset,
    'customers', jsonb_build_object(
      'total', v_customers_total,
      'items', v_customers
    ),
    'providers', jsonb_build_object(
      'total', v_providers_total,
      'items', v_providers
    ),
    'bookings', jsonb_build_object(
      'total', v_bookings_total,
      'items', v_bookings
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_global_search(text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_global_search(text, int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';
