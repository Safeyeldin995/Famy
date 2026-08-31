-- CodeRabbit hardening for Paymob online payments (QA may already have 20260831120000).

CREATE OR REPLACE FUNCTION public.tg_validate_payment_capture()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking_status public.booking_status;
BEGIN
  IF NEW.status = 'captured' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'captured') THEN
    IF COALESCE(NEW.payment_method_code, '') = 'paymob'
       AND COALESCE(NEW.payment_method_type, '') = 'online' THEN
      IF EXISTS (
        SELECT 1
        FROM public.paymob_webhook_events e
        WHERE e.payment_id = NEW.id
          AND e.outcome = 'captured'
      ) THEN
        RETURN NEW;
      END IF;
    END IF;

    SELECT status INTO v_booking_status FROM public.bookings WHERE id = NEW.booking_id;
    IF v_booking_status IS DISTINCT FROM 'completed' THEN
      RAISE EXCEPTION 'Payment cannot be captured until the booking is completed (current booking status: %)', v_booking_status
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.paymob_reserve_checkout(p_payment_id uuid)
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
BEGIN
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
  v_checkout_url := NULLIF(v_metadata->>'paymob_checkout_url', '');
  v_intention_id := COALESCE(NULLIF(v_metadata->>'paymob_intention_id', ''), NULLIF(v_payment.provider_ref, ''));

  IF v_checkout_url IS NOT NULL AND v_intention_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'reused', true,
      'checkout_url', v_checkout_url,
      'payment_id', p_payment_id
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
    'paymob_checkout_reserved_at', to_jsonb(now())#>>'{}'
  )
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'reused', false,
    'payment_id', p_payment_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.paymob_store_checkout_intention(
  p_payment_id uuid,
  p_intention_id text,
  p_checkout_url text,
  p_extra_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.payments
  SET
    provider_ref = p_intention_id,
    metadata = (
      COALESCE(metadata, '{}'::jsonb)
      - 'paymob_checkout_reservation'
      || jsonb_build_object(
        'paymob_intention_id', p_intention_id,
        'paymob_checkout_url', p_checkout_url,
        'paymob_checkout_started_at', to_jsonb(now())#>>'{}'
      )
      || COALESCE(p_extra_metadata, '{}'::jsonb)
    )
  WHERE id = p_payment_id
    AND status = 'pending';
END;
$$;

-- Clears a reservation left behind when Paymob's intention succeeded but
-- persisting it locally failed, so the payment doesn't sit blocked for the
-- full 15-minute reservation window before a retry is allowed.
CREATE OR REPLACE FUNCTION public.paymob_release_checkout_reservation(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.payments
  SET metadata = COALESCE(metadata, '{}'::jsonb)
    - 'paymob_checkout_reservation'
    - 'paymob_checkout_reserved_at'
  WHERE id = p_payment_id
    AND status = 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.paymob_apply_transaction_webhook(
  p_paymob_transaction_id bigint,
  p_payment_id uuid,
  p_success boolean,
  p_pending boolean,
  p_amount_cents bigint,
  p_provider_ref text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_expected_cents bigint;
  v_outcome text;
  v_new_status public.payment_status;
  v_inserted boolean := false;
  v_ignored_reason text;
BEGIN
  IF p_paymob_transaction_id IS NULL OR p_paymob_transaction_id <= 0 THEN
    RAISE EXCEPTION 'Invalid Paymob transaction id' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found for Paymob webhook' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_payment.payment_method_code, '') <> 'paymob'
     OR COALESCE(v_payment.payment_method_type, '') <> 'online' THEN
    RAISE EXCEPTION 'Payment is not a Paymob online payment' USING ERRCODE = '42501';
  END IF;

  v_expected_cents := ROUND(v_payment.amount * 100)::bigint;
  IF ABS(v_expected_cents - p_amount_cents) > 1 THEN
    RAISE EXCEPTION 'Paymob amount mismatch for payment %', p_payment_id USING ERRCODE = '23514';
  END IF;

  IF p_pending THEN
    v_outcome := 'pending';
    v_new_status := 'pending';
  ELSIF p_success THEN
    v_outcome := 'captured';
    v_new_status := 'captured';
  ELSE
    v_outcome := 'rejected';
    v_new_status := 'rejected';
  END IF;

  IF v_payment.status = 'captured' THEN
    v_ignored_reason := 'already_captured';
  ELSIF v_payment.status = 'rejected' AND v_new_status <> 'rejected' THEN
    v_ignored_reason := 'already_rejected';
  END IF;

  INSERT INTO public.paymob_webhook_events (paymob_transaction_id, payment_id, outcome)
  VALUES (
    p_paymob_transaction_id,
    p_payment_id,
    CASE WHEN v_ignored_reason IS NOT NULL THEN 'ignored' ELSE v_outcome END
  )
  ON CONFLICT (paymob_transaction_id) DO NOTHING
  RETURNING true INTO v_inserted;

  IF NOT COALESCE(v_inserted, false) THEN
    RETURN jsonb_build_object('duplicate', true);
  END IF;

  IF v_ignored_reason IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'ignored', true,
      'reason', v_ignored_reason,
      'payment_id', p_payment_id,
      'status', v_payment.status
    );
  END IF;

  UPDATE public.payments
  SET
    status = v_new_status,
    provider_ref = COALESCE(NULLIF(p_provider_ref, ''), provider_ref),
    metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
    captured_at = CASE WHEN v_new_status = 'captured' THEN now() ELSE captured_at END,
    reviewed_at = CASE WHEN v_new_status IN ('captured', 'rejected') THEN now() ELSE reviewed_at END,
    rejection_reason = CASE WHEN v_new_status = 'rejected' THEN 'Paymob payment failed or was declined.' ELSE rejection_reason END
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'ok', true,
    'payment_id', p_payment_id,
    'status', v_new_status,
    'outcome', v_outcome
  );
END;
$$;

REVOKE ALL ON FUNCTION public.paymob_reserve_checkout(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paymob_store_checkout_intention(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paymob_release_checkout_reservation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paymob_reserve_checkout(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.paymob_store_checkout_intention(uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.paymob_release_checkout_reservation(uuid) TO service_role;
