-- Admin audit fixes (#550, #551, #552, #553).
--
--   * #550 admin_booking_refund_terms subtracts what Paymob already returned to the
--     card (gateway_refund_amount_cents on the payment), so «رد ثمن الحصة للمحفظة»
--     can never pay the same money twice. A refund whose amount Paymob did not send
--     blocks the wallet refund until the admin checks it. The money card shows the
--     card refund on its own line.
--   * #551 every «مشاكل» card counts exactly the list it opens:
--     admin_ops_problem_booking_ids() is the one condition for the booking cards,
--     the Paymob card counts the new 'paymob' tab of admin_payment_queue, and the
--     notification / error cards use the monitoring page's own 7-day summary.
--   * #552 new 'attendance_failed' card: online lessons of the last 24 hours whose
--     attendance check is failing now, or that ended without enough attendance
--     evidence.
--   * #553 admin_global_search reads Arabic-Indic and Persian digits as Western.
--
-- Each function below is re-derived from its latest definition
-- (20261126170000_admin_wallet_ops, 20261125140300_audit_security_money_batch).
-- SECURITY DEFINER, search_path pinned, admin role checked; internal helpers stay
-- service_role only.

-- ---------------------------------------------------------------------------
-- #550: refund terms count the card refund
-- ---------------------------------------------------------------------------
-- What Paymob already returned to the card for this payment, in EGP. The refund
-- webhook (paymob_apply_refund_webhook, 20261126210000) keeps the running total in
-- gateway_refund_amount_cents; a voided transaction returns the whole card amount.
-- Never above what the payment funded.
CREATE OR REPLACE FUNCTION public.payment_gateway_refunded_total(p_pay public.payments)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT LEAST(
    GREATEST(
      COALESCE(NULLIF(p_pay.metadata->>'gateway_refund_amount_cents', '')::numeric, 0) / 100.0,
      CASE
        WHEN COALESCE((p_pay.metadata->>'gateway_refund_voided')::boolean, false)
          THEN COALESCE(p_pay.amount, 0)
        ELSE 0
      END
    ),
    public.payment_checkout_funded_total(p_pay)
  );
$$;
REVOKE ALL ON FUNCTION public.payment_gateway_refunded_total(public.payments) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_gateway_refunded_total(public.payments) TO service_role;

-- What Famy still holds for this payment and can still refund: the funded
-- total minus what Paymob returned to the card and minus earlier admin wallet
-- refunds (wallet_refunded_total). The one number every wallet refund, admin
-- or automatic, starts from (#550, #572).
CREATE OR REPLACE FUNCTION public.payment_held_after_card_refund(p_pay public.payments)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT GREATEST(
    public.payment_checkout_funded_total(p_pay)
      - public.payment_gateway_refunded_total(p_pay)
      - COALESCE(NULLIF(p_pay.metadata->>'wallet_refunded_total', '')::numeric, 0),
    0
  );
$$;
REVOKE ALL ON FUNCTION public.payment_held_after_card_refund(public.payments) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_held_after_card_refund(public.payments) TO service_role;

-- Paymob said a refund happened but did not send how much. The refund webhook
-- keeps gateway_refund_unknown_since until Paymob sends the total refunded
-- (a cumulative callback with an amount), so a later refund transaction with
-- its own amount does not hide the unknown one. An admin who checked Paymob and
-- resolved the flag (paymob_resolved_at, removed again by every new refund
-- callback) lifts the block.
CREATE OR REPLACE FUNCTION public.payment_gateway_refund_unknown(p_pay public.payments)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT (
      NULLIF(p_pay.metadata->>'gateway_refund_unknown_since', '') IS NOT NULL
      OR COALESCE((p_pay.metadata->>'gateway_refund_amount_unknown')::boolean, false)
      OR (
        NULLIF(p_pay.metadata->>'gateway_refund_recorded_at', '') IS NOT NULL
        AND NULLIF(p_pay.metadata->>'gateway_refund_amount_cents', '') IS NULL
      )
    )
    AND NULLIF(p_pay.metadata->>'paymob_resolved_at', '') IS NULL;
$$;
REVOKE ALL ON FUNCTION public.payment_gateway_refund_unknown(public.payments) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_gateway_refund_unknown(public.payments) TO service_role;

-- Refund terms for a booking, without side effects. Mirrors
-- admin_record_payment_refund (fee to the tutor, carried fees settled) so a
-- wallet refund and a card refund give the customer the same amount.
-- Money Paymob already returned to the card (recorded by the refund webhook on
-- the payment, whose status stays 'captured') is no longer held, so it comes
-- off the maximum in every mode.
CREATE OR REPLACE FUNCTION public.admin_booking_refund_terms(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b public.bookings%ROWTYPE;
  v_pay public.payments%ROWTYPE;
  v_pay_id uuid;
  v_funded numeric := 0;
  v_held numeric := 0;
  v_already numeric := 0;
  v_card_refunded numeric := 0;
  v_card_unknown boolean := false;
  v_fee numeric := 0;
  v_carried numeric := 0;
  v_mode text;
  v_max numeric := 0;
  v_blocked text;
BEGIN
  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('blocked', 'booking_not_found');
  END IF;

  v_pay_id := public.admin_booking_funding_payment_id(p_booking_id);
  IF v_pay_id IS NOT NULL THEN
    SELECT * INTO v_pay FROM public.payments WHERE id = v_pay_id;
    v_funded := public.payment_checkout_funded_total(v_pay);
    v_card_refunded := public.payment_gateway_refunded_total(v_pay);
    v_held := public.payment_held_after_card_refund(v_pay);
    v_card_unknown := public.payment_gateway_refund_unknown(v_pay);
  END IF;

  IF v_b.status::text IN ('cancelled', 'no_show') THEN
    v_mode := 'cancelled';
  ELSIF v_b.status::text = 'completed' THEN
    v_mode := 'completed';
  ELSE
    v_mode := 'active';
  END IF;

  IF v_pay_id IS NULL THEN
    v_blocked := CASE
      WHEN EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.booking_id = p_booking_id AND p.status = 'refunded'
          AND COALESCE(p.payment_method_type, '') IN ('online', 'manual_transfer')
      ) THEN 'already_refunded'
      ELSE 'no_held_money'
    END;
  ELSIF v_mode = 'active' THEN
    v_blocked := 'booking_active';
  ELSIF v_mode = 'cancelled' THEN
    IF v_pay.status <> 'captured'
       OR COALESCE((v_pay.metadata->>'refund_settled_via_wallet')::boolean, false)
       OR COALESCE(v_pay.metadata->>'wallet_refund_settled', 'false') = 'true'
       OR EXISTS (
         SELECT 1 FROM public.customer_wallet_entries e
         WHERE e.payment_id = v_pay.id
           AND e.reason IN (
             'provider_cancelled', 'customer_cancelled_refund',
             'online_no_show_refund', 'admin_lesson_refund'
           )
       ) THEN
      v_blocked := 'already_refunded';
    ELSE
      v_carried := LEAST(COALESCE(v_b.carried_fees_amount, 0), v_held);
      IF EXISTS (SELECT 1 FROM public.customer_debts d WHERE d.booking_id = v_b.id AND d.status = 'paid') THEN
        v_fee := 0;
      ELSIF EXISTS (
        SELECT 1 FROM public.customer_debts d
        JOIN public.bookings cb ON cb.id = d.carried_booking_id
        WHERE d.booking_id = v_b.id AND d.status = 'open'
          AND cb.status::text NOT IN ('cancelled', 'no_show', 'completed')
      ) THEN
        v_fee := 0;
      ELSE
        v_fee := LEAST(COALESCE(public.booking_cancellation_fee(v_b.id), 0), v_held - v_carried);
      END IF;
      v_max := GREATEST(v_held - v_fee - v_carried, 0);
    END IF;
  ELSE
    -- Completed lesson: a goodwill refund, possibly in several parts. The
    -- tutor keeps their share; the money comes from Famy.
    v_already := COALESCE((v_pay.metadata->>'wallet_refunded_total')::numeric, 0);
    IF v_pay.status <> 'captured' THEN
      v_blocked := 'already_refunded';
    END IF;
    -- v_held already takes off the earlier wallet refunds.
    v_max := v_held;
  END IF;

  -- Paymob reported a refund without its amount: nothing can be offered until
  -- the admin checks the payment in Paymob.
  IF v_blocked IS NULL AND v_card_unknown THEN
    v_blocked := 'card_refund_unknown';
  END IF;
  IF v_blocked IS NULL AND v_max <= 0 THEN
    v_blocked := CASE WHEN v_card_refunded > 0 THEN 'refunded_to_card' ELSE 'nothing_left' END;
  END IF;

  RETURN jsonb_build_object(
    'booking_id', v_b.id,
    'customer_id', v_b.customer_id,
    'booking_status', v_b.status,
    'mode', v_mode,
    'payment_id', v_pay_id,
    'payment_status', v_pay.status,
    'payment_method_type', v_pay.payment_method_type,
    'funded_total', v_funded,
    'already_refunded', v_already,
    'card_refunded', v_card_refunded,
    'cancellation_fee', v_fee,
    'carried_fees', v_carried,
    'max_refundable', CASE WHEN v_blocked IS NULL THEN v_max ELSE 0 END,
    'blocked', v_blocked
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_booking_refund_terms(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_booking_refund_terms(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- #550: the money card shows the card refund
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_booking_money_summary(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b public.bookings%ROWTYPE;
  v_payments jsonb;
  v_wallet jsonb;
  v_ledger jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'status', p.status,
    'method_type', p.payment_method_type,
    'method', p.method,
    'amount', p.amount,
    'funded_total', public.payment_checkout_funded_total(p),
    'wallet_applied', COALESCE((p.metadata->>'wallet_applied')::numeric, 0),
    'wallet_released', COALESCE((p.metadata->>'wallet_checkout_released')::numeric, 0),
    'refund_amount', COALESCE((p.metadata->'refund'->>'amount_refunded')::numeric, 0),
    'refund_channel', p.metadata->'refund'->>'channel',
    'refund_reference', p.metadata->'refund'->>'reference',
    'wallet_refunded_total', COALESCE((p.metadata->>'wallet_refunded_total')::numeric, 0),
    'gateway_refunded', public.payment_gateway_refunded_total(p),
    'gateway_refund_unknown', public.payment_gateway_refund_unknown(p),
    'captured_at', p.captured_at,
    'created_at', p.created_at
  ) ORDER BY p.created_at), '[]'::jsonb)
  INTO v_payments
  FROM public.payments p
  WHERE p.booking_id = p_booking_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'direction', e.direction,
    'amount', e.amount,
    'reason', e.reason,
    'created_at', e.created_at,
    'admin_name', a.full_name,
    'note', CASE WHEN e.metadata ? 'category' THEN e.metadata->>'note' ELSE e.metadata->>'admin_reason' END
  ) ORDER BY e.created_at), '[]'::jsonb)
  INTO v_wallet
  FROM public.customer_wallet_entries e
  LEFT JOIN public.profiles a ON a.id = e.admin_id
  WHERE e.booking_id = p_booking_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'kind', l.kind,
    'direction', l.direction,
    'amount', l.amount,
    'created_at', l.created_at
  ) ORDER BY l.created_at), '[]'::jsonb)
  INTO v_ledger
  FROM public.provider_ledger_entries l
  WHERE l.booking_id = p_booking_id;

  RETURN jsonb_build_object(
    'booking_id', v_b.id,
    'status', v_b.status,
    'service_mode', v_b.service_mode,
    'price_total', v_b.price_total,
    'price_discount', v_b.price_discount,
    'carried_fees_amount', v_b.carried_fees_amount,
    'commission_amount', v_b.price_commission_amount,
    'commission_percent', v_b.price_commission_percent,
    'provider_net', v_b.price_provider_net,
    'payments', v_payments,
    'wallet_entries', v_wallet,
    'provider_ledger', v_ledger,
    'refund_terms', public.admin_booking_refund_terms(p_booking_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_booking_money_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_booking_money_summary(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- #551: a 'paymob' tab in the payments queue (the list the Paymob card opens)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_payment_queue(
  p_tab text,
  p_query text DEFAULT '',
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tab text := lower(btrim(COALESCE(p_tab, '')));
  v_query text := btrim(COALESCE(p_query, ''));
  v_code text;
  v_limit int := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
  v_unmapped bigint;
  v_unmapped_items jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF v_tab NOT IN ('refunds_due', 'receipts_ready', 'cash_to_confirm', 'needs_action', 'paymob') THEN
    RAISE EXCEPTION 'Invalid payment queue tab' USING ERRCODE = '23514';
  END IF;

  v_code := regexp_replace(upper(replace(v_query, '-', '')), '^#', '');

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
        r.has_cash_ledger,
        r.metadata
      ) AS situation
    FROM payment_rows r
  ),
  query_filtered AS (
    SELECT s.*
    FROM situated s
    WHERE v_query = ''
       OR COALESCE(s.customer_name, '') ILIKE '%' || v_query || '%'
       OR COALESCE(s.provider_name, '') ILIKE '%' || v_query || '%'
       OR s.booking_id::text ILIKE '%' || v_query || '%'
       OR (
         v_code <> ''
         AND upper(replace(s.booking_id::text, '-', '')) ILIKE v_code || '%'
       )
  ),
  filtered AS (
    SELECT s.*
    FROM query_filtered s
    WHERE (v_tab = 'refunds_due' AND s.situation = 'refundDue')
       OR (v_tab = 'receipts_ready' AND s.situation = 'review')
       OR (v_tab = 'cash_to_confirm' AND s.situation = 'cashUnconfirmed')
       OR (
         v_tab = 'needs_action'
         AND s.situation IN ('refundDue', 'review', 'cashUnconfirmed', 'paymobNeedsAction')
       )
       OR (v_tab = 'paymob' AND s.situation = 'paymobNeedsAction')
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

  -- Unmapped Paymob captures have no payment row: they belong to both lists.
  IF v_tab IN ('needs_action', 'paymob') THEN
    SELECT count(*) INTO v_unmapped
    FROM public.paymob_unmapped_captures u
    WHERE u.needs_admin_review AND u.reconciled_payment_id IS NULL;

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', NULL,
          'booking_id', NULL,
          'customer_id', NULL,
          'amount', round(u.amount_cents::numeric / 100.0, 2),
          'currency', COALESCE(u.currency, 'EGP'),
          'status', 'captured',
          'method', 'paymob',
          'payment_method_type', 'online',
          'payment_method_code', 'paymob',
          'created_at', u.created_at,
          'metadata', u.metadata || jsonb_build_object(
            'paymob_unmapped', true,
            'paymob_order_id', u.paymob_order_id,
            'paymob_transaction_id', u.paymob_transaction_id,
            'needs_admin_review', true
          ),
          'situation', 'paymobNeedsAction',
          'booking', NULL
        ) ORDER BY u.created_at DESC
      ),
      '[]'::jsonb
    )
    INTO v_unmapped_items
    FROM public.paymob_unmapped_captures u
    WHERE u.needs_admin_review AND u.reconciled_payment_id IS NULL;

    v_total := COALESCE(v_total, 0) + COALESCE(v_unmapped, 0);
    v_items := COALESCE(v_items, '[]'::jsonb) || COALESCE(v_unmapped_items, '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'tab', v_tab,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'items', v_items
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_payment_queue(text, text, int, int)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payment_queue(text, text, int, int)
  TO authenticated;

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
  v_paymob bigint;
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
    count(*) FILTER (WHERE situation IN ('refundDue', 'review', 'cashUnconfirmed', 'paymobNeedsAction')),
    count(*) FILTER (WHERE situation = 'paymobNeedsAction')
  INTO v_refunds, v_receipts, v_cash, v_needs_action, v_paymob
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
    'fee_payments', COALESCE(v_fee_payments, 0),
    'paymob', COALESCE(v_paymob, 0) + COALESCE(v_unmapped, 0)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_payment_queue_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payment_queue_counts() TO authenticated;

-- ---------------------------------------------------------------------------
-- #551 / #552: one condition per booking problem card
-- ---------------------------------------------------------------------------
-- The bookings behind a problem card, newest first. The home card counts this
-- list and the bookings page opens this same list, so the two always agree.
--   stuck_pending      still pending 30 minutes after its start time (the expiry job did not run)
--   stuck_active       accepted or under way, ended more than 6 hours ago, not closed
--   attendance_failed  online lesson of the last 24 hours: during the lesson the
--                      latest attendance check failed; after it, not enough
--                      attendance evidence to settle it
CREATE OR REPLACE FUNCTION public.admin_ops_problem_booking_ids(p_kind text)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required.' USING ERRCODE = '42501';
  END IF;

  IF p_kind = 'stuck_pending' THEN
    SELECT COALESCE(array_agg(b.id ORDER BY b.start_at DESC, b.id), '{}')
    INTO v_ids
    FROM public.bookings b
    WHERE b.status = 'pending' AND b.start_at < now() - interval '30 minutes';
  ELSIF p_kind = 'stuck_active' THEN
    SELECT COALESCE(array_agg(b.id ORDER BY b.start_at DESC, b.id), '{}')
    INTO v_ids
    FROM public.bookings b
    WHERE b.status::text IN ('confirmed', 'on_the_way', 'arrived', 'arrival_confirmed', 'in_progress', 'completion_requested')
      AND b.end_at < now() - interval '6 hours';
  ELSIF p_kind = 'attendance_failed' THEN
    SELECT COALESCE(array_agg(b.id ORDER BY b.start_at DESC, b.id), '{}')
    INTO v_ids
    FROM public.bookings b
    WHERE b.service_mode = 'online'
      AND b.status::text NOT IN ('pending', 'cancelled')
      AND b.start_at <= now()
      AND b.end_at >= now() - interval '24 hours'
      AND CASE
        WHEN now() <= b.end_at + interval '5 minutes' THEN (
          SELECT p.ok
          FROM public.session_presence_polls p
          WHERE p.booking_id = b.id
          ORDER BY p.polled_at DESC, p.id DESC
          LIMIT 1
        ) IS FALSE
        ELSE NOT public.online_session_presence_evidence_ok(b.id)
      END;
  ELSE
    RAISE EXCEPTION 'Invalid problem kind.' USING ERRCODE = '22023';
  END IF;

  RETURN v_ids;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ops_problem_booking_ids(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ops_problem_booking_ids(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_ops_problems()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paymob bigint;
  v_push bigint;
  v_errors bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required.' USING ERRCODE = '42501';
  END IF;

  -- The Paymob card opens the payments 'paymob' tab: count that list.
  v_paymob := COALESCE((public.admin_payment_queue('paymob', '', 1, 0)->>'total')::bigint, 0);

  -- The notification and error cards open the monitoring page, which shows the
  -- last 7 days: count with the same summary.
  SELECT s.failed_notifications, s.recent_errors
  INTO v_push, v_errors
  FROM public.admin_monitoring_summary(now() - interval '7 days') s;

  RETURN jsonb_build_object(
    'paymob_flags', v_paymob,
    'push_failures', COALESCE(v_push, 0),
    'app_errors', COALESCE(v_errors, 0),
    'stuck_pending', cardinality(public.admin_ops_problem_booking_ids('stuck_pending')),
    'stuck_active', cardinality(public.admin_ops_problem_booking_ids('stuck_active')),
    'attendance_failed', cardinality(public.admin_ops_problem_booking_ids('attendance_failed'))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ops_problems() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ops_problems() TO authenticated;

-- ---------------------------------------------------------------------------
-- #553: admin search reads Arabic digits
-- ---------------------------------------------------------------------------
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
  -- A phone typed on an Arabic keyboard or pasted from WhatsApp uses
  -- Arabic-Indic (٠-٩) or Persian (۰-۹) digits; stored phones use 0-9.
  v_query text := translate(
    btrim(COALESCE(p_query, '')),
    '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
    '01234567890123456789'
  );
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
  v_code := regexp_replace(upper(replace(v_query, '-', '')), '^#', '');

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
        OR strpos(lower(COALESCE(pr.email, '')), v_query_lower) > 0
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
    COALESCE(
      jsonb_agg(to_jsonb(page) ORDER BY full_name ASC NULLS LAST, created_at DESC, id),
      '[]'::jsonb
    )
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
        OR strpos(lower(COALESCE(pr.email, '')), v_query_lower) > 0
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

-- ---------------------------------------------------------------------------
-- #550 follow-up: automatic wallet refunds use the same cap
-- ---------------------------------------------------------------------------
-- Provider cancel, customer cancel (online) and the online attendance
-- settlement refund what Famy still holds after any card refund
-- (payment_held_after_card_refund), and refund nothing automatically while a
-- card refund of unknown amount is open. The refund webhook keeps the unknown
-- marker until Paymob sends the total. Re-derived from
-- 20261126210000_money_followups_539 and 20261125160000_wallet_internal_rpc_lockdown.

CREATE OR REPLACE FUNCTION public.paymob_apply_refund_webhook(
  p_paymob_transaction_id bigint,
  p_order_id bigint,
  p_amount_cents bigint,
  p_is_voided boolean,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_refund_kind text DEFAULT NULL,
  p_cumulative_amount_cents bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_event public.paymob_webhook_events%ROWTYPE;
  v_status public.payment_status;
  v_reuse_capture boolean := false;
  v_meta jsonb;
  v_refunds jsonb;
  v_total_cents bigint;
  v_tx_sum bigint;
  v_cumulative bigint;
  v_prev_cumulative bigint;
  v_amount_unknown boolean := false;
  v_clear_unknown boolean := false;
  v_tx_key text := p_paymob_transaction_id::text;
  v_kind text := COALESCE(p_refund_kind, 'legacy');
BEGIN
  IF p_paymob_transaction_id IS NULL OR p_paymob_transaction_id <= 0
     OR p_order_id IS NULL OR p_order_id <= 0 THEN
    RAISE EXCEPTION 'Invalid Paymob refund.' USING ERRCODE = '22023';
  END IF;
  IF v_kind NOT IN ('legacy', 'transaction', 'cumulative') THEN
    RAISE EXCEPTION 'Invalid Paymob refund kind.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(p_paymob_transaction_id);

  SELECT * INTO v_event
  FROM public.paymob_webhook_events
  WHERE paymob_transaction_id = p_paymob_transaction_id;
  IF FOUND THEN
    IF v_event.outcome = 'refunded' AND v_kind <> 'cumulative' THEN
      RETURN jsonb_build_object('duplicate', true, 'payment_id', v_event.payment_id);
    END IF;
    IF v_event.outcome IN ('captured', 'refunded') THEN
      v_reuse_capture := v_event.outcome = 'captured';
    ELSIF v_event.outcome <> 'pending' THEN
      RETURN jsonb_build_object('duplicate', true, 'payment_id', v_event.payment_id);
    END IF;
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE paymob_order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public.paymob_record_unmapped_capture(
      p_paymob_transaction_id,
      p_order_id,
      NULL,
      NULL,
      p_amount_cents,
      NULL,
      COALESCE(p_metadata, '{}'::jsonb)
        || jsonb_build_object(
          'gateway_refund_voided', COALESCE(p_is_voided, false),
          'gateway_refund_kind', v_kind
        )
    );
  END IF;

  v_refunds := COALESCE(v_payment.metadata->'gateway_refunds', '{}'::jsonb);
  -- A refund recorded before #537 kept only one amount: keep it in the sum.
  IF v_refunds = '{}'::jsonb
     AND NULLIF(v_payment.metadata->>'gateway_refund_amount_cents', '') IS NOT NULL THEN
    v_refunds := jsonb_build_object(
      'legacy',
      (v_payment.metadata->>'gateway_refund_amount_cents')::bigint
    );
  END IF;
  v_prev_cumulative := NULLIF(v_refunds->>'cumulative', '')::bigint;

  IF v_kind = 'cumulative' THEN
    v_cumulative := CASE
      WHEN p_cumulative_amount_cents IS NOT NULL AND p_cumulative_amount_cents > 0
        THEN p_cumulative_amount_cents
      WHEN COALESCE(p_is_voided, false) THEN p_amount_cents
      ELSE NULL
    END;
    IF v_cumulative IS NULL THEN
      v_amount_unknown := true;
      -- Same signal again with no amount: nothing new to record.
      IF COALESCE(v_payment.metadata->>'gateway_refund_recorded_at', '') <> '' THEN
        RETURN jsonb_build_object('duplicate', true, 'payment_id', v_payment.id);
      END IF;
    ELSE
      IF v_prev_cumulative IS NOT NULL AND v_cumulative <= v_prev_cumulative THEN
        RETURN jsonb_build_object('duplicate', true, 'payment_id', v_payment.id);
      END IF;
      v_refunds := v_refunds || jsonb_build_object('cumulative', v_cumulative);
      -- Paymob sent the total refunded so far: it covers any earlier refund
      -- whose amount was missing.
      v_clear_unknown := true;
    END IF;
  ELSE
    IF v_refunds ? v_tx_key
       OR (
         v_kind = 'legacy'
         AND v_reuse_capture
         AND v_payment.metadata->'gateway_refunds' IS NULL
         AND COALESCE(v_payment.metadata->>'gateway_refund_recorded_at', '') <> ''
       ) THEN
      RETURN jsonb_build_object('duplicate', true, 'payment_id', v_payment.id);
    END IF;
    v_refunds := v_refunds || jsonb_build_object(v_tx_key, COALESCE(p_amount_cents, 0));
  END IF;

  SELECT COALESCE(sum((value)::text::bigint), 0) INTO v_tx_sum
  FROM jsonb_each(v_refunds)
  WHERE key <> 'cumulative';
  v_total_cents := GREATEST(v_tx_sum, COALESCE(NULLIF(v_refunds->>'cumulative', '')::bigint, 0));

  v_status := v_payment.status;
  v_meta := COALESCE(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'gateway_refunds', v_refunds,
      'gateway_refund_recorded_at', now(),
      'gateway_refund_amount_cents', v_total_cents,
      'gateway_refund_last_amount_cents', CASE WHEN v_kind = 'cumulative' THEN v_cumulative ELSE p_amount_cents END,
      'gateway_refund_last_transaction_id', p_paymob_transaction_id,
      'gateway_refund_last_kind', v_kind,
      'gateway_refund_amount_unknown', v_amount_unknown,
      'gateway_refund_voided', COALESCE(p_is_voided, false),
      'needs_admin_review', true
    );
  -- #550: a refund with no amount keeps blocking wallet refunds until Paymob
  -- sends the total, even when a refund transaction with its own amount comes
  -- in between.
  IF v_amount_unknown THEN
    v_meta := v_meta || jsonb_build_object(
      'gateway_refund_unknown_since',
      COALESCE(v_payment.metadata->'gateway_refund_unknown_since', to_jsonb(now()))
    );
  END IF;

  UPDATE public.payments
  SET metadata = (
    COALESCE(metadata, '{}'::jsonb)
    - 'paymob_resolved_at'
    - 'paymob_resolved_by'
    - 'paymob_resolve_note'
    - CASE WHEN v_clear_unknown THEN 'gateway_refund_unknown_since' ELSE '' END
  ) || v_meta
  WHERE id = v_payment.id;

  -- A refund transaction of its own is recorded once by its id. A callback on the
  -- original transaction keeps that transaction's capture event.
  IF v_kind <> 'cumulative' AND NOT v_reuse_capture THEN
    INSERT INTO public.paymob_webhook_events (paymob_transaction_id, payment_id, outcome)
    VALUES (p_paymob_transaction_id, v_payment.id, 'refunded')
    ON CONFLICT (paymob_transaction_id) DO UPDATE SET
      payment_id = EXCLUDED.payment_id,
      outcome = EXCLUDED.outcome,
      processed_at = now();
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'payment_id', v_payment.id,
    'status', v_status,
    'outcome', 'refunded',
    'refund_kind', v_kind,
    'capture_preserved', v_reuse_capture,
    'refunded_total_cents', v_total_cents
  );
END;
$$;
REVOKE ALL ON FUNCTION public.paymob_apply_refund_webhook(bigint, bigint, bigint, boolean, jsonb, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paymob_apply_refund_webhook(bigint, bigint, bigint, boolean, jsonb, text, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.credit_customer_wallet_provider_cancelled(p_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_pay public.payments%ROWTYPE;
  v_entry_id uuid;
  v_amount numeric;
  v_idempotency_key text;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.lock_customer_debts(v_booking.customer_id);
  PERFORM public.lock_customer_wallet(v_booking.customer_id);

  IF NOT public.booking_money_held(p_booking_id) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_pay
  FROM public.payments pay
  WHERE pay.booking_id = p_booking_id
    AND pay.status = 'captured'
    AND COALESCE(pay.payment_method_type, '') IN ('online', 'manual_transfer')
  ORDER BY pay.captured_at DESC NULLS LAST, pay.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- #550: Paymob reported a refund on this card without its amount. Nothing
  -- goes to the wallet automatically; the payment is already flagged for the
  -- admin, who refunds from the booking's money card once it is checked.
  IF public.payment_gateway_refund_unknown(v_pay) THEN
    RETURN NULL;
  END IF;

  -- #519: the checkout total minus any wallet part that was already released
  -- (card declined, then captured late), never more than what Famy holds.
  -- #550: minus what Paymob already returned to the card.
  v_amount := public.payment_held_after_card_refund(v_pay);
  v_idempotency_key := 'provider_cancelled:' || p_booking_id::text;

  SELECT e.id INTO v_entry_id
  FROM public.customer_wallet_entries e
  WHERE e.idempotency_key = v_idempotency_key;

  IF v_entry_id IS NOT NULL THEN
    RETURN v_entry_id;
  END IF;

  IF COALESCE(v_amount, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  v_entry_id := public.customer_wallet_insert_entry(
    v_booking.customer_id,
    'credit',
    v_amount,
    'provider_cancelled',
    p_booking_id,
    v_pay.id,
    NULL,
    v_idempotency_key,
    jsonb_build_object('payment_method_type', v_pay.payment_method_type)
  );

  IF v_entry_id IS NOT NULL THEN
    PERFORM set_config('app.wallet_checkout_adjust', 'on', true);
    PERFORM set_config('app.ledger_internal_capture', 'on', true);
    UPDATE public.payments
    SET status = 'refunded',
        reviewed_at = COALESCE(reviewed_at, now()),
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'refund_settled_via_wallet', true,
          'wallet_refund_settled', true,
          'refund_settled_at', now(),
          'refund', jsonb_build_object(
            'channel', 'customer_wallet',
            'amount_refunded', v_amount,
            'wallet_entry_id', v_entry_id,
            'recorded_at', now()
          )
        )
    WHERE id = v_pay.id
      AND status = 'captured';
    PERFORM set_config('app.ledger_internal_capture', 'off', true);
    PERFORM set_config('app.wallet_checkout_adjust', 'off', true);

    UPDATE public.providers
    SET paid_booking_cancellations = paid_booking_cancellations + 1
    WHERE id = v_booking.provider_id;
  END IF;

  -- #539: the refund included the fees carried from earlier bookings, so they
  -- are open again for the customer.
  PERFORM public.release_unheld_carried_fees(p_booking_id);

  RETURN v_entry_id;
END;
$$;
REVOKE ALL ON FUNCTION public.credit_customer_wallet_provider_cancelled(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_customer_wallet_provider_cancelled(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.credit_customer_wallet_customer_cancelled(p_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_pay public.payments%ROWTYPE;
  v_fee numeric;
  v_credit numeric;
  v_funded numeric;
  v_carried numeric;
  v_method text;
  v_entry_id uuid;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR COALESCE(v_booking.service_mode, 'in_person') <> 'online' THEN
    RETURN NULL;
  END IF;

  -- Defense in depth (#443): only a booking the customer actually cancelled can be
  -- refunded to the wallet. cancel_booking() sets the status and records the
  -- cancellation before calling this function.
  IF v_booking.status::text <> 'cancelled' OR COALESCE((
    SELECT c.cancelled_by_role
    FROM public.booking_cancellations c
    WHERE c.booking_id = p_booking_id
    ORDER BY c.cancelled_at DESC
    LIMIT 1
  ), '') <> 'customer' THEN
    RETURN NULL;
  END IF;

  PERFORM public.lock_customer_debts(v_booking.customer_id);
  PERFORM public.lock_customer_wallet(v_booking.customer_id);

  IF NOT public.booking_money_held(p_booking_id) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_pay
  FROM public.payments
  WHERE booking_id = p_booking_id
    AND status = 'captured'
    AND COALESCE(payment_method_type, '') IN ('online', 'manual_transfer')
  ORDER BY captured_at DESC NULLS LAST, created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- #550: a card refund of unknown amount: the admin refunds once it is checked.
  IF public.payment_gateway_refund_unknown(v_pay) THEN
    RETURN NULL;
  END IF;

  v_method := COALESCE(v_pay.payment_method_code, v_pay.payment_method_type);
  -- #550: what Famy still holds after any refund Paymob made to the card.
  v_funded := public.payment_held_after_card_refund(v_pay);
  v_carried := LEAST(public.settle_carried_fees(v_booking.id, v_method, NULL), v_funded);

  v_fee := LEAST(public.booking_cancellation_fee(p_booking_id), v_funded - v_carried);
  IF EXISTS (SELECT 1 FROM public.customer_debts d WHERE d.booking_id = p_booking_id AND d.status = 'paid') THEN
    v_fee := 0;
  ELSIF EXISTS (
    SELECT 1 FROM public.customer_debts d
    JOIN public.bookings cb ON cb.id = d.carried_booking_id
    WHERE d.booking_id = p_booking_id AND d.status = 'open'
      AND cb.status::text NOT IN ('cancelled', 'no_show', 'completed')
  ) THEN
    v_fee := 0;
  ELSE
    UPDATE public.customer_debts
    SET status = 'waived', resolved_at = now(), resolved_by = NULL,
        resolution_note = 'Deducted from the wallet cancellation refund'
    WHERE booking_id = p_booking_id AND status = 'open';
  END IF;

  v_credit := GREATEST(v_funded - v_fee - v_carried, 0);

  IF v_credit > 0 THEN
    v_entry_id := public.customer_wallet_insert_entry(
      v_booking.customer_id,
      'credit',
      v_credit,
      'customer_cancelled_refund',
      p_booking_id,
      v_pay.id,
      NULL,
      'customer_cancelled:' || p_booking_id::text,
      jsonb_build_object(
        'cancellation_fee', v_fee,
        'funded_total', v_funded,
        'carried_fees', v_carried
      )
    );

    IF v_entry_id IS NOT NULL THEN
      PERFORM set_config('app.wallet_checkout_adjust', 'on', true);
      UPDATE public.payments
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'refund_settled_via_wallet', true,
        'refund_settled_at', now(),
        'wallet_refund_portion', v_credit,
        'cancellation_fee', v_fee,
        'carried_fees_settled', v_carried
      )
      WHERE id = v_pay.id;
      PERFORM set_config('app.wallet_checkout_adjust', 'off', true);
    END IF;
  END IF;

  IF v_fee > 0 THEN
    PERFORM public.ledger_insert_entry(
      v_booking.provider_id,
      v_booking.id,
      'cancellation_fee_provider_share',
      'credit',
      v_fee,
      v_method,
      NULL,
      NULL,
      NULL
    );
  END IF;

  RETURN v_entry_id;
END;
$$;
REVOKE ALL ON FUNCTION public.credit_customer_wallet_customer_cancelled(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_customer_wallet_customer_cancelled(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_online_session_absence(p_booking_id uuid, p_outcome text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b public.bookings%ROWTYPE;
  v_pay public.payments%ROWTYPE;
  v_held boolean;
  v_has_pay boolean := false;
  v_card_unknown boolean := false;
  v_funded numeric := 0;
  v_fee numeric := 0;
  v_carried numeric := 0;
  v_credit numeric := 0;
  v_method text;
  v_entry_id uuid;
  v_key text;
  v_provider_user uuid;
  v_link text;
  v_credit_txt text;
  v_fee_txt text;
  v_c_title_en text;
  v_c_title_ar text;
  v_c_body_en text;
  v_c_body_ar text;
  v_p_title_en text;
  v_p_title_ar text;
  v_p_body_en text;
  v_p_body_ar text;
BEGIN
  IF p_outcome NOT IN ('provider_absent', 'customer_absent', 'both_absent') THEN
    RETURN;
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND
     OR v_b.status IS DISTINCT FROM 'confirmed'
     OR COALESCE(v_b.service_mode, 'in_person') <> 'online' THEN
    RETURN;
  END IF;

  PERFORM public.lock_customer_debts(v_b.customer_id);
  PERFORM public.lock_customer_wallet(v_b.customer_id);

  v_held := public.booking_money_held(p_booking_id);

  -- Close the booking first. tg_booking_notify stays quiet for this change;
  -- the precise notifications are sent below.
  PERFORM set_config('app.online_absence_settle', 'on', true);
  PERFORM set_config('app.audit_reason', 'online_session_' || p_outcome, true);
  IF p_outcome = 'both_absent' THEN
    UPDATE public.bookings
    SET status = 'cancelled',
        cancellation_reason = 'online_both_absent',
        cancelled_at = now(),
        cancelled_by = NULL,
        status_changed_at = now(),
        status_changed_by = NULL
    WHERE id = p_booking_id AND status = 'confirmed';
  ELSE
    UPDATE public.bookings
    SET status = 'no_show',
        no_show_party = CASE WHEN p_outcome = 'provider_absent' THEN 'provider' ELSE 'customer' END,
        no_show_reason = 'Automatic online attendance check: ' || p_outcome,
        status_changed_at = now(),
        status_changed_by = NULL
    WHERE id = p_booking_id AND status = 'confirmed';
  END IF;
  PERFORM set_config('app.online_absence_settle', 'off', true);

  IF v_held THEN
    SELECT * INTO v_pay
    FROM public.payments pay
    WHERE pay.booking_id = p_booking_id
      AND pay.status = 'captured'
      AND COALESCE(pay.payment_method_type, '') IN ('online', 'manual_transfer')
    ORDER BY pay.captured_at DESC NULLS LAST, pay.created_at DESC
    LIMIT 1
    FOR UPDATE;
    v_has_pay := FOUND;
    -- #550: Paymob reported a refund on this card without its amount. The
    -- lesson is closed, but no money moves automatically: the payment is
    -- already flagged for the admin.
    IF v_has_pay AND public.payment_gateway_refund_unknown(v_pay) THEN
      v_card_unknown := true;
      v_has_pay := false;
    END IF;
  ELSE
    -- Nothing was paid: only a wallet part reserved for the checkout comes back.
    PERFORM public.restore_customer_wallet_checkout_debit(p_booking_id);
  END IF;

  IF v_has_pay THEN
    v_method := COALESCE(v_pay.payment_method_code, v_pay.payment_method_type);
    -- #550: minus what Paymob already returned to the card.
    v_funded := public.payment_held_after_card_refund(v_pay);

    IF p_outcome = 'customer_absent' THEN
      v_carried := LEAST(public.settle_carried_fees(p_booking_id, v_method, NULL), v_funded);
      v_fee := LEAST(
        public.cancellation_fee_for_total(v_b.price_total, 'online'),
        GREATEST(v_funded - v_carried, 0)
      );
    END IF;

    v_credit := GREATEST(v_funded - v_fee - v_carried, 0);
    v_key := 'online_no_show:' || p_booking_id::text;

    IF v_credit > 0 THEN
      v_entry_id := public.customer_wallet_insert_entry(
        v_b.customer_id,
        'credit',
        v_credit,
        'online_no_show_refund',
        p_booking_id,
        v_pay.id,
        NULL,
        v_key,
        jsonb_build_object(
          'outcome', p_outcome,
          'funded_total', v_funded,
          'no_show_fee', v_fee,
          'carried_fees', v_carried
        )
      );
    END IF;

    PERFORM set_config('app.wallet_checkout_adjust', 'on', true);
    PERFORM set_config('app.ledger_internal_capture', 'on', true);
    UPDATE public.payments
    SET status = CASE
          WHEN p_outcome = 'customer_absent' THEN status
          ELSE 'refunded'::public.payment_status
        END,
        reviewed_at = COALESCE(reviewed_at, now()),
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'refund_settled_via_wallet', true,
          'wallet_refund_settled', true,
          'refund_settled_at', now(),
          'wallet_refund_portion', v_credit,
          'cancellation_fee', v_fee,
          'carried_fees_settled', v_carried,
          'online_absence_outcome', p_outcome,
          'refund', jsonb_build_object(
            'channel', 'customer_wallet',
            'amount_refunded', v_credit,
            'wallet_entry_id', v_entry_id,
            'reason', 'online_session_' || p_outcome,
            'recorded_at', now()
          )
        )
    WHERE id = v_pay.id;
    PERFORM set_config('app.ledger_internal_capture', 'off', true);
    PERFORM set_config('app.wallet_checkout_adjust', 'off', true);

    IF v_fee > 0 THEN
      PERFORM public.ledger_insert_entry(
        v_b.provider_id,
        p_booking_id,
        'cancellation_fee_provider_share',
        'credit',
        v_fee,
        v_method,
        NULL,
        NULL,
        NULL
      );
    END IF;

    IF p_outcome = 'provider_absent' THEN
      UPDATE public.providers
      SET paid_booking_cancellations = paid_booking_cancellations + 1
      WHERE id = v_b.provider_id;
    END IF;
  END IF;

  -- #539: fees carried from earlier bookings come back to the customer once the
  -- money for them was refunded (provider or both absent).
  PERFORM public.release_unheld_carried_fees(p_booking_id);

  -- Notifications (Egyptian Arabic, plain; amounts in EGP).
  SELECT profile_id INTO v_provider_user FROM public.providers WHERE id = v_b.provider_id;
  v_link := '/online/lessons/' || p_booking_id::text;
  v_credit_txt := trim_scale(round(v_credit, 2))::text;
  v_fee_txt := trim_scale(round(v_fee, 2))::text;

  IF p_outcome = 'provider_absent' THEN
    v_c_title_en := 'Your tutor did not attend';
    v_c_title_ar := 'المدرس ماحضرش الحصة';
    v_c_body_en := CASE WHEN v_credit > 0
      THEN 'We added ' || v_credit_txt || ' EGP back to your Famy wallet. The Famy team will review what happened.'
      ELSE 'The lesson was closed and the Famy team will review what happened.' END;
    v_c_body_ar := CASE WHEN v_credit > 0
      THEN 'رجعنالك ' || v_credit_txt || ' ج.م في محفظة فامي، وفريق فامي هيراجع اللي حصل'
      ELSE 'الحصة اتقفلت، وفريق فامي هيراجع اللي حصل' END;
    v_p_title_en := 'You missed a lesson';
    v_p_title_ar := 'ماحضرتش الحصة';
    v_p_body_en := 'Our attendance check shows you did not join this lesson. The student was refunded and the Famy team will review it.';
    v_p_body_ar := 'السيستم سجل إنك ماحضرتش الحصة دي، فلوس الحصة رجعت للطالب وفريق فامي هيراجع اللي حصل';
  ELSIF p_outcome = 'both_absent' THEN
    v_c_title_en := 'The lesson did not take place';
    v_c_title_ar := 'الحصة ماتمتش';
    v_c_body_en := CASE WHEN v_credit > 0
      THEN 'Neither you nor the tutor joined. We added ' || v_credit_txt || ' EGP back to your Famy wallet.'
      ELSE 'Neither you nor the tutor joined, so the lesson was cancelled.' END;
    v_c_body_ar := CASE WHEN v_credit > 0
      THEN 'إنت والمدرس ماحضرتوش الحصة، فرجعنالك ' || v_credit_txt || ' ج.م في محفظة فامي'
      ELSE 'إنت والمدرس ماحضرتوش الحصة، فالحصة اتلغت' END;
    v_p_title_en := 'The lesson did not take place';
    v_p_title_ar := 'الحصة ماتمتش';
    v_p_body_en := 'Neither you nor the student joined, so the lesson was cancelled. The Famy team will review it.';
    v_p_body_ar := 'إنت والطالب ماحضرتوش الحصة، فالحصة اتلغت وفريق فامي هيراجع اللي حصل';
  ELSE
    v_c_title_en := 'You missed your lesson';
    v_c_title_ar := 'ماحضرتش الحصة';
    v_c_body_en := CASE
      WHEN v_fee > 0 AND v_credit > 0
        THEN 'A no-show fee of ' || v_fee_txt || ' EGP went to the tutor, and we added ' || v_credit_txt || ' EGP back to your Famy wallet.'
      WHEN v_fee > 0
        THEN 'A no-show fee of ' || v_fee_txt || ' EGP went to the tutor.'
      WHEN v_credit > 0
        THEN 'We added ' || v_credit_txt || ' EGP back to your Famy wallet.'
      ELSE 'The lesson was closed because you did not join.' END;
    v_c_body_ar := CASE
      WHEN v_fee > 0 AND v_credit > 0
        THEN 'اتخصم ' || v_fee_txt || ' ج.م رسوم عدم حضور للمدرس، ورجعنالك ' || v_credit_txt || ' ج.م في محفظة فامي'
      WHEN v_fee > 0
        THEN 'اتخصم ' || v_fee_txt || ' ج.م رسوم عدم حضور للمدرس'
      WHEN v_credit > 0
        THEN 'رجعنالك ' || v_credit_txt || ' ج.م في محفظة فامي'
      ELSE 'الحصة اتقفلت عشان ماحضرتش' END;
    v_p_title_en := 'The student did not attend';
    v_p_title_ar := 'الطالب ماحضرش الحصة';
    v_p_body_en := CASE WHEN v_fee > 0
      THEN 'You will receive the no-show fee of ' || v_fee_txt || ' EGP. The Famy team will review it.'
      ELSE 'The lesson was closed and the Famy team will review it.' END;
    v_p_body_ar := CASE WHEN v_fee > 0
      THEN 'هتاخد ' || v_fee_txt || ' ج.م رسوم عدم الحضور، وفريق فامي هيراجع اللي حصل'
      ELSE 'الحصة اتقفلت وفريق فامي هيراجع اللي حصل' END;
  END IF;

  INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
  VALUES (
    v_b.customer_id, 'online_attendance_' || p_outcome, 'booking',
    v_c_title_en, v_c_body_en, v_c_title_en, v_c_title_ar, v_c_body_en, v_c_body_ar,
    jsonb_build_object('booking_id', p_booking_id, 'outcome', p_outcome, 'wallet_credit', v_credit, 'fee', v_fee),
    v_link, p_booking_id
  );

  IF v_provider_user IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      v_provider_user, 'online_attendance_' || p_outcome, 'booking',
      v_p_title_en, v_p_body_en, v_p_title_en, v_p_title_ar, v_p_body_en, v_p_body_ar,
      jsonb_build_object('booking_id', p_booking_id, 'outcome', p_outcome, 'fee', v_fee),
      v_link, p_booking_id
    );
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_online_session_absence(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_online_session_absence(uuid, text) TO service_role;
