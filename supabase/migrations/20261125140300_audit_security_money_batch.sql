-- Audit batch: provider payment privacy (#454), late capture shortfall (#451),
-- refund/void webhook flag (#452), account deletion funds + payout wipe (#453),
-- admin paymobNeedsAction queue, wallet adjust idempotency (#472).

-- ---------------------------------------------------------------------------
-- #454 Provider payment privacy
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "payment_proofs_provider_read" ON storage.objects;
DROP POLICY IF EXISTS payment_proofs_provider_read ON storage.objects;

DROP POLICY IF EXISTS payments_provider_read ON public.payments;

CREATE TABLE IF NOT EXISTS public.payment_paymob_checkout (
  payment_id uuid PRIMARY KEY REFERENCES public.payments(id) ON DELETE CASCADE,
  checkout_url text,
  client_secret text,
  intention_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_paymob_checkout ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.payment_paymob_checkout FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.payment_paymob_checkout TO authenticated;
GRANT ALL ON TABLE public.payment_paymob_checkout TO service_role;

DROP POLICY IF EXISTS payment_paymob_checkout_customer_select ON public.payment_paymob_checkout;
CREATE POLICY payment_paymob_checkout_customer_select
  ON public.payment_paymob_checkout
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.payments p
      WHERE p.id = payment_paymob_checkout.payment_id
        AND p.customer_id = (SELECT auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.paymob_store_checkout_intention(
  p_payment_id uuid,
  p_intention_id text,
  p_checkout_url text,
  p_order_id bigint,
  p_integration_id bigint,
  p_extra_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_extra jsonb;
  v_client_secret text;
BEGIN
  IF p_order_id IS NULL OR p_order_id <= 0 OR p_integration_id IS NULL OR p_integration_id <= 0 THEN
    RAISE EXCEPTION 'Invalid Paymob order binding.' USING ERRCODE = '22023';
  END IF;

  v_extra := COALESCE(p_extra_metadata, '{}'::jsonb);
  v_client_secret := NULLIF(v_extra->>'paymob_client_secret', '');
  v_extra := v_extra - 'paymob_client_secret' - 'paymob_checkout_url';

  UPDATE public.payments SET
    paymob_order_id = p_order_id,
    paymob_integration_id = p_integration_id,
    provider_ref = p_intention_id,
    metadata = (
      COALESCE(metadata, '{}'::jsonb)
      - 'paymob_checkout_reservation'
      - 'paymob_checkout_url'
      - 'paymob_client_secret'
    ) || v_extra || jsonb_build_object(
      'paymob_intention_id', p_intention_id,
      'paymob_checkout_started_at', now()
    )
  WHERE id = p_payment_id
    AND status = 'pending'
    AND payment_method_code = 'paymob'
    AND payment_method_type = 'online'
    AND (paymob_order_id IS NULL OR paymob_order_id = p_order_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paymob order binding could not be stored.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.payment_paymob_checkout (
    payment_id, checkout_url, client_secret, intention_id, updated_at
  ) VALUES (
    p_payment_id,
    NULLIF(p_checkout_url, ''),
    v_client_secret,
    NULLIF(p_intention_id, ''),
    now()
  )
  ON CONFLICT (payment_id) DO UPDATE SET
    checkout_url = COALESCE(EXCLUDED.checkout_url, public.payment_paymob_checkout.checkout_url),
    client_secret = COALESCE(EXCLUDED.client_secret, public.payment_paymob_checkout.client_secret),
    intention_id = COALESCE(EXCLUDED.intention_id, public.payment_paymob_checkout.intention_id),
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.paymob_reserve_checkout(
  p_payment_id uuid,
  p_channel text DEFAULT 'card'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_metadata jsonb;
  v_checkout_url text;
  v_intention_id text;
  v_reserved_at timestamptz;
  v_channel text;
BEGIN
  v_channel := COALESCE(NULLIF(trim(p_channel), ''), 'card');
  IF v_channel NOT IN ('card', 'apple_pay', 'google_pay') THEN
    RAISE EXCEPTION 'Invalid Paymob checkout channel.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found for Paymob checkout' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_payment.payment_method_code, '') <> 'paymob'
     OR COALESCE(v_payment.payment_method_type, '') <> 'online' THEN
    RAISE EXCEPTION 'Payment is not a Paymob online payment' USING ERRCODE = '42501';
  END IF;

  IF v_payment.status = 'captured' THEN
    RAISE EXCEPTION 'This payment is already completed.' USING ERRCODE = '42501';
  END IF;
  IF v_payment.status = 'rejected' THEN
    RAISE EXCEPTION 'This payment was rejected. Start a new booking payment if needed.' USING ERRCODE = '42501';
  END IF;
  IF v_payment.status <> 'pending' THEN
    RAISE EXCEPTION 'Payment is not pending checkout' USING ERRCODE = '42501';
  END IF;

  v_metadata := COALESCE(v_payment.metadata, '{}'::jsonb);

  SELECT NULLIF(c.checkout_url, ''), NULLIF(c.intention_id, '')
  INTO v_checkout_url, v_intention_id
  FROM public.payment_paymob_checkout c
  WHERE c.payment_id = p_payment_id;

  -- One-release fallback for checkouts stored in metadata before this table existed.
  IF v_checkout_url IS NULL THEN
    v_checkout_url := NULLIF(v_metadata->>'paymob_checkout_url', '');
  END IF;
  IF v_intention_id IS NULL THEN
    v_intention_id := COALESCE(
      NULLIF(v_metadata->>'paymob_intention_id', ''),
      NULLIF(v_payment.provider_ref, '')
    );
  END IF;

  IF v_checkout_url IS NOT NULL AND v_intention_id IS NOT NULL THEN
    IF v_payment.paymob_order_id IS NULL OR v_payment.paymob_integration_id IS NULL THEN
      RAISE EXCEPTION 'Existing Paymob checkout requires trusted order reconciliation.' USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object(
      'reused', true,
      'checkout_url', v_checkout_url,
      'payment_id', p_payment_id,
      'channel', COALESCE(NULLIF(v_metadata->>'channel', ''), v_channel)
    );
  END IF;

  v_reserved_at := NULLIF(v_metadata->>'paymob_checkout_reserved_at', '')::timestamptz;
  IF (v_metadata ? 'paymob_checkout_reservation')
     AND v_reserved_at IS NOT NULL
     AND v_reserved_at > now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'Paymob checkout is already in progress for this payment' USING ERRCODE = '55000';
  END IF;

  UPDATE public.payments
  SET metadata = v_metadata || jsonb_build_object(
    'paymob_checkout_reservation', gen_random_uuid()::text,
    'paymob_checkout_reserved_at', to_jsonb(now())#>>'{}',
    'channel', v_channel,
    'paymob_checkout_channel', v_channel
  )
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'reused', false,
    'payment_id', p_payment_id,
    'channel', v_channel
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.provider_booking_payment(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  IF p_booking_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.bookings b
       JOIN public.providers pr ON pr.id = b.provider_id
       WHERE b.id = p_booking_id
         AND pr.profile_id = v_uid
     ) THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT jsonb_build_object(
    'id', p.id,
    'booking_id', p.booking_id,
    'status', p.status,
    'amount', p.amount,
    'currency', p.currency,
    'payment_method_type', p.payment_method_type,
    'method', p.method,
    'payment_method_code', p.payment_method_code,
    'captured_at', p.captured_at,
    'reviewed_at', p.reviewed_at,
    'rejection_reason', p.rejection_reason,
    'payment_method_name_en', p.payment_method_name_en,
    'payment_method_name_ar', p.payment_method_name_ar,
    'has_proof', (p.proof_path IS NOT NULL)
  )
  INTO v_result
  FROM public.payments p
  WHERE p.booking_id = p_booking_id
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_booking_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_booking_payment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.provider_review_manual_payment(
  p_payment_id uuid,
  p_action text,
  p_rejection_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pay public.payments%ROWTYPE;
  v_booking_status public.booking_status;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('capture', 'reject') THEN
    RAISE EXCEPTION 'Invalid payment review action.' USING ERRCODE = '23514';
  END IF;

  SELECT p.* INTO v_pay
  FROM public.payments p
  WHERE p.id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.providers pr ON pr.id = b.provider_id
    WHERE b.id = v_pay.booking_id
      AND pr.profile_id = v_uid
  ) AND NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Payment review not authorized.' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_pay.payment_method_type, '') = 'online'
     OR COALESCE(v_pay.payment_method_code, '') = 'paymob'
     OR v_pay.method::text = 'paymob' THEN
    RAISE EXCEPTION 'Online payments can only be updated by the payment gateway.' USING ERRCODE = '42501';
  END IF;

  IF v_pay.status NOT IN ('pending', 'pending_review') THEN
    RAISE EXCEPTION 'Payment is not awaiting review.' USING ERRCODE = '23514';
  END IF;

  SELECT b.status INTO v_booking_status
  FROM public.bookings b
  WHERE b.id = v_pay.booking_id;

  IF p_action = 'capture' THEN
    IF v_booking_status::text <> 'completed' THEN
      RAISE EXCEPTION 'Payment cannot be captured until the booking is completed.' USING ERRCODE = '23514';
    END IF;
    UPDATE public.payments
    SET
      status = 'captured',
      captured_at = now(),
      reviewed_at = now(),
      reviewed_by = v_uid,
      rejection_reason = NULL
    WHERE id = p_payment_id;
  ELSE
    UPDATE public.payments
    SET
      status = 'rejected',
      captured_at = NULL,
      reviewed_at = now(),
      reviewed_by = v_uid,
      rejection_reason = NULLIF(btrim(p_rejection_reason), '')
    WHERE id = p_payment_id;
  END IF;

  RETURN jsonb_build_object(
    'payment_id', p_payment_id,
    'status', (SELECT status::text FROM public.payments WHERE id = p_payment_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.provider_review_manual_payment(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_review_manual_payment(uuid, text, text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.paymob_unmapped_captures (
  paymob_transaction_id bigint PRIMARY KEY,
  paymob_order_id bigint NOT NULL,
  paymob_integration_id bigint,
  currency text,
  amount_cents bigint,
  provider_ref text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconciled_payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  reconciled_at timestamptz,
  needs_admin_review boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paymob_unmapped_captures_order
  ON public.paymob_unmapped_captures (paymob_order_id)
  WHERE reconciled_payment_id IS NULL;

CREATE INDEX IF NOT EXISTS paymob_unmapped_captures_reconciled_payment_id_idx
  ON public.paymob_unmapped_captures (reconciled_payment_id);

ALTER TABLE public.paymob_unmapped_captures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.paymob_unmapped_captures FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.paymob_unmapped_captures TO service_role;

CREATE OR REPLACE FUNCTION public.paymob_record_unmapped_capture(
  p_paymob_transaction_id bigint,
  p_order_id bigint,
  p_integration_id bigint,
  p_currency text,
  p_amount_cents bigint,
  p_provider_ref text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_paymob_transaction_id IS NULL OR p_paymob_transaction_id <= 0
     OR p_order_id IS NULL OR p_order_id <= 0 THEN
    RAISE EXCEPTION 'Invalid Paymob unmapped capture.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.paymob_unmapped_captures (
    paymob_transaction_id,
    paymob_order_id,
    paymob_integration_id,
    currency,
    amount_cents,
    provider_ref,
    metadata,
    needs_admin_review
  ) VALUES (
    p_paymob_transaction_id,
    p_order_id,
    p_integration_id,
    p_currency,
    p_amount_cents,
    p_provider_ref,
    COALESCE(p_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'paymob_unmapped', true,
        'needs_admin_review', true,
        'unmapped_order', true
      ),
    true
  )
  ON CONFLICT (paymob_transaction_id) DO UPDATE SET
    paymob_integration_id = EXCLUDED.paymob_integration_id,
    currency = EXCLUDED.currency,
    amount_cents = EXCLUDED.amount_cents,
    provider_ref = EXCLUDED.provider_ref,
    metadata = public.paymob_unmapped_captures.metadata || EXCLUDED.metadata,
    needs_admin_review = true;

  INSERT INTO public.paymob_webhook_events (paymob_transaction_id, payment_id, outcome)
  VALUES (p_paymob_transaction_id, NULL, 'unmapped')
  ON CONFLICT (paymob_transaction_id) DO UPDATE SET
    outcome = EXCLUDED.outcome,
    processed_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'unmapped_order', true,
    'needs_admin_review', true,
    'paymob_transaction_id', p_paymob_transaction_id,
    'paymob_order_id', p_order_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.paymob_record_unmapped_capture(bigint, bigint, bigint, text, bigint, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paymob_record_unmapped_capture(bigint, bigint, bigint, text, bigint, text, jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- #451 Late capture shortfall + unmapped debt-settlement capture
-- ---------------------------------------------------------------------------

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
  v_funding_payment_id uuid;
  v_excess numeric;
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
  UPDATE public.paymob_unmapped_captures u
  SET
    reconciled_payment_id = v_payment.id,
    reconciled_at = now(),
    needs_admin_review = false
  WHERE u.paymob_order_id = p_order_id
    AND u.reconciled_payment_id IS NULL;
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
    IF v_event.payment_id IS NOT NULL AND v_event.payment_id IS DISTINCT FROM v_payment.id THEN
      RAISE EXCEPTION 'Paymob transaction already belongs to another payment.' USING ERRCODE = '23514';
    END IF;
    IF v_event.outcome = 'unmapped' AND v_event.payment_id IS NULL THEN
      NULL;
    ELSIF v_event.outcome <> 'pending' OR p_pending THEN
      RETURN jsonb_build_object('duplicate', true);
    END IF;
  END IF;
  IF v_payment.status = 'captured' THEN
    RETURN jsonb_build_object('ok', true, 'ignored', true, 'reason', 'already_captured');
  END IF;
  IF v_payment.status IN ('refunded', 'partially_refunded') THEN
    RETURN jsonb_build_object('ok', true, 'ignored', true, 'reason', 'already_refunded');
  END IF;
  IF p_pending AND v_payment.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', true, 'ignored', true, 'reason', 'already_final');
  END IF;

  IF v_status = 'rejected' AND v_payment.booking_id IS NOT NULL THEN
    PERFORM public.restore_customer_wallet_checkout_debit(v_payment.booking_id);
  END IF;

  v_meta := COALESCE(p_metadata, '{}'::jsonb);

  IF v_status = 'captured' AND v_payment.booking_id IS NOT NULL THEN
    SELECT p.id INTO v_funding_payment_id
    FROM public.payments p
    WHERE p.booking_id = v_payment.booking_id
      AND p.id <> v_payment.id
      AND p.status = 'captured'
    ORDER BY p.captured_at NULLS LAST, p.created_at
    LIMIT 1;

    IF v_funding_payment_id IS NOT NULL THEN
      v_excess := public.payment_checkout_funded_total(v_payment);
      IF v_excess > 0.01 THEN
        PERFORM public.lock_customer_wallet(v_payment.customer_id);
        v_key := 'paymob_superseded_excess:' || v_payment.id::text;
        v_entry_id := public.customer_wallet_insert_entry(
          v_payment.customer_id,
          'credit',
          v_excess,
          'paymob_superseded_capture',
          v_payment.booking_id,
          v_payment.id,
          NULL,
          v_key,
          jsonb_build_object('funding_payment_id', v_funding_payment_id)
        );
      END IF;
      -- The booking is already funded by another payment: this capture is
      -- settled to the customer's wallet and the row is closed as refunded, so
      -- readers of "the booking's captured payment" (wallet refunds on cancel,
      -- admin card refunds, payment cards) never pick it.
      v_status := 'refunded'::public.payment_status;
      v_meta := v_meta || jsonb_build_object(
        'superseded_capture', true,
        'superseded_by_payment_id', v_funding_payment_id,
        'excluded_from_booking_funding', true,
        'superseded_excess_credited', GREATEST(v_excess, 0),
        'refund_settled_via_wallet', true,
        'wallet_refund_settled', true,
        'refund', jsonb_build_object(
          'channel', 'customer_wallet',
          'amount_refunded', GREATEST(v_excess, 0),
          'wallet_entry_id', v_entry_id,
          'recorded_at', now()
        )
      );
    ELSE
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
              v_meta := v_meta || jsonb_build_object(
                'capture_shortfall', v_reclaim,
                'capture_shortfall_recorded_at', now(),
                'needs_admin_review', true
              );
            ELSE
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
                v_meta := v_meta || jsonb_build_object(
                  'capture_shortfall', v_reclaim,
                  'capture_shortfall_recorded_at', now(),
                  'needs_admin_review', true
                );
              ELSE
                v_meta := v_meta || jsonb_build_object(
                  'wallet_applied', v_reclaim,
                  'wallet_checkout_reclaimed', v_reclaim,
                  'wallet_checkout_released', 0
                );
              END IF;
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.paymob_webhook_events(paymob_transaction_id, payment_id, outcome)
  VALUES(p_paymob_transaction_id, v_payment.id, v_outcome)
  ON CONFLICT(paymob_transaction_id) DO UPDATE SET
    outcome = EXCLUDED.outcome,
    payment_id = EXCLUDED.payment_id,
    processed_at = now();
  UPDATE public.payments SET status = v_status, provider_ref = p_provider_ref,
    metadata = COALESCE(metadata, '{}'::jsonb) || v_meta,
    captured_at = CASE WHEN v_outcome = 'captured' THEN now() ELSE captured_at END,
    reviewed_at = CASE WHEN v_outcome IN ('captured','rejected') THEN now() ELSE reviewed_at END,
    rejection_reason = CASE WHEN v_status = 'rejected' THEN 'Paymob payment failed or was declined.' ELSE NULL END
  WHERE id = v_payment.id;
  RETURN jsonb_build_object(
    'ok', true,
    'payment_id', v_payment.id,
    'status', v_status,
    'outcome', v_outcome,
    'superseded_capture', v_funding_payment_id IS NOT NULL AND v_outcome = 'captured'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.paymob_apply_debt_settlement(
  p_paymob_transaction_id bigint, p_order_id bigint, p_integration_id bigint, p_currency text,
  p_success boolean, p_pending boolean, p_amount_cents bigint, p_provider_ref text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s public.customer_debt_settlements%ROWTYPE;
  v_customer_id uuid;
BEGIN
  SELECT customer_id INTO v_customer_id
  FROM public.customer_debt_settlements
  WHERE paymob_order_id = p_order_id;
  IF NOT FOUND THEN
    IF COALESCE(p_success, false) AND NOT COALESCE(p_pending, true) THEN
      RETURN public.paymob_record_unmapped_capture(
        p_paymob_transaction_id,
        p_order_id,
        p_integration_id,
        p_currency,
        p_amount_cents,
        p_provider_ref,
        jsonb_build_object('debt_settlement_unmapped', true)
      );
    END IF;
    RAISE EXCEPTION 'Trusted Paymob order mapping not found.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.lock_customer_debts(v_customer_id);

  SELECT * INTO v_s FROM public.customer_debt_settlements WHERE paymob_order_id = p_order_id FOR UPDATE;
  IF v_s.method <> 'card' OR v_s.paymob_integration_id IS DISTINCT FROM p_integration_id
     OR v_s.currency IS DISTINCT FROM p_currency
     OR p_amount_cents IS NULL OR ROUND(v_s.amount * 100)::bigint <> p_amount_cents THEN
    RAISE EXCEPTION 'Paymob transaction does not match settlement.' USING ERRCODE = '23514';
  END IF;
  IF v_s.status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'ignored', true, 'reason', 'already_paid');
  END IF;
  IF p_pending THEN
    RETURN jsonb_build_object('ok', true, 'ignored', true, 'reason', 'pending');
  END IF;
  IF NOT p_success THEN
    UPDATE public.customer_debt_settlements
    SET status = CASE WHEN status = 'pending' THEN 'failed' ELSE status END, updated_at = now()
    WHERE id = v_s.id;
    RETURN jsonb_build_object('ok', true, 'settlement_id', v_s.id, 'status', 'failed');
  END IF;
  UPDATE public.customer_debt_settlements
  SET status = 'paid', paymob_transaction_id = p_paymob_transaction_id, updated_at = now()
  WHERE id = v_s.id;
  PERFORM public.settle_customer_debts(v_s.id, NULL);
  RETURN jsonb_build_object('ok', true, 'settlement_id', v_s.id, 'status', 'paid');
END;
$$;
REVOKE ALL ON FUNCTION public.paymob_apply_debt_settlement(bigint, bigint, bigint, text, boolean, boolean, bigint, text)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- #452 Refund/void webhook (flag only — do not move money or change status)
-- ---------------------------------------------------------------------------

ALTER TABLE public.paymob_webhook_events DROP CONSTRAINT IF EXISTS paymob_webhook_events_outcome_check;
ALTER TABLE public.paymob_webhook_events
  ADD CONSTRAINT paymob_webhook_events_outcome_check
  CHECK (outcome IN ('captured', 'rejected', 'pending', 'ignored', 'refunded', 'unmapped'));

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

  IF v_reuse_capture
     AND COALESCE(v_payment.metadata->>'gateway_refund_recorded_at', '') <> '' THEN
    RETURN jsonb_build_object('duplicate', true, 'payment_id', v_payment.id);
  END IF;

  v_status := v_payment.status;
  v_meta := COALESCE(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'gateway_refund_recorded_at', now(),
      'gateway_refund_amount_cents', p_amount_cents,
      'gateway_refund_voided', COALESCE(p_is_voided, false),
      'needs_admin_review', true
    );

  UPDATE public.payments
  SET metadata = COALESCE(metadata, '{}'::jsonb) || v_meta
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
    'capture_preserved', v_reuse_capture
  );
END;
$$;

REVOKE ALL ON FUNCTION public.paymob_apply_refund_webhook(bigint, bigint, bigint, boolean, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paymob_apply_refund_webhook(bigint, bigint, bigint, boolean, jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- #453 Account deletion: funds owed to the user + wipe payout methods
-- Wallet forfeit on self-service deletion (PO): explicit confirm debits balance.
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
    'forfeited_on_deletion'
  ));

CREATE OR REPLACE FUNCTION public.account_deletion_has_funds_owed_to_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.providers pv
    JOIN public.provider_ledger_entries e ON e.provider_id = pv.id
    WHERE pv.profile_id = p_user_id
    GROUP BY pv.id
    HAVING SUM(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END) > 0.005
  );
$$;
REVOKE ALL ON FUNCTION public.account_deletion_has_funds_owed_to_user(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.account_deletion_has_active_bookings(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.providers pv ON pv.id = b.provider_id
    WHERE b.deleted_at IS NULL
      AND b.status NOT IN (
        'completed'::public.booking_status,
        'cancelled'::public.booking_status,
        'no_show'::public.booking_status
      )
      AND (b.customer_id = p_user_id OR pv.profile_id = p_user_id)
  )
  OR public.account_deletion_has_unpaid_balance(p_user_id);
$$;
REVOKE ALL ON FUNCTION public.account_deletion_has_active_bookings(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.account_deletion_check()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_wallet numeric;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'admin'::public.app_role
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'admin');
  END IF;

  IF public.account_deletion_has_unpaid_balance(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unpaid_balance');
  END IF;

  IF public.account_deletion_has_funds_owed_to_user(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'funds_owed_to_user');
  END IF;

  IF public.account_deletion_has_active_bookings(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'active_bookings');
  END IF;

  SELECT b.available_amount INTO v_wallet
  FROM public.customer_wallet_balances(v_uid) b;

  IF COALESCE(v_wallet, 0) > 0.005 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'wallet_forfeit_amount', round(v_wallet, 2)
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.account_deletion_check() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_deletion_check() TO authenticated;

DROP FUNCTION IF EXISTS public.anonymize_account(uuid);

CREATE OR REPLACE FUNCTION public.anonymize_account(
  p_user_id uuid,
  p_confirm_wallet_forfeit boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_provider_id uuid;
  v_paths jsonb := '[]'::jsonb;
  v_avatar_path text;
  v_doc record;
  v_deleted_label text;
  v_wallet_available numeric;
  v_wallet_forfeited numeric := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_user' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'admin'::public.app_role
  ) THEN
    RAISE EXCEPTION 'account_deletion_blocked' USING ERRCODE = '42501';
  END IF;

  IF public.account_deletion_has_active_bookings(p_user_id) THEN
    RAISE EXCEPTION 'account_deletion_blocked' USING ERRCODE = '42501';
  END IF;

  PERFORM public.lock_customer_wallet(p_user_id);
  SELECT b.available_amount INTO v_wallet_available
  FROM public.customer_wallet_balances(p_user_id) b;

  IF COALESCE(v_wallet_available, 0) > 0.005 THEN
    IF NOT COALESCE(p_confirm_wallet_forfeit, false) THEN
      RAISE EXCEPTION 'wallet_forfeit_confirm_required' USING ERRCODE = '23514';
    END IF;
    v_wallet_forfeited := v_wallet_available;
    PERFORM public.customer_wallet_insert_entry(
      p_user_id,
      'debit',
      v_wallet_available,
      'forfeited_on_deletion',
      NULL,
      NULL,
      NULL,
      'wallet_forfeit:' || p_user_id::text,
      jsonb_build_object(
        'forfeited_on_account_deletion', true,
        'amount', v_wallet_available
      )
    );
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_profile.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('storage_paths', v_paths);
  END IF;

  v_deleted_label := CASE WHEN COALESCE(v_profile.locale, 'en') = 'ar'
    THEN 'مستخدم محذوف'
    ELSE 'Deleted user'
  END;

  IF v_profile.avatar_url IS NOT NULL AND btrim(v_profile.avatar_url) <> '' AND NOT v_profile.avatar_url ~* '^https?://' THEN
    v_avatar_path := v_profile.avatar_url;
    v_paths := v_paths || jsonb_build_array(jsonb_build_object('bucket', 'avatars', 'path', v_avatar_path));
  END IF;

  SELECT id INTO v_provider_id FROM public.providers WHERE profile_id = p_user_id LIMIT 1;
  IF v_provider_id IS NOT NULL THEN
    FOR v_doc IN
      SELECT storage_path FROM public.provider_documents WHERE provider_id = v_provider_id
    LOOP
      IF v_doc.storage_path IS NOT NULL AND btrim(v_doc.storage_path) <> '' THEN
        v_paths := v_paths || jsonb_build_array(
          jsonb_build_object('bucket', 'provider-documents', 'path', v_doc.storage_path)
        );
      END IF;
    END LOOP;

    DELETE FROM public.provider_documents WHERE provider_id = v_provider_id;
    DELETE FROM public.provider_payout_methods WHERE provider_id = v_provider_id;

    PERFORM set_config('app.onboarding_status_transition', '1', true);

    UPDATE public.providers
    SET
      is_active = false,
      deleted_at = now(),
      bio_en = '',
      bio_ar = '',
      vacation_mode = true,
      updated_at = now()
    WHERE id = v_provider_id;
  END IF;

  PERFORM set_config('famy.account_anonymize', 'on', true);

  UPDATE auth.users
  SET
    email = 'deleted-' || p_user_id::text || '@famio.local',
    phone = NULL,
    phone_confirmed_at = NULL,
    updated_at = now()
  WHERE id = p_user_id;

  UPDATE public.booking_locations bl
  SET
    custom_label = NULL,
    street = NULL,
    building = NULL,
    floor = NULL,
    apartment = NULL,
    compound = NULL,
    landmark = NULL,
    access_notes = NULL,
    lat = NULL,
    lng = NULL
  FROM public.bookings b
  WHERE bl.booking_id = b.id
    AND b.customer_id = p_user_id;

  UPDATE public.booking_family_member_snapshots bfms
  SET
    full_name = v_deleted_label,
    phone = NULL,
    date_of_birth = NULL,
    allergies = NULL,
    medical_notes = NULL,
    access_notes = NULL,
    emergency_contact_name = NULL,
    emergency_contact_phone = NULL,
    relationship_other = NULL
  FROM public.bookings b
  WHERE bfms.booking_id = b.id
    AND b.customer_id = p_user_id;

  DELETE FROM public.addresses WHERE user_id = p_user_id;
  DELETE FROM public.family_members WHERE customer_id = p_user_id;
  DELETE FROM public.device_push_tokens WHERE user_id = p_user_id;
  DELETE FROM public.push_subscriptions WHERE user_id = p_user_id;
  DELETE FROM public.notification_preferences WHERE user_id = p_user_id;

  PERFORM set_config('famy.allow_phone_write', 'on', true);
  UPDATE public.profiles
  SET
    full_name = v_deleted_label,
    phone = NULL,
    phone_verified = false,
    email = NULL,
    avatar_url = NULL,
    deleted_at = now(),
    updated_at = now()
  WHERE id = p_user_id;

  INSERT INTO public.audit_logs (
    actor_id, actor_role, action, entity, entity_id, reason, old_values, new_values
  ) VALUES (
    p_user_id,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'provider'::public.app_role
      ) THEN 'provider'
      ELSE 'customer'
    END,
    'account_anonymized',
    'profiles',
    p_user_id,
    'self_service_account_deletion',
    jsonb_build_object(
      'wallet_balance_forfeited', v_wallet_forfeited
    ),
    jsonb_build_object(
      'deleted', true,
      'wallet_balance_forfeited', v_wallet_forfeited
    )
  );

  RETURN jsonb_build_object('storage_paths', v_paths);
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_account(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_account(uuid, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- Admin queue: paymobNeedsAction
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_payment_situation(text, text, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.admin_payment_situation(text, text, text, text, text, boolean, jsonb);

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
  IF v_tab NOT IN ('refunds_due', 'receipts_ready', 'cash_to_confirm', 'needs_action') THEN
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

  IF v_tab = 'needs_action' THEN
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
-- #472 Wallet idempotency
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_adjust_customer_wallet(uuid, text, numeric, text, uuid);
DROP FUNCTION IF EXISTS public.admin_adjust_customer_wallet(uuid, text, numeric, text, uuid, text);

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

  PERFORM public.lock_customer_debts(p_customer_id);
  PERFORM public.lock_customer_wallet(p_customer_id);

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
  v_key := 'admin_wallet:' || p_customer_id::text || ':' || COALESCE(
    NULLIF(btrim(p_idempotency_key), ''),
    gen_random_uuid()::text
  );

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
-- Admin: resolve Paymob capture flags (shortfall, gateway refund, unmapped)
-- ---------------------------------------------------------------------------

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
    UPDATE public.payments
    SET metadata = (
      COALESCE(metadata, '{}'::jsonb)
      - 'capture_shortfall'
      - 'capture_shortfall_recorded_at'
    ) || v_resolved
    WHERE id = p_payment_id;
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

-- #454 LOW: move legacy checkout secrets out of payments.metadata
INSERT INTO public.payment_paymob_checkout (
  payment_id, checkout_url, client_secret, intention_id, updated_at
)
SELECT
  p.id,
  NULLIF(p.metadata->>'paymob_checkout_url', ''),
  NULLIF(p.metadata->>'paymob_client_secret', ''),
  NULLIF(p.metadata->>'paymob_intention_id', ''),
  now()
FROM public.payments p
WHERE p.status = 'pending'::public.payment_status
  AND p.payment_method_code = 'paymob'
  AND (
    p.metadata ? 'paymob_client_secret'
    OR p.metadata ? 'paymob_checkout_url'
  )
ON CONFLICT (payment_id) DO UPDATE SET
  checkout_url = COALESCE(EXCLUDED.checkout_url, public.payment_paymob_checkout.checkout_url),
  client_secret = COALESCE(EXCLUDED.client_secret, public.payment_paymob_checkout.client_secret),
  intention_id = COALESCE(EXCLUDED.intention_id, public.payment_paymob_checkout.intention_id),
  updated_at = now();

UPDATE public.payments p
SET metadata = metadata - 'paymob_client_secret' - 'paymob_checkout_url'
WHERE p.status = 'pending'::public.payment_status
  AND p.payment_method_code = 'paymob'
  AND (
    p.metadata ? 'paymob_client_secret'
    OR p.metadata ? 'paymob_checkout_url'
  );

NOTIFY pgrst, 'reload schema';
