-- Audit batch A (money and database): #516 #517 #518 #519 #522 #523 #524 #525 #526 #527
--
-- Every function below is re-derived from its latest definition on main:
--   cancel_booking ............................ 20261123230200_codex_p1_round2
--   expire_pending_bookings ................... 20261001140000_expire_pending_bookings
--   customer_release_booking_checkout_wallet .. 20261123230600_customer_wallet_release_guard
--   credit_customer_wallet_provider_cancelled . 20261125133000_launch_gaps_notifications
--   resolve_online_session_bookings ........... 20261125140100_audit_money_batch_high
--   admin_payment_situation ................... 20261125140300_audit_security_money_batch
--   paymob_apply_refund_webhook ............... 20261125140300_audit_security_money_batch
--   admin_resolve_paymob_flag ................. 20261125140300_audit_security_money_batch
--   admin_adjust_customer_wallet .............. 20261125140300_audit_security_money_batch
--   ledger_apply_booking_shares ............... 20261123210000_codex_second_audit_online_lessons
--   report_ugc ................................ 20261125140200_ugc_reports_chat_blocks
--   parent_student_lessons .................... 20261125130000_student_parent_links
--   tg_booking_notify ......................... 20261126120000_online_web_po_test_fixes
-- The #429 lockdown is kept: internal helpers stay executable by service_role only.

-- ---------------------------------------------------------------------------
-- #525 + #517: wallet entry reasons (adds the automatic online no-show refund)
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_wallet_entries
  DROP CONSTRAINT IF EXISTS customer_wallet_entries_reason_check;
ALTER TABLE public.customer_wallet_entries
  ADD CONSTRAINT customer_wallet_entries_reason_check CHECK (reason IN (
    'provider_cancelled',
    'customer_cancelled_refund',
    'admin_credit',
    'admin_debit',
    'checkout_spend',
    'checkout_release',
    'paymob_superseded_capture',
    'forfeited_on_deletion',
    'online_no_show_refund'
  ));

-- ---------------------------------------------------------------------------
-- #516: give back the wallet part of an unpaid checkout whoever cancels
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id uuid, p_reason_id uuid, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_booking RECORD;
  v_reason RECORD;
  v_role text;
  v_fee numeric := 0;
  v_cancellation_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = '42501';
  END IF;

  IF v_booking.customer_id = v_uid THEN
    v_role := 'customer';
  ELSIF EXISTS (SELECT 1 FROM public.providers p WHERE p.id = v_booking.provider_id AND p.profile_id = v_uid) THEN
    v_role := 'provider';
  ELSIF public.has_role(v_uid, 'admin') THEN
    v_role := 'admin';
  ELSE
    RAISE EXCEPTION 'You are not authorized to cancel this booking.' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    v_booking.status IN ('pending', 'confirmed')
    OR (v_role = 'customer' AND v_booking.status IN ('on_the_way', 'arrived'))
  ) THEN
    RAISE EXCEPTION 'This booking has already progressed and can no longer be cancelled this way. Please use support, no-show, or dispute options instead.'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_reason FROM public.cancellation_reasons WHERE id = p_reason_id;
  IF NOT FOUND OR NOT v_reason.is_active THEN
    RAISE EXCEPTION 'Selected cancellation reason is not available.' USING ERRCODE = '23514';
  END IF;
  IF v_reason.actor_type NOT IN (v_role, 'any') THEN
    RAISE EXCEPTION 'Selected cancellation reason is not available for your role.' USING ERRCODE = '23514';
  END IF;
  IF NOT (v_booking.status = ANY(v_reason.applicable_statuses)) THEN
    RAISE EXCEPTION 'Selected cancellation reason does not apply to this booking''s current status.' USING ERRCODE = '23514';
  END IF;
  IF v_reason.requires_note AND (p_note IS NULL OR btrim(p_note) = '') THEN
    RAISE EXCEPTION 'A note is required for this cancellation reason.' USING ERRCODE = '23514';
  END IF;

  IF v_role = 'customer' THEN
    v_fee := public.booking_cancellation_fee(p_booking_id);
  END IF;

  PERFORM set_config('app.cancellation_in_progress', 'on', true);
  UPDATE public.bookings SET status = 'cancelled' WHERE id = p_booking_id;

  INSERT INTO public.booking_cancellations (
    booking_id, previous_status, cancelled_by_user_id, cancelled_by_role,
    reason_id, reason_code, reason_name_en, reason_name_ar, note, cancellation_fee
  ) VALUES (
    p_booking_id, v_booking.status, v_uid, v_role,
    v_reason.id, v_reason.code, v_reason.name_en, v_reason.name_ar, NULLIF(btrim(p_note), ''), v_fee
  ) RETURNING id INTO v_cancellation_id;

  IF NOT public.booking_money_held(p_booking_id) THEN
    -- #516: nothing is held yet, so any wallet amount reserved for this
    -- booking's checkout goes back to the customer, whoever cancels.
    PERFORM public.restore_customer_wallet_checkout_debit(p_booking_id);
  ELSIF v_role = 'provider' THEN
    PERFORM public.credit_customer_wallet_provider_cancelled(p_booking_id);
  ELSIF v_role = 'customer' AND COALESCE(v_booking.service_mode, 'in_person') = 'online' THEN
    PERFORM public.credit_customer_wallet_customer_cancelled(p_booking_id);
  END IF;

  RETURN v_cancellation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_booking(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.expire_pending_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ttl numeric;
  v_min_before numeric;
  v_row RECORD;
  v_provider_user uuid;
  v_count integer := 0;
  v_reason RECORD;
BEGIN
  SELECT s.pending_ttl_hours, s.min_hours_before_start
    INTO v_ttl, v_min_before
  FROM public.booking_expiry_settings() s;

  SELECT * INTO v_reason
  FROM public.cancellation_reasons
  WHERE code = 'provider_no_response';

  PERFORM set_config('app.cancellation_in_progress', 'on', true);
  PERFORM set_config('app.pending_expiry_in_progress', 'on', true);
  PERFORM set_config('app.audit_reason', 'provider_no_response', true);

  FOR v_row IN
    SELECT b.id, b.customer_id, b.provider_id, b.status, b.created_at, b.start_at
    FROM public.bookings b
    WHERE b.status = 'pending'
      AND LEAST(
        b.created_at + (v_ttl * interval '1 hour'),
        b.start_at - (v_min_before * interval '1 hour')
      ) <= now()
    ORDER BY b.created_at
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    UPDATE public.bookings
    SET
      status = 'cancelled',
      cancellation_reason = 'provider_no_response',
      cancelled_at = now(),
      cancelled_by = NULL
    WHERE id = v_row.id
      AND status = 'pending';

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT profile_id INTO v_provider_user
    FROM public.providers
    WHERE id = v_row.provider_id;

    INSERT INTO public.notifications (
      user_id, type, category, title, body,
      title_en, title_ar, body_en, body_ar,
      payload, deep_link, booking_id
    ) VALUES (
      v_row.customer_id, 'booking_expired', 'booking',
      'Request expired',
      COALESCE(v_reason.name_en, 'The provider did not respond in time'),
      'Request expired',
      'انتهت صلاحية الطلب',
      COALESCE(v_reason.name_en, 'The provider did not respond in time'),
      COALESCE(v_reason.name_ar, 'مقدم الخدمة لم يرد في الوقت المحدد'),
      jsonb_build_object('booking_id', v_row.id, 'reason_code', 'provider_no_response'),
      '/booking/' || v_row.id,
      v_row.id
    );

    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (
        user_id, type, category, title, body,
        title_en, title_ar, body_en, body_ar,
        payload, deep_link, booking_id
      ) VALUES (
        v_provider_user, 'booking_expired', 'booking',
        'Booking request expired',
        'You did not respond in time. The request was cancelled.',
        'Booking request expired',
        'انتهت صلاحية طلب الحجز',
        'You did not respond in time. The request was cancelled.',
        'لم ترد في الوقت المحدد. تم إلغاء الطلب.',
        jsonb_build_object('booking_id', v_row.id, 'reason_code', 'provider_no_response'),
        '/pro/booking/' || v_row.id,
        v_row.id
      );
    END IF;

    INSERT INTO public.audit_logs (
      actor_id, actor_role, action, entity, entity_id, booking_id, reason,
      old_values, new_values
    ) VALUES (
      NULL, 'system', 'expire_pending', 'bookings', v_row.id, v_row.id, 'provider_no_response',
      jsonb_build_object('status', v_row.status),
      jsonb_build_object('status', 'cancelled', 'cancellation_reason', 'provider_no_response')
    );

    -- Never capture. Never refund. Flag an already-captured Paymob row.
    UPDATE public.payments
    SET
      needs_admin_review = true,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'admin_review_reason', 'expired_pending_captured',
        'admin_review_at', now()
      )
    WHERE booking_id = v_row.id
      AND status = 'captured'
      AND needs_admin_review IS DISTINCT FROM true;

    -- #516: a wallet amount reserved at checkout for this request comes back.
    IF NOT public.booking_money_held(v_row.id) THEN
      PERFORM public.restore_customer_wallet_checkout_debit(v_row.id);
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_pending_bookings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_pending_bookings() TO service_role;

