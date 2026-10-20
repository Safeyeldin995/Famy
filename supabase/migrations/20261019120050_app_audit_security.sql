-- App audit: protect suspension and payment writes, bind Paymob callbacks
-- to server-created orders, and permit pending -> final webhook delivery.
-- Deployment order: migration, application checkout code, Edge Function.
-- Existing pending Paymob checkouts without a trusted order mapping require
-- server-side reconciliation; never backfill mappings from client metadata.
BEGIN;

CREATE OR REPLACE FUNCTION public.tg_protect_profile_suspension()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'service_role' OR (auth.uid() IS NULL AND auth.role() IS NULL) THEN RETURN NEW; END IF;
  IF (TG_OP = 'INSERT' AND NEW.is_suspended)
     OR (TG_OP = 'UPDATE' AND NEW.is_suspended IS DISTINCT FROM OLD.is_suspended) THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'Only administrators can change account suspension.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_protect_profile_suspension() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_protect_profile_suspension BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.tg_protect_profile_suspension();

ALTER TABLE public.payments ADD COLUMN paymob_order_id bigint UNIQUE,
  ADD COLUMN paymob_integration_id bigint;

CREATE OR REPLACE FUNCTION public.tg_guard_payment_writes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reviewer boolean;
BEGIN
  IF auth.role() = 'service_role' OR (v_uid IS NULL AND auth.role() IS NULL) THEN RETURN NEW; END IF;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.customer_id <> v_uid THEN
      RAISE EXCEPTION 'Only the booking customer can initialize payment.' USING ERRCODE = '42501';
    END IF;
    -- Serialize customer initialization, preventing a second payment from
    -- hiding a captured/pending one in the UI's latest-payment query.
    PERFORM 1 FROM public.bookings WHERE id = NEW.booking_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.payments WHERE booking_id = NEW.booking_id
               AND status NOT IN ('rejected', 'failed', 'refunded')) THEN
      RAISE EXCEPTION 'A payment already exists for this booking.' USING ERRCODE = '23514';
    END IF;
    -- The method snapshot trigger runs first; derive status from that snapshot.
    NEW.status := CASE WHEN NEW.payment_method_type = 'manual_transfer'
      THEN 'pending_review'::public.payment_status ELSE 'pending'::public.payment_status END;
    NEW.provider_ref := NULL;
    NEW.metadata := '{}'::jsonb;
    NEW.paymob_order_id := NULL;
    NEW.paymob_integration_id := NULL;
    NEW.captured_at := NULL;
    NEW.reviewed_at := NULL;
    NEW.reviewed_by := NULL;
    NEW.rejection_reason := NULL;
    NEW.proof_path := NULL;
    NEW.proof_uploaded_at := NULL;
    NEW.created_at := now();
    RETURN NEW;
  END IF;

  v_reviewer := public.has_role(v_uid, 'admin') OR EXISTS (
    SELECT 1 FROM public.bookings b JOIN public.providers p ON p.id = b.provider_id
    WHERE b.id = OLD.booking_id AND p.profile_id = v_uid
  );
  IF OLD.payment_method_type = 'online' OR OLD.payment_method_code = 'paymob' OR OLD.method = 'paymob' THEN
    RAISE EXCEPTION 'Online payments can only be updated by the payment gateway.' USING ERRCODE = '42501';
  END IF;
  IF OLD.customer_id = v_uid AND NOT public.has_role(v_uid, 'admin') THEN
    IF OLD.status <> 'pending_review' OR OLD.payment_method_type <> 'manual_transfer'
       OR (to_jsonb(NEW) - ARRAY['proof_path','proof_uploaded_at','updated_at'])
          IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['proof_path','proof_uploaded_at','updated_at']) THEN
      RAISE EXCEPTION 'Customers may only upload pending payment proof.' USING ERRCODE = '42501';
    END IF;
    IF NEW.proof_path IS NOT NULL AND split_part(NEW.proof_path, '/', 1) <> OLD.booking_id::text THEN
      RAISE EXCEPTION 'Payment proof must belong to this booking.' USING ERRCODE = '42501';
    END IF;
    NEW.proof_uploaded_at := CASE WHEN NEW.proof_path IS NULL THEN NULL ELSE now() END;
  ELSIF v_reviewer THEN
    IF OLD.status NOT IN ('pending', 'pending_review') OR NEW.status NOT IN ('captured', 'rejected')
       OR (to_jsonb(NEW) - ARRAY['status','captured_at','reviewed_at','reviewed_by','rejection_reason','updated_at'])
          IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','captured_at','reviewed_at','reviewed_by','rejection_reason','updated_at']) THEN
      RAISE EXCEPTION 'Invalid manual payment review.' USING ERRCODE = '42501';
    END IF;
    NEW.reviewed_by := v_uid;
    NEW.reviewed_at := now();
    NEW.captured_at := CASE WHEN NEW.status = 'captured' THEN now() ELSE NULL END;
    NEW.rejection_reason := CASE WHEN NEW.status = 'rejected' THEN NEW.rejection_reason ELSE NULL END;
  ELSE
    RAISE EXCEPTION 'Payment update not authorized.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_guard_payment_writes() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_t_guard_payment_writes BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_payment_writes();

