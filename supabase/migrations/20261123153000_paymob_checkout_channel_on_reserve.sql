-- Persist Paymob wallet/card channel when checkout is reserved so retries keep Apple/Google Pay.

DROP FUNCTION IF EXISTS public.paymob_reserve_checkout(uuid);

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
  v_checkout_url := NULLIF(v_metadata->>'paymob_checkout_url', '');
  v_intention_id := COALESCE(NULLIF(v_metadata->>'paymob_intention_id', ''), NULLIF(v_payment.provider_ref, ''));

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

REVOKE ALL ON FUNCTION public.paymob_reserve_checkout(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paymob_reserve_checkout(uuid, text) TO service_role;