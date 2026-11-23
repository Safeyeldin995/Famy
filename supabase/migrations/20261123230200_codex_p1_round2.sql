-- Codex P1 round 2 (post 47688ba): wallet checkout parity, fee totals, payout double-hold, debit reversal

ALTER TABLE public.customer_wallet_entries
  DROP CONSTRAINT IF EXISTS customer_wallet_entries_reason_check;
ALTER TABLE public.customer_wallet_entries
  ADD CONSTRAINT customer_wallet_entries_reason_check CHECK (reason IN (
    'provider_cancelled',
    'customer_cancelled_refund',
    'admin_credit',
    'admin_debit',
    'checkout_spend',
    'checkout_release'
  ));

CREATE OR REPLACE FUNCTION public.payment_checkout_funded_total(p_pay public.payments)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF((p_pay.metadata->>'checkout_total')::numeric, 0),
    p_pay.amount + COALESCE((p_pay.metadata->>'wallet_applied')::numeric, 0),
    p_pay.amount,
    0::numeric
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
    PERFORM public.customer_wallet_insert_entry(
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
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_customer_wallet_checkout_debit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_customer_wallet_checkout_debit(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_customer_wallet_to_booking_payment(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_wallet numeric;
  v_card numeric;
  v_captured boolean;
BEGIN
  v_result := public.customer_apply_wallet_at_checkout(p_payment_id);
  v_wallet := COALESCE((v_result->>'wallet_spent')::numeric, 0);
  v_card := COALESCE((v_result->>'card_amount')::numeric, 0);
  v_captured := COALESCE((v_result->>'paid_via_wallet_only')::boolean, false)
    OR v_card <= 0.01;
  RETURN v_result
    || jsonb_build_object(
      'captured', v_captured,
      'wallet_spend', v_wallet,
      'card_due', v_card
    );
END;
$$;

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

  v_funded := public.payment_checkout_funded_total(v_pay);
  v_fee := LEAST(public.booking_cancellation_fee(p_booking_id), v_funded);
  v_credit := GREATEST(v_funded - v_fee, 0);

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
      jsonb_build_object('cancellation_fee', v_fee, 'funded_total', v_funded)
    );

    IF v_entry_id IS NOT NULL THEN
      PERFORM set_config('app.wallet_checkout_adjust', 'on', true);
      UPDATE public.payments
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'refund_settled_via_wallet', true,
        'refund_settled_at', now(),
        'wallet_refund_portion', v_credit,
        'cancellation_fee', v_fee
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
      COALESCE(v_pay.payment_method_code, v_pay.payment_method_type),
      NULL,
      NULL,
      NULL
    );
  END IF;

  RETURN v_entry_id;
END;
$$;

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

  IF v_role = 'provider' AND public.booking_money_held(p_booking_id) THEN
    PERFORM public.credit_customer_wallet_provider_cancelled(p_booking_id);
  ELSIF v_role = 'customer' THEN
    IF NOT public.booking_money_held(p_booking_id) THEN
      PERFORM public.restore_customer_wallet_checkout_debit(p_booking_id);
    ELSIF COALESCE(v_booking.service_mode, 'in_person') = 'online' THEN
      PERFORM public.credit_customer_wallet_customer_cancelled(p_booking_id);
    END IF;
  END IF;

  RETURN v_cancellation_id;
END;
$$;

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
  v_id := public.ledger_insert_entry(
    p_provider_id, NULL, 'payout_sent', 'debit', p_amount,
    'manual_transfer', concat('ref:', btrim(p_reference), ' ', coalesce(btrim(p_note), '')), auth.uid(), NULL
  );
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_record_payment_refund(
  p_payment_id uuid,
  p_reference text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay public.payments%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_fee numeric;
  v_carried numeric;
  v_method text;
  v_customer_id uuid;
  v_funded numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_reference IS NULL OR btrim(p_reference) = '' THEN
    RAISE EXCEPTION 'Refund reference is required' USING ERRCODE = '23514';
  END IF;

  SELECT b.customer_id INTO v_customer_id
  FROM public.payments p
  JOIN public.bookings b ON b.id = p.booking_id
  WHERE p.id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.lock_customer_debts(v_customer_id);

  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  SELECT * INTO v_booking FROM public.bookings b WHERE b.id = v_pay.booking_id;

  IF COALESCE((v_pay.metadata->>'refund_settled_via_wallet')::boolean, false)
     OR COALESCE(v_pay.metadata->>'wallet_refund_settled', 'false') = 'true' THEN
    RAISE EXCEPTION 'Refund already settled via customer wallet.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.customer_wallet_entries e
    WHERE e.payment_id = p_payment_id
      AND e.reason IN ('provider_cancelled', 'customer_cancelled_refund')
  ) THEN
    RAISE EXCEPTION 'Refund already settled via customer wallet.' USING ERRCODE = '23514';
  END IF;

  IF v_booking.status::text NOT IN ('cancelled', 'no_show') THEN
    RAISE EXCEPTION 'Refunds are recorded only for cancelled or no-show bookings' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (v_pay.status = 'captured' AND COALESCE(v_pay.payment_method_type, '') IN ('online', 'manual_transfer'))
    OR (v_pay.status = 'pending_review' AND v_pay.payment_method_type = 'manual_transfer'
        AND v_pay.proof_path IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'This payment has no money to refund' USING ERRCODE = '23514';
  END IF;
  v_method := COALESCE(v_pay.payment_method_code, v_pay.payment_method_type);
  v_funded := public.payment_checkout_funded_total(v_pay);

  v_carried := LEAST(public.settle_carried_fees(v_booking.id, v_method, auth.uid()), v_funded);

  v_fee := LEAST(public.booking_cancellation_fee(v_booking.id), v_funded - v_carried);
  IF EXISTS (SELECT 1 FROM public.customer_debts d WHERE d.booking_id = v_booking.id AND d.status = 'paid') THEN
    v_fee := 0;
  ELSIF EXISTS (
    SELECT 1 FROM public.customer_debts d
    JOIN public.bookings cb ON cb.id = d.carried_booking_id
    WHERE d.booking_id = v_booking.id AND d.status = 'open'
      AND cb.status::text NOT IN ('cancelled', 'no_show', 'completed')
  ) THEN
    v_fee := 0;
  ELSE
    UPDATE public.customer_debts
    SET status = 'waived', resolved_at = now(), resolved_by = auth.uid(),
        resolution_note = 'Deducted from the refund'
    WHERE booking_id = v_booking.id AND status = 'open';
  END IF;

  PERFORM set_config('app.audit_reason', 'Refund recorded: ' || btrim(p_reference), true);
  PERFORM set_config('app.ledger_internal_capture', 'on', true);
  UPDATE public.payments
  SET status = CASE WHEN v_fee + v_carried > 0 THEN 'partially_refunded'::public.payment_status
                    ELSE 'refunded'::public.payment_status END,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'refund', jsonb_build_object(
          'reference', btrim(p_reference),
          'amount_refunded', v_funded - v_fee - v_carried,
          'cancellation_fee', v_fee,
          'carried_fees', v_carried,
          'funded_total', v_funded,
          'recorded_at', now(),
          'recorded_by', auth.uid(),
          'previous_status', v_pay.status
        )
      )
  WHERE id = p_payment_id;
  PERFORM set_config('app.ledger_internal_capture', 'off', true);

  IF v_fee > 0 THEN
    PERFORM public.ledger_insert_entry(
      v_booking.provider_id, v_booking.id, 'cancellation_fee_provider_share', 'credit', v_fee,
      v_method, NULL, auth.uid(), NULL
    );
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';