-- Remove unsafe RPC signatures so stale callers fail closed.
DROP FUNCTION public.paymob_store_checkout_intention(uuid, text, text, jsonb);
CREATE FUNCTION public.paymob_store_checkout_intention(
  p_payment_id uuid, p_intention_id text, p_checkout_url text,
  p_order_id bigint, p_integration_id bigint, p_extra_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_order_id IS NULL OR p_order_id <= 0 OR p_integration_id IS NULL OR p_integration_id <= 0 THEN
    RAISE EXCEPTION 'Invalid Paymob order binding.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.payments SET
    paymob_order_id = p_order_id, paymob_integration_id = p_integration_id,
    provider_ref = p_intention_id,
    metadata = (COALESCE(metadata, '{}'::jsonb) - 'paymob_checkout_reservation')
      || COALESCE(p_extra_metadata, '{}'::jsonb)
      || jsonb_build_object('paymob_intention_id', p_intention_id,
           'paymob_checkout_url', p_checkout_url, 'paymob_checkout_started_at', now())
  WHERE id = p_payment_id AND status = 'pending'
    AND payment_method_code = 'paymob' AND payment_method_type = 'online'
    AND (paymob_order_id IS NULL OR paymob_order_id = p_order_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Paymob order binding could not be stored.' USING ERRCODE = '23514'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.paymob_store_checkout_intention(uuid,text,text,bigint,bigint,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paymob_store_checkout_intention(uuid,text,text,bigint,bigint,jsonb) TO service_role;

DROP FUNCTION IF EXISTS public.paymob_apply_transaction_webhook(bigint,uuid,boolean,boolean,bigint,text,jsonb);
DROP FUNCTION IF EXISTS public.paymob_apply_transaction_webhook(bigint,uuid,boolean,boolean,bigint,text,jsonb,text);
CREATE FUNCTION public.paymob_apply_transaction_webhook(
  p_paymob_transaction_id bigint, p_order_id bigint, p_integration_id bigint,
  p_currency text, p_success boolean, p_pending boolean, p_amount_cents bigint,
  p_provider_ref text, p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_event public.paymob_webhook_events%ROWTYPE;
  v_outcome text;
  v_status public.payment_status;
BEGIN
  IF p_paymob_transaction_id IS NULL OR p_paymob_transaction_id <= 0
     OR p_order_id IS NULL OR p_order_id <= 0 OR p_success IS NULL OR p_pending IS NULL THEN
    RAISE EXCEPTION 'Invalid Paymob transaction.' USING ERRCODE = '22023';
  END IF;
  -- Serialize even conflicting requests for the same transaction, then lock
  -- the payment. No caller-supplied Famy payment ID participates in lookup.
  PERFORM pg_advisory_xact_lock(p_paymob_transaction_id);
  SELECT * INTO v_payment FROM public.payments WHERE paymob_order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trusted Paymob order mapping not found.' USING ERRCODE = 'P0002'; END IF;
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
  -- A distinct successful transaction can settle a previously declined attempt;
  -- a late pending event must never downgrade a final payment state.
  IF p_pending AND v_payment.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', true, 'ignored', true, 'reason', 'already_final');
  END IF;
  INSERT INTO public.paymob_webhook_events(paymob_transaction_id, payment_id, outcome)
  VALUES(p_paymob_transaction_id, v_payment.id, v_outcome)
  ON CONFLICT(paymob_transaction_id) DO UPDATE SET outcome = EXCLUDED.outcome, processed_at = now();
  UPDATE public.payments SET status = v_status, provider_ref = p_provider_ref,
    metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
    captured_at = CASE WHEN v_status = 'captured' THEN now() ELSE captured_at END,
    reviewed_at = CASE WHEN v_status IN ('captured','rejected') THEN now() ELSE reviewed_at END,
    rejection_reason = CASE WHEN v_status = 'rejected' THEN 'Paymob payment failed or was declined.' ELSE NULL END
  WHERE id = v_payment.id;
  RETURN jsonb_build_object('ok', true, 'payment_id', v_payment.id, 'status', v_status, 'outcome', v_outcome);
END;
$$;
REVOKE ALL ON FUNCTION public.paymob_apply_transaction_webhook(bigint,bigint,bigint,text,boolean,boolean,bigint,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paymob_apply_transaction_webhook(bigint,bigint,bigint,text,boolean,boolean,bigint,text,jsonb) TO service_role;

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
    IF v_payment.paymob_order_id IS NULL OR v_payment.paymob_integration_id IS NULL THEN
      RAISE EXCEPTION 'Existing Paymob checkout requires trusted order reconciliation.' USING ERRCODE = '23514';
    END IF;
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


NOTIFY pgrst, 'reload schema';
COMMIT;