CREATE OR REPLACE FUNCTION public.customer_release_booking_checkout_wallet(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_customer_id uuid;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  SELECT customer_id, status::text INTO v_customer_id, v_status
  FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_customer_id <> v_uid AND NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
  END IF;

  -- #516: a closed booking can never be paid any more, so a wallet amount
  -- still reserved for its unpaid checkout is released even while the card
  -- payment row is pending. Money already held is refunded by the cancel paths.
  IF v_status IN ('cancelled', 'no_show') THEN
    IF NOT public.booking_money_held(p_booking_id) THEN
      PERFORM public.restore_customer_wallet_checkout_debit(p_booking_id);
    END IF;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.booking_id = p_booking_id
      AND p.status IN ('pending', 'captured', 'partially_refunded', 'pending_review')
  ) THEN
    RAISE EXCEPTION 'Wallet cannot be released while a payment is still active for this booking.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.booking_id = p_booking_id
      AND p.status = 'rejected'
      AND COALESCE((p.metadata->>'wallet_applied')::numeric, 0) > 0
      AND COALESCE((p.metadata->>'wallet_checkout_released')::numeric, 0) <= 0.009
  ) THEN
    RETURN;
  END IF;

  PERFORM public.restore_customer_wallet_checkout_debit(p_booking_id);
END;
$$;

