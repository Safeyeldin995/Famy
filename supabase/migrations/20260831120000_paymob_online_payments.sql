-- Paymob online gateway: webhook idempotency + capture exemption + RPC apply.

CREATE TABLE IF NOT EXISTS public.paymob_webhook_events (
  paymob_transaction_id bigint PRIMARY KEY,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('captured', 'rejected', 'pending', 'ignored')),
  processed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.paymob_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paymob_webhook_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_validate_payment_capture()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking_status public.booking_status;
BEGIN
  IF NEW.status = 'captured' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'captured') THEN
    -- Paymob online payments are verified by Paymob's signed webhook, not manual admin review.
    IF COALESCE(NEW.payment_method_code, '') = 'paymob'
       AND COALESCE(NEW.payment_method_type, '') = 'online' THEN
      RETURN NEW;
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
BEGIN
  IF p_paymob_transaction_id IS NULL OR p_paymob_transaction_id <= 0 THEN
    RAISE EXCEPTION 'Invalid Paymob transaction id' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.paymob_webhook_events e
    WHERE e.paymob_transaction_id = p_paymob_transaction_id
  ) THEN
    RETURN jsonb_build_object('duplicate', true);
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
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

  INSERT INTO public.paymob_webhook_events (paymob_transaction_id, payment_id, outcome)
  VALUES (p_paymob_transaction_id, p_payment_id, v_outcome);

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

REVOKE ALL ON FUNCTION public.paymob_apply_transaction_webhook(bigint, uuid, boolean, boolean, bigint, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paymob_apply_transaction_webhook(bigint, uuid, boolean, boolean, bigint, text, jsonb)
  TO service_role;
