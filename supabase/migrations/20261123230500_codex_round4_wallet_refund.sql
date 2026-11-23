-- Codex round 4: carried fees on wallet cancel refund, refund breakdown funded total, rejected checkout retry.

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
      AND status IN ('pending', 'rejected')
      AND COALESCE((metadata->>'wallet_checkout_released')::numeric, 0) <= 0.009
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

CREATE OR REPLACE FUNCTION public.customer_release_booking_checkout_wallet(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_customer_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  SELECT customer_id INTO v_customer_id FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_customer_id <> v_uid AND NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.restore_customer_wallet_checkout_debit(p_booking_id);
END;
$$;

REVOKE ALL ON FUNCTION public.customer_release_booking_checkout_wallet(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_release_booking_checkout_wallet(uuid) TO authenticated;

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

  v_method := COALESCE(v_pay.payment_method_code, v_pay.payment_method_type);
  v_funded := public.payment_checkout_funded_total(v_pay);
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

CREATE OR REPLACE FUNCTION public.admin_payment_refund_breakdown(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay public.payments%ROWTYPE;
  v_carried numeric;
  v_fee numeric;
  v_funded numeric;
  v_booking_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found' USING ERRCODE = 'P0002';
  END IF;
  v_booking_id := v_pay.booking_id;
  v_funded := public.payment_checkout_funded_total(v_pay);
  SELECT LEAST(COALESCE(sum(d.amount), 0), v_funded) INTO v_carried
  FROM public.customer_debts d
  WHERE d.carried_booking_id = v_booking_id AND d.status = 'open';
  IF EXISTS (SELECT 1 FROM public.customer_debts d WHERE d.booking_id = v_booking_id AND d.status = 'paid') THEN
    v_fee := 0;
  ELSIF EXISTS (
    SELECT 1 FROM public.customer_debts d
    JOIN public.bookings cb ON cb.id = d.carried_booking_id
    WHERE d.booking_id = v_booking_id AND d.status = 'open'
      AND cb.status::text NOT IN ('cancelled', 'no_show', 'completed')
  ) THEN
    v_fee := 0;
  ELSE
    v_fee := LEAST(public.booking_cancellation_fee(v_booking_id), v_funded - v_carried);
  END IF;
  RETURN jsonb_build_object(
    'paid', v_funded,
    'fee', v_fee,
    'carried', v_carried,
    'refund', v_funded - v_fee - v_carried
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