REVOKE ALL ON FUNCTION public.customer_release_booking_checkout_wallet(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_release_booking_checkout_wallet(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- #519: provider-cancel refund = money actually held (minus a released wallet part)
-- ---------------------------------------------------------------------------
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

  -- #519: the checkout total minus any wallet part that was already released
  -- (card declined, then captured late), never more than what Famy holds.
  v_amount := public.payment_checkout_funded_total(v_pay);
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

  RETURN v_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_customer_wallet_provider_cancelled(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_customer_wallet_provider_cancelled(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- #519 + #526: the provider payout waits while a Paymob money flag is open
-- (late-capture shortfall or a refund made on the gateway). Resolving the flag
-- releases it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_paymob_money_flag_open(p_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.booking_id = p_booking_id
      AND NULLIF(p.metadata->>'paymob_resolved_at', '') IS NULL
      AND (
        COALESCE((p.metadata->>'capture_shortfall')::numeric, 0) > 0
        OR NULLIF(p.metadata->>'gateway_refund_recorded_at', '') IS NOT NULL
      )
  );
$$;

REVOKE ALL ON FUNCTION public.booking_paymob_money_flag_open(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_paymob_money_flag_open(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ledger_apply_booking_shares(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_cutoff timestamptz;
  v_platform_share numeric;
  v_pay public.payments%ROWTYPE;
  v_carried numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('famy_ledger_booking:' || p_booking_id::text, 0));
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_booking.status IS DISTINCT FROM 'completed' THEN
    RETURN;
  END IF;

  IF v_booking.provider_payout_held
     OR EXISTS (
       SELECT 1 FROM public.online_lesson_issue_reports r
       WHERE r.booking_id = p_booking_id AND r.status = 'open'
     )
     -- #519 / #526: hold until an admin resolves the Paymob money flag.
     OR public.booking_paymob_money_flag_open(p_booking_id) THEN
    RETURN;
  END IF;

  SELECT * INTO v_pay
  FROM public.payments
  WHERE booking_id = p_booking_id
  ORDER BY CASE WHEN status = 'captured' THEN 0 ELSE 1 END, created_at DESC
  LIMIT 1;

  IF FOUND AND v_booking.carried_fees_amount > 0 THEN
    IF COALESCE(v_pay.payment_method_type, '') = 'cash' THEN
      v_carried := public.settle_carried_fees(p_booking_id, 'cash', NULL);
      IF v_carried > 0 THEN
        PERFORM public.ledger_insert_entry(
          v_booking.provider_id, p_booking_id, 'carried_fee_collected', 'debit',
          v_carried, 'cash', NULL, NULL, NULL
        );
      END IF;
    ELSIF v_pay.status = 'captured'
          AND COALESCE(v_pay.payment_method_type, '') IN ('online', 'manual_transfer') THEN
      PERFORM public.settle_carried_fees(
        p_booking_id, COALESCE(v_pay.payment_method_code, v_pay.payment_method_type), NULL
      );
    END IF;
  END IF;

  IF v_booking.price_provider_net IS NULL THEN
    RETURN;
  END IF;

  SELECT s.ledger_auto_from INTO v_cutoff FROM public.provider_settlement_settings() s;
  IF v_booking.completed_at IS NULL OR v_booking.completed_at < v_cutoff THEN
    RETURN;
  END IF;

  v_platform_share := GREATEST(COALESCE(v_booking.price_total, 0) - COALESCE(v_booking.price_provider_net, 0), 0);

  IF v_pay.id IS NULL THEN
    RETURN;
  END IF;

  IF COALESCE(v_pay.payment_method_type, '') = 'cash' THEN
    IF v_platform_share > 0 THEN
      PERFORM public.ledger_insert_entry(
        v_booking.provider_id, p_booking_id, 'cash_collected_platform_share', 'debit',
        v_platform_share, 'cash', NULL, NULL, NULL
      );
    END IF;
    IF v_pay.status IS DISTINCT FROM 'captured' THEN
      PERFORM set_config('app.ledger_internal_capture', 'on', true);
      UPDATE public.payments
      SET status = 'captured', captured_at = COALESCE(captured_at, now())
      WHERE id = v_pay.id AND status IS DISTINCT FROM 'captured';
      PERFORM set_config('app.ledger_internal_capture', 'off', true);
    END IF;
  ELSIF v_pay.status = 'captured'
        AND COALESCE(v_pay.payment_method_type, '') IN ('online', 'manual_transfer')
        AND COALESCE(v_booking.price_provider_net, 0) > 0 THEN
    PERFORM public.ledger_insert_entry(
      v_booking.provider_id, p_booking_id, 'online_provider_share', 'credit',
      v_booking.price_provider_net,
      COALESCE(v_pay.payment_method_code, v_pay.payment_method_type), NULL, NULL, NULL
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ledger_apply_booking_shares(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_apply_booking_shares(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- #526: add up every gateway refund on a payment (keyed by Paymob transaction)
-- and re-open the admin flag when a new refund arrives after a resolution.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.paymob_apply_refund_webhook(
  p_paymob_transaction_id bigint,
  p_order_id bigint,
  p_amount_cents bigint,
  p_is_voided boolean,
  p_metadata jsonb DEFAULT '{}'::jsonb
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
  v_tx_key text := p_paymob_transaction_id::text;
BEGIN
  IF p_paymob_transaction_id IS NULL OR p_paymob_transaction_id <= 0
     OR p_order_id IS NULL OR p_order_id <= 0 THEN
    RAISE EXCEPTION 'Invalid Paymob refund.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(p_paymob_transaction_id);

  SELECT * INTO v_event
  FROM public.paymob_webhook_events
  WHERE paymob_transaction_id = p_paymob_transaction_id;
  IF FOUND THEN
    IF v_event.outcome = 'refunded' THEN
      RETURN jsonb_build_object('duplicate', true, 'payment_id', v_event.payment_id);
    END IF;
    IF v_event.outcome = 'captured' THEN
      v_reuse_capture := true;
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
        || jsonb_build_object('gateway_refund_voided', COALESCE(p_is_voided, false))
    );
  END IF;

  v_refunds := COALESCE(v_payment.metadata->'gateway_refunds', '{}'::jsonb);
  -- A refund recorded before this change kept only one amount: keep it in the sum.
  IF v_refunds = '{}'::jsonb
     AND NULLIF(v_payment.metadata->>'gateway_refund_amount_cents', '') IS NOT NULL THEN
    v_refunds := jsonb_build_object(
      'legacy',
      (v_payment.metadata->>'gateway_refund_amount_cents')::bigint
    );
  END IF;

  IF v_refunds ? v_tx_key
     OR (
       v_reuse_capture
       AND v_payment.metadata->'gateway_refunds' IS NULL
       AND COALESCE(v_payment.metadata->>'gateway_refund_recorded_at', '') <> ''
     ) THEN
    RETURN jsonb_build_object('duplicate', true, 'payment_id', v_payment.id);
  END IF;

  v_refunds := v_refunds || jsonb_build_object(v_tx_key, COALESCE(p_amount_cents, 0));
  SELECT COALESCE(sum((value)::text::bigint), 0) INTO v_total_cents
  FROM jsonb_each(v_refunds);

  v_status := v_payment.status;
  v_meta := COALESCE(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'gateway_refunds', v_refunds,
      'gateway_refund_recorded_at', now(),
      'gateway_refund_amount_cents', v_total_cents,
      'gateway_refund_last_amount_cents', p_amount_cents,
      'gateway_refund_last_transaction_id', p_paymob_transaction_id,
      'gateway_refund_voided', COALESCE(p_is_voided, false),
      'needs_admin_review', true
    );

  UPDATE public.payments
  SET metadata = (
    COALESCE(metadata, '{}'::jsonb)
    - 'paymob_resolved_at'
    - 'paymob_resolved_by'
    - 'paymob_resolve_note'
  ) || v_meta
  WHERE id = v_payment.id;

  IF NOT v_reuse_capture THEN
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
    'capture_preserved', v_reuse_capture,
    'refunded_total_cents', v_total_cents
  );
END;
$$;

REVOKE ALL ON FUNCTION public.paymob_apply_refund_webhook(bigint, bigint, bigint, boolean, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paymob_apply_refund_webhook(bigint, bigint, bigint, boolean, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_resolve_paymob_flag(
  p_payment_id uuid,
  p_unmapped_transaction_id bigint,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_pay public.payments%ROWTYPE;
  v_unmapped public.paymob_unmapped_captures%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_resolved jsonb;
BEGIN
  IF v_admin IS NULL OR NOT public.has_role(v_admin, 'admin') THEN
    RAISE EXCEPTION 'Admin required.' USING ERRCODE = '42501';
  END IF;
  IF v_note IS NULL THEN
    RAISE EXCEPTION 'A resolution note is required.' USING ERRCODE = '23514';
  END IF;
  IF p_payment_id IS NULL AND (p_unmapped_transaction_id IS NULL OR p_unmapped_transaction_id <= 0) THEN
    RAISE EXCEPTION 'Payment or unmapped transaction id is required.' USING ERRCODE = '23514';
  END IF;

  v_resolved := jsonb_build_object(
    'paymob_resolved_at', now(),
    'paymob_resolved_by', v_admin,
    'paymob_resolve_note', v_note,
    'needs_admin_review', false
  );

  IF p_payment_id IS NOT NULL THEN
    SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payment not found.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM set_config('app.ledger_internal_capture', 'on', true);
    UPDATE public.payments
    SET metadata = (
      COALESCE(metadata, '{}'::jsonb)
      - 'capture_shortfall'
      - 'capture_shortfall_recorded_at'
    ) || v_resolved
    WHERE id = p_payment_id;
    PERFORM set_config('app.ledger_internal_capture', 'off', true);

    -- #519 / #526: the provider payout held on this flag is released now.
    IF v_pay.booking_id IS NOT NULL THEN
      PERFORM public.ledger_apply_booking_shares(v_pay.booking_id);
    END IF;
  END IF;

  IF p_unmapped_transaction_id IS NOT NULL AND p_unmapped_transaction_id > 0 THEN
    SELECT * INTO v_unmapped
    FROM public.paymob_unmapped_captures
    WHERE paymob_transaction_id = p_unmapped_transaction_id
    FOR UPDATE;
    IF FOUND THEN
      UPDATE public.paymob_unmapped_captures
      SET
        needs_admin_review = false,
        metadata = COALESCE(metadata, '{}'::jsonb) || v_resolved
      WHERE paymob_transaction_id = p_unmapped_transaction_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'payment_id', p_payment_id,
    'unmapped_transaction_id', p_unmapped_transaction_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_resolve_paymob_flag(uuid, bigint, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_paymob_flag(uuid, bigint, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- #518: a payment already refunded to the customer's wallet is not "refund due"
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_payment_situation(
  p_status text,
  p_payment_method_type text,
  p_method text,
  p_proof_path text,
  p_booking_status text,
  p_has_cash_ledger boolean,
  p_metadata jsonb DEFAULT '{}'::jsonb
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
  v_proof text := NULLIF(btrim(COALESCE(p_proof_path, '')), '');
  v_meta jsonb := COALESCE(p_metadata, '{}'::jsonb);
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

  IF NULLIF(v_meta->>'paymob_resolved_at', '') IS NULL
     AND (
       COALESCE((v_meta->>'capture_shortfall')::numeric, 0) > 0
       OR COALESCE((v_meta->>'needs_admin_review')::boolean, false)
       OR NULLIF(v_meta->>'gateway_refund_recorded_at', '') IS NOT NULL
       OR COALESCE((v_meta->>'unmapped_order')::boolean, false)
       OR COALESCE((v_meta->>'paymob_unmapped')::boolean, false)
     )
  THEN
    RETURN 'paymobNeedsAction';
  END IF;

  -- #518: refunded to the customer's wallet already (customer cancel, online
  -- no-show). Recording another refund would pay the customer twice.
  IF v_status IN ('captured', 'partially_refunded')
     AND (
       COALESCE(v_meta->>'refund_settled_via_wallet', '') = 'true'
       OR COALESCE(v_meta->>'wallet_refund_settled', '') = 'true'
     )
  THEN
    IF v_status = 'partially_refunded'
       OR COALESCE(NULLIF(v_meta->>'cancellation_fee', '')::numeric, 0) > 0 THEN
      RETURN 'partiallyRefunded';
    END IF;
    RETURN 'refunded';
  END IF;

  IF v_closed AND (
    (v_status = 'captured' AND v_type IN ('online', 'manual_transfer'))
    OR (v_status = 'pending_review' AND v_type = 'manual_transfer' AND v_proof IS NOT NULL)
  ) THEN
    RETURN 'refundDue';
  END IF;
  IF v_status = 'captured' THEN RETURN 'paid'; END IF;
  IF v_status = 'refunded' THEN RETURN 'refunded'; END IF;
  IF v_status = 'partially_refunded' THEN RETURN 'partiallyRefunded'; END IF;
  IF v_status = 'rejected' THEN RETURN 'rejected'; END IF;
  IF v_status = 'failed' THEN RETURN 'failed'; END IF;
  IF v_status = 'pending_review'
     AND v_type = 'manual_transfer'
     AND v_proof IS NOT NULL
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
      IF v_proof IS NOT NULL THEN RETURN 'review'; END IF;
      RETURN 'awaitingProof';
    END IF;
    IF v_type = 'online' THEN RETURN 'awaitingCard'; END IF;
  END IF;

  RETURN 'other';
END;
$$;
REVOKE ALL ON FUNCTION public.admin_payment_situation(text, text, text, text, text, boolean, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payment_situation(text, text, text, text, text, boolean, jsonb)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- #527: admin wallet adjustments need an idempotency key, and a key can only
-- ever mean one adjustment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_adjust_customer_wallet(
  p_customer_id uuid,
  p_direction text,
  p_amount numeric,
  p_reason_note text,
  p_booking_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_balance numeric;
  v_reason text;
  v_entry_id uuid;
  v_key text;
  v_existing public.customer_wallet_entries%ROWTYPE;
BEGIN
  IF v_admin IS NULL OR NOT public.has_role(v_admin, 'admin') THEN
    RAISE EXCEPTION 'Admin required.' USING ERRCODE = '42501';
  END IF;
  IF p_reason_note IS NULL OR btrim(p_reason_note) = '' THEN
    RAISE EXCEPTION 'A reason is required.' USING ERRCODE = '23514';
  END IF;
  IF p_direction NOT IN ('credit', 'debit') THEN
    RAISE EXCEPTION 'Invalid wallet direction.' USING ERRCODE = '23514';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Wallet amount must be positive.' USING ERRCODE = '23514';
  END IF;
  IF NULLIF(btrim(COALESCE(p_idempotency_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'WALLET_IDEMPOTENCY_KEY_REQUIRED: An idempotency key is required for wallet adjustments.'
      USING ERRCODE = '23514';
  END IF;

  PERFORM public.lock_customer_debts(p_customer_id);
  PERFORM public.lock_customer_wallet(p_customer_id);

  v_key := 'admin_wallet:' || p_customer_id::text || ':' || btrim(p_idempotency_key);

  SELECT * INTO v_existing
  FROM public.customer_wallet_entries e
  WHERE e.idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.direction <> p_direction
       OR v_existing.amount <> p_amount
       OR v_existing.customer_id <> p_customer_id THEN
      RAISE EXCEPTION 'WALLET_IDEMPOTENCY_CONFLICT: This key was already used for a different wallet adjustment.'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT COALESCE(
    sum(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END),
    0
  ) INTO v_balance
  FROM public.customer_wallet_entries e
  WHERE e.customer_id = p_customer_id;

  IF p_direction = 'debit' AND v_balance < p_amount THEN
    RAISE EXCEPTION 'Wallet balance is insufficient for this debit.' USING ERRCODE = '23514';
  END IF;

  v_reason := CASE WHEN p_direction = 'credit' THEN 'admin_credit' ELSE 'admin_debit' END;

  v_entry_id := public.customer_wallet_insert_entry(
    p_customer_id,
    p_direction,
    p_amount,
    v_reason,
    p_booking_id,
    NULL,
    v_admin,
    v_key,
    jsonb_build_object('admin_reason', btrim(p_reason_note))
  );

  RETURN v_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_customer_wallet(uuid, text, numeric, text, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_customer_wallet(uuid, text, numeric, text, uuid, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- #522: age / minor helpers are internal (only called inside other
-- SECURITY DEFINER functions); nobody can look up someone else's age.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.booking_online_age_years(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_online_age_years(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.family_member_is_minor(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_member_is_minor(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- #523: a daily cap on reports, and no reporting your own chat message
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_ugc(
  p_subject_type text,
  p_reason text,
  p_detail text DEFAULT NULL,
  p_message_id uuid DEFAULT NULL,
  p_conversation_id uuid DEFAULT NULL,
  p_review_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_conv RECORD;
  v_msg RECORD;
  v_review RECORD;
  v_booking_id uuid;
  v_id uuid;
  v_recent integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  IF p_subject_type NOT IN ('chat_message', 'chat_thread', 'review') THEN
    RAISE EXCEPTION 'Invalid subject type.' USING ERRCODE = '23514';
  END IF;
  IF p_reason NOT IN ('harassment', 'spam', 'inappropriate', 'other') THEN
    RAISE EXCEPTION 'Invalid report reason.' USING ERRCODE = '23514';
  END IF;

  IF p_subject_type IN ('chat_message', 'chat_thread') THEN
    IF p_conversation_id IS NULL THEN
      RAISE EXCEPTION 'Conversation required.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO v_conv FROM public.conversations WHERE id = p_conversation_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Conversation not found.' USING ERRCODE = '42501';
    END IF;
    IF v_conv.customer_id = v_uid THEN
      v_role := 'customer';
    ELSIF v_conv.provider_user_id = v_uid THEN
      v_role := 'provider';
    ELSE
      RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
    END IF;
    v_booking_id := v_conv.booking_id;

    IF p_subject_type = 'chat_message' THEN
      IF p_message_id IS NULL THEN
        RAISE EXCEPTION 'Message required.' USING ERRCODE = '23514';
      END IF;
      SELECT * INTO v_msg FROM public.messages
      WHERE id = p_message_id AND conversation_id = p_conversation_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Message not found.' USING ERRCODE = '42501';
      END IF;
      IF v_msg.sender_id = v_uid THEN
        RAISE EXCEPTION 'UGC_REPORT_OWN_MESSAGE: You cannot report your own message.'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSE
    IF p_review_id IS NULL THEN
      RAISE EXCEPTION 'Review required.' USING ERRCODE = '23514';
    END IF;
    SELECT r.*, p.profile_id AS provider_profile_id INTO v_review
    FROM public.reviews r
    JOIN public.providers p ON p.id = r.provider_id
    WHERE r.id = p_review_id AND r.moderation_hidden_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Review not found.' USING ERRCODE = '42501';
    END IF;
    IF v_review.customer_id = v_uid THEN
      RAISE EXCEPTION 'Cannot report your own review.' USING ERRCODE = '42501';
    END IF;
    IF v_review.provider_profile_id = v_uid THEN
      v_role := 'provider';
    ELSE
      v_role := 'customer';
    END IF;
    v_booking_id := v_review.booking_id;
  END IF;

  SELECT r.id INTO v_id
  FROM public.ugc_reports r
  WHERE r.reported_by = v_uid
    AND r.subject_type = p_subject_type
    AND r.status = 'open'
    AND (
      (p_subject_type = 'chat_message' AND r.message_id = p_message_id)
      OR (p_subject_type = 'chat_thread' AND r.conversation_id = p_conversation_id)
      OR (p_subject_type = 'review' AND r.review_id = p_review_id)
    );

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- One account cannot flood the admin queue: at most 10 new reports a day.
  PERFORM pg_advisory_xact_lock(hashtextextended('famy_ugc_report:' || v_uid::text, 0));
  SELECT count(*)::integer INTO v_recent
  FROM public.ugc_reports r
  WHERE r.reported_by = v_uid
    AND r.created_at > now() - interval '24 hours';
  IF v_recent >= 10 THEN
    RAISE EXCEPTION 'UGC_REPORT_LIMIT: Too many reports today. Please try again tomorrow.'
      USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.ugc_reports (
    subject_type, reason, detail, message_id, conversation_id, review_id, booking_id,
    reported_by, reporter_role
  ) VALUES (
    p_subject_type,
    p_reason,
    NULLIF(btrim(p_detail), ''),
    p_message_id,
    p_conversation_id,
    p_review_id,
    v_booking_id,
    v_uid,
    v_role
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.report_ugc(text, text, text, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_ugc(text, text, text, uuid, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- #524: the tutor's name comes from the provider's own profile
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.parent_student_lessons(p_student_id uuid)
RETURNS TABLE (
  booking_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  status text,
  subject_code text,
  price_total numeric,
  tutor_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id,
    b.start_at,
    b.end_at,
    b.status::text,
    b.teaching_subject_code,
    b.price_total,
    COALESCE(tp.full_name, '')
  FROM public.bookings b
  LEFT JOIN public.providers pr ON pr.id = b.provider_id
  LEFT JOIN public.profiles tp ON tp.id = pr.profile_id
  WHERE b.customer_id = p_student_id
    AND b.service_mode = 'online'
    AND EXISTS (
      SELECT 1 FROM public.student_parent_links l
      WHERE l.parent_id = auth.uid()
        AND l.student_id = p_student_id
        AND l.status = 'linked'
        AND l.decided_at IS NOT NULL
    )
  ORDER BY b.start_at DESC
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.parent_student_lessons(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parent_student_lessons(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- #517: an online lesson where someone did not attend is settled, not left open
--   tutor absent, or both absent -> full refund to the student's wallet, no tutor payout
--   student absent                -> the online late-cancel fee goes to the tutor,
--                                    the rest to the student's wallet
-- Every case also opens an admin review item, and both sides get a notification.
-- ---------------------------------------------------------------------------
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
  ELSE
    -- Nothing was paid: only a wallet part reserved for the checkout comes back.
    PERFORM public.restore_customer_wallet_checkout_debit(p_booking_id);
  END IF;

  IF v_has_pay THEN
    v_method := COALESCE(v_pay.payment_method_code, v_pay.payment_method_type);
    v_funded := public.payment_checkout_funded_total(v_pay);

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

CREATE OR REPLACE FUNCTION public.resolve_online_session_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_settings record;
  v_overlap numeric;
  v_required numeric;
  v_duration_min numeric;
  v_outcome text;
  v_event_count integer;
  v_customer_present boolean;
  v_provider_present boolean;
  v_participant_minutes integer;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_settings FROM public.online_session_settings() LIMIT 1;

  FOR v_booking IN
    SELECT b.*
    FROM public.bookings b
    WHERE b.service_mode = 'online'
      AND b.status IN ('confirmed', 'completed')
      AND b.end_at + (COALESCE(v_settings.grace_minutes_after_end, 15) * interval '1 minute') <= now()
      AND b.online_session_outcome IS NULL
    ORDER BY b.end_at, b.id
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    SELECT count(*)::integer INTO v_event_count
    FROM public.session_events se
    WHERE se.booking_id = v_booking.id;

    v_duration_min := GREATEST(
      EXTRACT(epoch FROM (v_booking.end_at - v_booking.start_at)) / 60.0,
      0
    );
    v_required := v_duration_min * COALESCE(v_settings.overlap_ratio, 0.5);
    v_overlap := public.online_session_overlap_minutes(v_booking.id);
    v_customer_present := public.online_session_participant_present(v_booking.id, 'customer');
    v_provider_present := public.online_session_participant_present(v_booking.id, 'provider');

    IF v_event_count = 0 THEN
      v_outcome := 'admin_review_no_events';
    ELSIF NOT v_customer_present AND NOT v_provider_present THEN
      v_outcome := 'both_absent';
    ELSIF NOT v_provider_present THEN
      v_outcome := 'provider_absent';
    ELSIF NOT v_customer_present THEN
      v_outcome := 'customer_absent';
    ELSIF v_overlap < v_required THEN
      v_outcome := 'admin_review_overlap';
    ELSE
      v_outcome := 'complete';
    END IF;

    SELECT COALESCE(
      sum(
        GREATEST(
          EXTRACT(
            epoch FROM (
              COALESCE(se.left_at, LEAST(now(), v_booking.end_at)) - se.joined_at
            )
          ),
          0
        )
      )::integer / 60,
      0
    ) INTO v_participant_minutes
    FROM public.session_events se
    WHERE se.booking_id = v_booking.id;

    UPDATE public.bookings
    SET online_session_outcome = v_outcome,
        online_participant_minutes = v_participant_minutes
    WHERE id = v_booking.id AND online_session_outcome IS NULL;

    -- #517: an absence is settled (refund / fee) while the lesson is still
    -- confirmed; a lesson the tutor already completed is only reviewed.
    IF v_outcome IN ('provider_absent', 'customer_absent', 'both_absent')
       AND v_booking.status = 'confirmed' THEN
      PERFORM public.settle_online_session_absence(v_booking.id, v_outcome);
      v_count := v_count + 1;
    END IF;

    IF v_outcome IN (
      'admin_review_no_events', 'admin_review_overlap',
      'provider_absent', 'customer_absent', 'both_absent'
    ) THEN
      PERFORM public.open_online_session_admin_review(
        v_booking.id,
        'Online session evidence: ' || v_outcome,
        jsonb_build_object(
          'overlap_minutes', v_overlap,
          'required_overlap_minutes', v_required,
          'event_count', v_event_count,
          'outcome', v_outcome,
          'booking_status_before', v_booking.status
        )
      );
    END IF;

    -- History is protected by the online_session_outcome IS NULL filter above:
    -- lessons already resolved are never revisited.
    IF v_outcome = 'complete'
       AND v_booking.status = 'confirmed' THEN
      PERFORM set_config('app.auto_complete_in_progress', 'on', true);
      PERFORM set_config('app.audit_reason', 'online_session_auto_complete', true);

      UPDATE public.bookings
      SET status = 'completed',
          session_started_at = COALESCE(session_started_at, v_booking.start_at),
          session_ended_at = COALESCE(session_ended_at, v_booking.end_at),
          completion_requested_at = COALESCE(completion_requested_at, v_booking.end_at),
          completed_at = COALESCE(completed_at, now()),
          status_changed_at = now(),
          status_changed_by = NULL
      WHERE id = v_booking.id
        AND status = 'confirmed';

      IF FOUND THEN
        v_count := v_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_online_session_bookings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_online_session_bookings() TO service_role;


-- ---------------------------------------------------------------------------
-- #517: tg_booking_notify (latest: 20261126120000) skips the automatic online
-- attendance settlement, which notifies both sides itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_booking_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider_user uuid;
  v_customer_name text;
  v_service_name text;
  v_service_name_ar text;
  v_is_online boolean;
  v_conversation_id uuid;
  v_customer_link text;
  v_provider_link text;
  v_auto_hours numeric;
  v_auto_hours_n integer;
  v_hours_en text;
  v_hours_ar text;
BEGIN
  SELECT profile_id INTO v_provider_user FROM public.providers WHERE id = NEW.provider_id;
  SELECT full_name INTO v_customer_name FROM public.profiles WHERE id = NEW.customer_id;
  SELECT name_en, name_ar INTO v_service_name, v_service_name_ar FROM public.services WHERE id = NEW.service_id;
  v_is_online := COALESCE(NEW.service_mode, 'in_person') = 'online';
  SELECT id INTO v_conversation_id FROM public.conversations WHERE booking_id = NEW.id;
  -- Online lessons live on the /online web surface; the mobile apps map this
  -- path to their own booking screens (mapNotificationDeepLink).
  IF v_is_online THEN
    v_customer_link := '/online/lessons/' || NEW.id;
    v_provider_link := '/online/lessons/' || NEW.id;
  ELSE
    v_customer_link := '/booking/' || NEW.id;
    v_provider_link := '/pro/booking/' || NEW.id;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        v_provider_user, 'booking_request', 'booking',
        'New booking request',
        COALESCE(v_customer_name, 'A customer') || ' requested ' || COALESCE(v_service_name, 'a service'),
        'New booking request', 'طلب حجز جديد',
        COALESCE(v_customer_name, 'A customer') || ' requested ' || COALESCE(v_service_name, 'a service'),
        COALESCE(v_customer_name, 'عميل') || ' طلب ' || COALESCE(v_service_name_ar, v_service_name, 'خدمة'),
        jsonb_build_object('booking_id', NEW.id), v_provider_link, NEW.id
      );
    END IF;
    -- The customer also gets a record that the request was sent and what happens next.
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      NEW.customer_id, 'booking_requested', 'booking',
      'Request sent',
      CASE WHEN v_is_online
        THEN 'Your lesson request was sent to the tutor. We will tell you as soon as they accept, then you pay to confirm the lesson.'
        ELSE 'Your booking request was sent. We will tell you as soon as the provider accepts.'
      END,
      'Request sent', 'طلبك اتبعت',
      CASE WHEN v_is_online
        THEN 'Your lesson request was sent to the tutor. We will tell you as soon as they accept, then you pay to confirm the lesson.'
        ELSE 'Your booking request was sent. We will tell you as soon as the provider accepts.'
      END,
      CASE WHEN v_is_online
        THEN 'طلب الحصة اتبعت للمدرس، وهنبلغك أول ما يقبل وبعدها تدفع عشان تتأكد الحصة'
        ELSE 'طلب الحجز اتبعت، وهنبلغك أول ما مقدم الخدمة يقبل'
      END,
      jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
    );
    RETURN NEW;
  END IF;

  IF TG_OP <> 'UPDATE' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- #517: the automatic online attendance settlement sends its own, more
  -- precise notifications (refund amount, fee) to both sides.
  IF current_setting('app.online_absence_settle', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'confirmed' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      NEW.customer_id, 'booking_confirmed', 'booking',
      'Booking confirmed',
      CASE WHEN v_is_online THEN 'The tutor accepted your lesson. Pay now to confirm it.' ELSE 'Your booking has been accepted.' END,
      'Booking confirmed', CASE WHEN v_is_online THEN 'المدرس قبل الحصة' ELSE 'تم تأكيد الحجز' END,
      CASE WHEN v_is_online THEN 'The tutor accepted your lesson. Pay now to confirm it.' ELSE 'Your booking has been accepted.' END,
      CASE WHEN v_is_online THEN 'المدرس قبل طلبك، ادفع دلوقتي عشان تتأكد الحصة' ELSE 'تم قبول حجزك' END,
      jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
    );
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Booking confirmed.', 'booking_confirmed');
    END IF;

  ELSIF NEW.status = 'on_the_way' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      NEW.customer_id, 'booking_on_the_way', 'booking',
      'Your provider is on the way', 'Your provider is heading to your location.',
      'Your provider is on the way', 'مزود الخدمة في الطريق إليك',
      'Your provider is heading to your location.', 'مزود الخدمة في طريقه إلى موقعك.',
      jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
    );
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Provider is on the way.', 'on_the_way');
    END IF;

  ELSIF NEW.status = 'arrived' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      NEW.customer_id, 'booking_arrived', 'booking',
      'Your provider has arrived', 'Your provider reported that they have arrived. Please confirm arrival in the app.',
      'Your provider has arrived', 'وصل مزود الخدمة',
      'Your provider reported that they have arrived. Please confirm arrival in the app.', 'أبلغ مزود الخدمة بوصوله. يرجى تأكيد الوصول في التطبيق.',
      jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
    );

  ELSIF NEW.status = 'arrival_confirmed' THEN
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        v_provider_user, 'booking_arrival_confirmed', 'booking',
        'Arrival confirmed', 'The customer confirmed your arrival. You can start the service.',
        'Arrival confirmed', 'تم تأكيد الوصول',
        'The customer confirmed your arrival. You can start the service.', 'أكد العميل وصولك. يمكنك بدء الخدمة.',
        jsonb_build_object('booking_id', NEW.id), v_provider_link, NEW.id
      );
    END IF;

  ELSIF NEW.status = 'in_progress' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      NEW.customer_id, 'booking_in_progress', 'booking',
      'Service started', 'Your service is now in progress.',
      'Service started', 'بدأت الخدمة',
      'Your service is now in progress.', 'خدمتك جارية الآن.',
      jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
    );
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Service started.', 'service_started');
    END IF;

  ELSIF NEW.status = 'completion_requested' THEN
    SELECT s.auto_complete_hours INTO v_auto_hours
    FROM public.booking_expiry_settings() s;
    v_auto_hours_n := GREATEST(1, LEAST(24, ROUND(COALESCE(v_auto_hours, 6))))::integer;
    v_hours_en := v_auto_hours_n::text || CASE WHEN v_auto_hours_n = 1 THEN ' hour' ELSE ' hours' END;
    v_hours_ar := CASE
      WHEN v_auto_hours_n = 1 THEN 'ساعة'
      WHEN v_auto_hours_n = 2 THEN 'ساعتين'
      ELSE v_auto_hours_n::text || ' ساعات'
    END;
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      NEW.customer_id, 'booking_completion_requested', 'booking',
      'Confirm your service',
      'Your provider marked this booking as done. Please confirm to complete it. If there is no problem, it will close automatically after ' || v_hours_en || '.',
      'Confirm your service', 'أكد إتمام الخدمة',
      'Your provider marked this booking as done. Please confirm to complete it. If there is no problem, it will close automatically after ' || v_hours_en || '.',
      'مقدم الخدمة قال إن الخدمة خلصت، ولو مفيش مشكلة الحجز هيتقفل لوحده بعد ' || v_hours_ar,
      jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
    );
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Provider marked the service as complete. Awaiting customer confirmation.', 'completion_requested');
    END IF;

  ELSIF NEW.status = 'completed' THEN
    IF current_setting('app.auto_complete_in_progress', true) = 'on' THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        NEW.customer_id, 'booking_completed', 'booking',
        'Booking completed', 'This booking was completed automatically because no problem was reported.',
        'Booking completed', 'الحجز خلص لوحده',
        'This booking was completed automatically because no problem was reported.',
        'الحجز اتقفل لوحده عشان مفيش مشكلة اتبلغ عنها',
        jsonb_build_object('booking_id', NEW.id, 'reason', 'auto_complete'), v_customer_link, NEW.id
      );
      IF v_provider_user IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
        VALUES (
          v_provider_user, 'booking_completed', 'booking',
          'Booking completed', 'This booking was completed automatically because the customer did not report a problem.',
          'Booking completed', 'الحجز خلص لوحده',
          'This booking was completed automatically because the customer did not report a problem.',
          'الحجز اتقفل لوحده عشان العميل مبلغش عن مشكلة',
          jsonb_build_object('booking_id', NEW.id, 'reason', 'auto_complete'), v_provider_link, NEW.id
        );
      END IF;
    ELSIF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        v_provider_user, 'booking_completed', 'booking',
        'Booking completed', 'The customer confirmed the service is complete.',
        'Booking completed', 'اكتمل الحجز',
        'The customer confirmed the service is complete.', 'أكد العميل اكتمال الخدمة.',
        jsonb_build_object('booking_id', NEW.id), v_provider_link, NEW.id
      );
    END IF;
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Booking completed.', 'booking_completed');
    END IF;

  ELSIF NEW.status = 'disputed' THEN
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        v_provider_user, 'booking_disputed', 'booking',
        'Booking disputed', 'The customer disputed this booking''s completion. Our team will review it.',
        'Booking disputed', 'حجز محل نزاع',
        'The customer disputed this booking''s completion. Our team will review it.', 'اعترض العميل على إتمام هذا الحجز. سيقوم فريقنا بمراجعته.',
        jsonb_build_object('booking_id', NEW.id), v_provider_link, NEW.id
      );
    END IF;

  ELSIF NEW.status = 'no_show' THEN
    IF NEW.no_show_party = 'provider' AND v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        v_provider_user, 'booking_no_show', 'booking',
        'No-show reported', 'The customer reported that you did not show up for this booking.',
        'No-show reported', 'تم الإبلاغ عن عدم الحضور',
        'The customer reported that you did not show up for this booking.', 'أبلغ العميل بأنك لم تحضر لهذا الحجز.',
        jsonb_build_object('booking_id', NEW.id), v_provider_link, NEW.id
      );
    ELSIF NEW.no_show_party = 'customer' THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        NEW.customer_id, 'booking_no_show', 'booking',
        'No-show reported', 'Your provider reported that you were unavailable for this booking.',
        'No-show reported', 'تم الإبلاغ عن عدم الحضور',
        'Your provider reported that you were unavailable for this booking.', 'أبلغ مزود الخدمة بأنك لم تكن متاحًا لهذا الحجز.',
        jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
      );
    END IF;

  ELSIF NEW.status = 'cancelled' THEN
    -- Latest body from 20260714233000, plus an expiry skip so we do not
    -- send a second customer "declined" notification. Expiry already
    -- inserts customer + provider notifications in expire_pending_bookings().
    IF NEW.cancellation_reason = 'provider_no_response'
       OR current_setting('app.pending_expiry_in_progress', true) = 'on' THEN
      NULL;
    ELSIF OLD.status = 'pending' AND NEW.cancelled_by IS DISTINCT FROM NEW.customer_id THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        NEW.customer_id, 'booking_declined', 'booking',
        'Booking declined', 'Your booking request was not accepted. Please try another provider or time.',
        'Booking declined', 'تم رفض الحجز',
        'Your booking request was not accepted. Please try another provider or time.', 'لم يتم قبول طلب حجزك. يرجى تجربة مزود خدمة أو موعد آخر.',
        jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
      );
    ELSIF NEW.cancelled_by = NEW.customer_id THEN
      IF v_provider_user IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
        VALUES (
          v_provider_user, 'booking_cancelled', 'booking',
          CASE WHEN OLD.status = 'pending' THEN 'Request cancelled' ELSE 'Booking cancelled' END,
          CASE WHEN OLD.status = 'pending' THEN 'The customer cancelled the request before you answered.' ELSE 'The customer cancelled this booking.' END,
          CASE WHEN OLD.status = 'pending' THEN 'Request cancelled' ELSE 'Booking cancelled' END,
          CASE WHEN OLD.status = 'pending' THEN 'الطلب اتلغى' ELSE 'تم إلغاء الحجز' END,
          CASE WHEN OLD.status = 'pending' THEN 'The customer cancelled the request before you answered.' ELSE 'The customer cancelled this booking.' END,
          CASE WHEN OLD.status = 'pending' THEN 'العميل لغى الطلب قبل ما ترد عليه' ELSE 'العميل لغى الحجز ده' END,
          jsonb_build_object('booking_id', NEW.id), v_provider_link, NEW.id
        );
      END IF;
    ELSE
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        NEW.customer_id, 'booking_cancelled', 'booking',
        'Booking cancelled', 'Your booking was cancelled.',
        'Booking cancelled', 'تم إلغاء الحجز',
        'Your booking was cancelled.', 'تم إلغاء حجزك.',
        jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
      );
    END IF;
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      IF NEW.cancellation_reason = 'provider_no_response'
         OR current_setting('app.pending_expiry_in_progress', true) = 'on' THEN
        INSERT INTO public.messages (conversation_id, body, system_key)
        VALUES (v_conversation_id, 'Booking request expired.', 'booking_expired');
      ELSE
        INSERT INTO public.messages (conversation_id, body, system_key)
        VALUES (v_conversation_id, 'Booking cancelled.', 'booking_cancelled');
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_booking_notify() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
