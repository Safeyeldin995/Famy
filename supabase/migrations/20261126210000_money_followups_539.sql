-- #539 money follow-ups from #537.
--
-- 1) Carried fees. A booking can carry unpaid fees from earlier bookings
--    (bookings.carried_fees_amount, customer_debts.carried_booking_id). When the
--    booking is closed and the money for it, carried fees included, goes back to
--    the customer (provider cancel, online tutor or both absent), the fees must
--    be open again for the customer instead of staying attached to the closed
--    booking. The status trigger tg_booking_release_carried_fees only releases
--    them when no money is held at the moment the status changes, which is not
--    the case for these refund paths: the booking closes first and the money is
--    refunded right after. release_unheld_carried_fees() runs after the refund.
--    Paths that keep the fees (customer cancel, customer absent, card refund,
--    admin wallet refund) settle them with settle_carried_fees() and are unchanged.
--
-- 2) Paymob refunds. Each refund transaction is recorded by its own id and its
--    own amount, so two partial refunds both count. A callback on the original
--    transaction (is_refunded / is_voided) is cumulative: it raises the refunded
--    total to the new value and never adds to it twice. The webhook still only
--    flags the payment for admin review; no money moves automatically.
--
-- Functions re-derived from 20261126130100_audit_money_batch_a.sql (latest).

CREATE OR REPLACE FUNCTION public.release_unheld_carried_fees(p_booking_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b public.bookings%ROWTYPE;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND
     OR COALESCE(v_b.carried_fees_amount, 0) <= 0
     OR v_b.status::text NOT IN ('cancelled', 'no_show')
     OR public.booking_money_held(p_booking_id) THEN
    RETURN 0;
  END IF;
  PERFORM public.lock_customer_debts(v_b.customer_id);
  UPDATE public.customer_debts
  SET carried_booking_id = NULL
  WHERE carried_booking_id = p_booking_id AND status = 'open';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.release_unheld_carried_fees(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_unheld_carried_fees(uuid) TO service_role;

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

  -- #539: the refund included the fees carried from earlier bookings, so they
  -- are open again for the customer.
  PERFORM public.release_unheld_carried_fees(p_booking_id);

  RETURN v_entry_id;
END;
$$;
REVOKE ALL ON FUNCTION public.credit_customer_wallet_provider_cancelled(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_customer_wallet_provider_cancelled(uuid) TO service_role;

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

-- Paymob refunds: one entry per refund transaction, plus a cumulative value for
-- callbacks on the original transaction. Total = max(sum of refund transactions,
-- cumulative value), so the two styles of callback never double count.
-- p_refund_kind:
--   'transaction' : a refund transaction of its own (has a parent transaction);
--                   keyed by its id, amount = its own amount_cents.
--   'cumulative'  : the original transaction reported as refunded or voided;
--                   p_cumulative_amount_cents is the total refunded so far
--                   (NULL when Paymob did not send it).
--   NULL          : older webhook build; keeps the previous behaviour.
DROP FUNCTION IF EXISTS public.paymob_apply_refund_webhook(bigint, bigint, bigint, boolean, jsonb);

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

  UPDATE public.payments
  SET metadata = (
    COALESCE(metadata, '{}'::jsonb)
    - 'paymob_resolved_at'
    - 'paymob_resolved_by'
    - 'paymob_resolve_note'
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

REVOKE ALL ON FUNCTION public.paymob_apply_refund_webhook(bigint, bigint, bigint, boolean, jsonb, text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paymob_apply_refund_webhook(bigint, bigint, bigint, boolean, jsonb, text, bigint)
  TO service_role;

-- Backfill: fees still attached to a closed booking whose money is no longer held
-- (refunded before this change) are open again, exactly as the self-healing
-- carryable-debt rule already treats them.
UPDATE public.customer_debts d
SET carried_booking_id = NULL
FROM public.bookings b
WHERE b.id = d.carried_booking_id
  AND d.status = 'open'
  AND b.status::text IN ('cancelled', 'no_show')
  AND NOT public.booking_money_held(b.id);
