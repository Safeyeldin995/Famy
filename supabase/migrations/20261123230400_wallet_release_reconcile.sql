-- Codex P1: after wallet checkout release, late card capture must not refund restored wallet funds.

CREATE OR REPLACE FUNCTION public.payment_checkout_funded_total(p_pay public.payments)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(
    COALESCE(
      NULLIF((p_pay.metadata->>'checkout_total')::numeric, 0),
      p_pay.amount + COALESCE((p_pay.metadata->>'wallet_applied')::numeric, 0),
      p_pay.amount,
      0::numeric
    ) - COALESCE((p_pay.metadata->>'wallet_checkout_released')::numeric, 0),
    COALESCE(p_pay.amount, 0)
  );
$$;

CREATE OR REPLACE FUNCTION public.restore_customer_wallet_checkout_debit(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay record;
  v_spend numeric;
  v_key text;
  v_reverse_key text;
  v_booking public.bookings%ROWTYPE;
  v_entry_id uuid;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  PERFORM public.lock_customer_wallet(v_booking.customer_id);

  FOR v_pay IN
    SELECT id, customer_id, metadata
    FROM public.payments
    WHERE booking_id = p_booking_id
      AND status = 'pending'
  LOOP
    v_spend := COALESCE(
      (v_pay.metadata->>'wallet_applied')::numeric,
      (v_pay.metadata->'wallet_checkout'->>'wallet_spent')::numeric,
      (v_pay.metadata->>'wallet_checkout_spend')::numeric,
      0
    );
    IF v_spend <= 0 THEN
      CONTINUE;
    END IF;

    v_key := 'checkout_spend:' || v_pay.id::text;
    IF NOT EXISTS (
      SELECT 1 FROM public.customer_wallet_entries e
      WHERE e.idempotency_key = v_key AND e.direction = 'debit'
    ) THEN
      CONTINUE;
    END IF;

    v_reverse_key := 'checkout_release:' || v_pay.id::text;
    v_entry_id := public.customer_wallet_insert_entry(
      v_booking.customer_id,
      'credit',
      v_spend,
      'checkout_release',
      p_booking_id,
      v_pay.id,
      NULL,
      v_reverse_key,
      jsonb_build_object('reason', 'unpaid_checkout_cancelled')
    );

    IF v_entry_id IS NOT NULL THEN
      PERFORM set_config('app.wallet_checkout_adjust', 'on', true);
      UPDATE public.payments
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'wallet_checkout_released', v_spend,
        'wallet_checkout_released_at', now()
      )
      WHERE id = v_pay.id;
      PERFORM set_config('app.wallet_checkout_adjust', 'off', true);
    END IF;
  END LOOP;
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

  v_meta := COALESCE(p_metadata, '{}'::jsonb);
  IF v_status = 'captured' AND v_payment.booking_id IS NOT NULL THEN
    SELECT * INTO v_booking FROM public.bookings WHERE id = v_payment.booking_id;
    IF FOUND AND v_booking.status::text = 'cancelled' THEN
      v_meta := v_meta || jsonb_build_object(
        'late_capture_on_cancelled_booking', true,
        'late_capture_recorded_at', now()
      );
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