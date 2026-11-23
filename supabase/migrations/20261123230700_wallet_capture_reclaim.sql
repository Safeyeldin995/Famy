-- Codex round 6: block wallet apply on non-payable bookings; reclaim released wallet on late capture.

CREATE OR REPLACE FUNCTION public.customer_apply_wallet_at_checkout(
  p_payment_id uuid,
  p_customer_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pay public.payments%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_due numeric;
  v_available numeric;
  v_spend numeric;
  v_card numeric;
  v_key text;
  v_entry_id uuid;
  v_existing jsonb;
BEGIN
  IF v_uid IS NULL THEN
    IF p_customer_id IS NULL THEN
      RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;
    IF current_setting('role', true) <> 'service_role' THEN
      RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;
    v_uid := p_customer_id;
  END IF;

  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND OR v_pay.customer_id <> v_uid THEN
    RAISE EXCEPTION 'Payment not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_pay.status = 'captured' THEN
    RETURN jsonb_build_object(
      'payment_id', v_pay.id,
      'wallet_spent', COALESCE((v_pay.metadata->>'wallet_applied')::numeric, 0),
      'card_amount', 0,
      'paid_via_wallet_only', true
    );
  END IF;
  IF v_pay.status <> 'pending' THEN
    RAISE EXCEPTION 'Payment is not payable.' USING ERRCODE = '23514';
  END IF;

  v_existing := v_pay.metadata->'wallet_checkout';
  IF jsonb_typeof(v_existing) = 'object' AND (v_existing->>'applied')::boolean IS TRUE THEN
    RETURN v_existing || jsonb_build_object('payment_id', v_pay.id);
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_pay.booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_booking.status::text NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'This booking is no longer payable.' USING ERRCODE = '23514';
  END IF;

  PERFORM public.lock_customer_debts(v_uid);
  PERFORM public.lock_customer_wallet(v_uid);

  v_due := COALESCE(
    NULLIF((v_pay.metadata->>'checkout_total')::numeric, 0),
    NULLIF(v_pay.amount, 0),
    COALESCE(v_booking.price_total, 0) + COALESCE(v_booking.carried_fees_amount, 0)
  );
  IF v_due <= 0 THEN
    RAISE EXCEPTION 'Nothing to pay.' USING ERRCODE = '23514';
  END IF;

  SELECT b.available_amount INTO v_available
  FROM public.customer_wallet_balances(v_uid) b;

  v_spend := LEAST(GREATEST(COALESCE(v_available, 0), 0), v_due);
  v_card := GREATEST(v_due - v_spend, 0);

  v_key := 'checkout_spend:' || p_payment_id::text;

  IF v_spend > 0 THEN
    IF v_spend > COALESCE(v_available, 0) + 0.0001 THEN
      RAISE EXCEPTION 'Insufficient wallet balance.' USING ERRCODE = '23514';
    END IF;
    v_entry_id := public.customer_wallet_insert_entry(
      v_uid, 'debit', v_spend, 'checkout_spend', v_booking.id, p_payment_id, NULL, v_key,
      jsonb_build_object('checkout_total', v_due)
    );
    IF v_entry_id IS NULL THEN
      SELECT e.id, e.amount INTO v_entry_id, v_spend
      FROM public.customer_wallet_entries e
      WHERE e.idempotency_key = v_key;
      IF v_entry_id IS NULL THEN
        RAISE EXCEPTION 'Wallet checkout debit could not be recorded.' USING ERRCODE = '23514';
      END IF;
      v_card := GREATEST(v_due - v_spend, 0);
    END IF;
  END IF;

  IF v_card <= 0.01 THEN
    PERFORM set_config('app.wallet_checkout_adjust', 'on', true);
    PERFORM set_config('app.ledger_internal_capture', 'on', true);
    UPDATE public.payments
    SET status = 'captured',
        captured_at = now(),
        amount = v_due,
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'wallet_checkout',
          jsonb_build_object(
            'applied', true,
            'checkout_total', v_due,
            'wallet_spent', v_spend,
            'card_amount', 0,
            'paid_via_wallet_only', true
          ),
          'wallet_applied', v_spend,
          'checkout_total', v_due
        )
    WHERE id = p_payment_id;
    PERFORM set_config('app.ledger_internal_capture', 'off', true);
    PERFORM set_config('app.wallet_checkout_adjust', 'off', true);
    RETURN jsonb_build_object(
      'payment_id', p_payment_id,
      'wallet_spent', v_spend,
      'card_amount', 0,
      'paid_via_wallet_only', true
    );
  END IF;

  PERFORM set_config('app.wallet_checkout_adjust', 'on', true);
  UPDATE public.payments
  SET amount = round(v_card, 2),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'wallet_checkout',
        jsonb_build_object(
          'applied', true,
          'checkout_total', v_due,
          'wallet_spent', v_spend,
          'card_amount', round(v_card, 2),
          'paid_via_wallet_only', false
        ),
        'wallet_applied', v_spend,
        'checkout_total', v_due
      )
  WHERE id = p_payment_id;
  PERFORM set_config('app.wallet_checkout_adjust', 'off', true);

  RETURN jsonb_build_object(
    'payment_id', p_payment_id,
    'wallet_spent', v_spend,
    'card_amount', round(v_card, 2),
    'paid_via_wallet_only', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.paymob_apply_transaction_webhook(
  p_paymob_transaction_id bigint, p_order_id bigint, p_integration_id bigint,
  p_currency text, p_success boolean, p_pending boolean, p_amount_cents bigint,
  p_provider_ref text, p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_event public.paymob_webhook_events%ROWTYPE;
  v_outcome text;
  v_status public.payment_status;
  v_meta jsonb;
  v_released numeric;
  v_checkout_total numeric;
  v_shortfall numeric;
  v_reclaim numeric;
  v_available numeric;
  v_key text;
  v_entry_id uuid;
BEGIN
  IF p_paymob_transaction_id IS NULL OR p_paymob_transaction_id <= 0
     OR p_order_id IS NULL OR p_order_id <= 0 OR p_success IS NULL OR p_pending IS NULL THEN
    RAISE EXCEPTION 'Invalid Paymob transaction.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(p_paymob_transaction_id);
  SELECT * INTO v_payment FROM public.payments WHERE paymob_order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.paymob_apply_debt_settlement(
      p_paymob_transaction_id, p_order_id, p_integration_id, p_currency,
      p_success, p_pending, p_amount_cents, p_provider_ref
    );
  END IF;
  IF v_payment.payment_method_code IS DISTINCT FROM 'paymob'
     OR v_payment.payment_method_type IS DISTINCT FROM 'online'
     OR v_payment.paymob_integration_id IS DISTINCT FROM p_integration_id
     OR v_payment.currency IS DISTINCT FROM p_currency
     OR p_amount_cents IS NULL OR ROUND(v_payment.amount * 100)::bigint <> p_amount_cents THEN
    RAISE EXCEPTION 'Paymob transaction does not match payment.' USING ERRCODE = '23514';
  END IF;
  v_outcome := CASE WHEN p_pending THEN 'pending' WHEN p_success THEN 'captured' ELSE 'rejected' END;
  v_status := v_outcome::public.payment_status;
  SELECT * INTO v_event FROM public.paymob_webhook_events WHERE paymob_transaction_id = p_paymob_transaction_id;
  IF FOUND THEN
    IF v_event.payment_id IS DISTINCT FROM v_payment.id THEN
      RAISE EXCEPTION 'Paymob transaction already belongs to another payment.' USING ERRCODE = '23514';
    END IF;
    IF v_event.outcome <> 'pending' OR p_pending THEN
      RETURN jsonb_build_object('duplicate', true);
    END IF;
  END IF;
  IF v_payment.status = 'captured' THEN
    RETURN jsonb_build_object('ok', true, 'ignored', true, 'reason', 'already_captured');
  END IF;
  IF p_pending AND v_payment.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', true, 'ignored', true, 'reason', 'already_final');
  END IF;

  IF v_status = 'rejected' AND v_payment.booking_id IS NOT NULL THEN
    PERFORM public.restore_customer_wallet_checkout_debit(v_payment.booking_id);
  END IF;

  v_meta := COALESCE(p_metadata, '{}'::jsonb);

  IF v_status = 'captured' AND v_payment.booking_id IS NOT NULL THEN
    SELECT * INTO v_booking FROM public.bookings WHERE id = v_payment.booking_id FOR SHARE;
    IF FOUND AND v_booking.status::text = 'cancelled' THEN
      v_meta := v_meta || jsonb_build_object(
        'late_capture_on_cancelled_booking', true,
        'late_capture_recorded_at', now()
      );
    ELSIF FOUND AND v_booking.status::text IN ('pending', 'confirmed') THEN
      v_released := COALESCE((v_payment.metadata->>'wallet_checkout_released')::numeric, 0);
      IF v_released > 0 THEN
        v_checkout_total := COALESCE(
          NULLIF((v_payment.metadata->>'checkout_total')::numeric, 0),
          v_payment.amount + COALESCE((v_payment.metadata->>'wallet_applied')::numeric, 0)
        );
        v_shortfall := GREATEST(v_checkout_total - v_payment.amount, 0);
        v_reclaim := LEAST(v_released, v_shortfall);
        IF v_reclaim > 0.01 THEN
          PERFORM public.lock_customer_wallet(v_payment.customer_id);
          SELECT b.available_amount INTO v_available
          FROM public.customer_wallet_balances(v_payment.customer_id) b;
          IF v_reclaim > COALESCE(v_available, 0) + 0.0001 THEN
            RAISE EXCEPTION
              'Late card capture cannot fund the booking: released wallet balance is unavailable.'
              USING ERRCODE = '23514';
          END IF;
          v_key := 'checkout_spend_recapture:' || v_payment.id::text;
          v_entry_id := public.customer_wallet_insert_entry(
            v_payment.customer_id,
            'debit',
            v_reclaim,
            'checkout_spend',
            v_payment.booking_id,
            v_payment.id,
            NULL,
            v_key,
            jsonb_build_object('recapture_after_release', true, 'checkout_total', v_checkout_total)
          );
          IF v_entry_id IS NULL THEN
            RAISE EXCEPTION 'Wallet re-claim failed for late card capture.' USING ERRCODE = '23514';
          END IF;
          v_meta := v_meta || jsonb_build_object(
            'wallet_applied', v_reclaim,
            'wallet_checkout_reclaimed', v_reclaim,
            'wallet_checkout_released', 0
          );
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.paymob_webhook_events(paymob_transaction_id, payment_id, outcome)
  VALUES(p_paymob_transaction_id, v_payment.id, v_outcome)
  ON CONFLICT(paymob_transaction_id) DO UPDATE SET outcome = EXCLUDED.outcome, processed_at = now();
  UPDATE public.payments SET status = v_status, provider_ref = p_provider_ref,
    metadata = COALESCE(metadata, '{}'::jsonb) || v_meta,
    captured_at = CASE WHEN v_status = 'captured' THEN now() ELSE captured_at END,
    reviewed_at = CASE WHEN v_status IN ('captured','rejected') THEN now() ELSE reviewed_at END,
    rejection_reason = CASE WHEN v_status = 'rejected' THEN 'Paymob payment failed or was declined.' ELSE NULL END
  WHERE id = v_payment.id;
  RETURN jsonb_build_object('ok', true, 'payment_id', v_payment.id, 'status', v_status, 'outcome', v_outcome);
END;
$$;

NOTIFY pgrst, 'reload schema';