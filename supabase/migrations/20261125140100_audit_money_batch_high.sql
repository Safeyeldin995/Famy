-- Audit money batch (HIGH): #438, #439, #440 — idempotent trigger/RPC updates only.

-- ---------------------------------------------------------------------------
-- #439: Auto-complete online lessons when attendance evidence is "complete".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_online_session_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_settings record;
  v_overlap numeric;
  v_required numeric;
  v_duration_min numeric;
  v_outcome text;
  v_event_count integer;
  v_customer_present boolean;
  v_provider_present boolean;
  v_participant_minutes integer;
  v_count integer := 0;
  v_auto_complete_from timestamptz := TIMESTAMPTZ '2026-11-25T17:00:00+00';
BEGIN
  SELECT * INTO v_settings FROM public.online_session_settings() LIMIT 1;

  FOR v_booking IN
    SELECT b.*
    FROM public.bookings b
    WHERE b.service_mode = 'online'
      AND b.status IN ('confirmed', 'completed')
      AND b.end_at + (COALESCE(v_settings.grace_minutes_after_end, 15) * interval '1 minute') <= now()
      AND b.online_session_outcome IS NULL
    ORDER BY b.end_at, b.id
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    SELECT count(*)::integer INTO v_event_count
    FROM public.session_events se
    WHERE se.booking_id = v_booking.id;

    v_duration_min := GREATEST(
      EXTRACT(epoch FROM (v_booking.end_at - v_booking.start_at)) / 60.0,
      0
    );
    v_required := v_duration_min * COALESCE(v_settings.overlap_ratio, 0.5);
    v_overlap := public.online_session_overlap_minutes(v_booking.id);
    v_customer_present := public.online_session_participant_present(v_booking.id, 'customer');
    v_provider_present := public.online_session_participant_present(v_booking.id, 'provider');

    IF v_event_count = 0 THEN
      v_outcome := 'admin_review_no_events';
    ELSIF NOT v_customer_present AND NOT v_provider_present THEN
      v_outcome := 'both_absent';
    ELSIF NOT v_provider_present THEN
      v_outcome := 'provider_absent';
    ELSIF NOT v_customer_present THEN
      v_outcome := 'customer_absent';
    ELSIF v_overlap < v_required THEN
      v_outcome := 'admin_review_overlap';
    ELSE
      v_outcome := 'complete';
    END IF;

    SELECT COALESCE(
      sum(
        GREATEST(
          EXTRACT(
            epoch FROM (
              COALESCE(se.left_at, LEAST(now(), v_booking.end_at)) - se.joined_at
            )
          ),
          0
        )
      )::integer / 60,
      0
    ) INTO v_participant_minutes
    FROM public.session_events se
    WHERE se.booking_id = v_booking.id;

    UPDATE public.bookings
    SET online_session_outcome = v_outcome,
        online_participant_minutes = v_participant_minutes
    WHERE id = v_booking.id AND online_session_outcome IS NULL;

    IF v_outcome IN ('admin_review_no_events', 'admin_review_overlap') THEN
      PERFORM public.open_online_session_admin_review(
        v_booking.id,
        'Online session evidence: ' || v_outcome,
        jsonb_build_object(
          'overlap_minutes', v_overlap,
          'required_overlap_minutes', v_required,
          'event_count', v_event_count,
          'outcome', v_outcome
        )
      );
    END IF;

    IF v_outcome = 'complete'
       AND v_booking.status = 'confirmed'
       AND v_booking.end_at >= v_auto_complete_from THEN
      PERFORM set_config('app.auto_complete_in_progress', 'on', true);
      PERFORM set_config('app.audit_reason', 'online_session_auto_complete', true);

      UPDATE public.bookings
      SET status = 'completed',
          session_started_at = COALESCE(session_started_at, v_booking.start_at),
          session_ended_at = COALESCE(session_ended_at, v_booking.end_at),
          completion_requested_at = COALESCE(completion_requested_at, v_booking.end_at),
          completed_at = COALESCE(completed_at, now()),
          status_changed_at = now(),
          status_changed_by = NULL
      WHERE id = v_booking.id
        AND status = 'confirmed';

      IF FOUND THEN
        v_count := v_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- #438: Online InstaPay capture requires admin (not provider) before completion.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_validate_payment_capture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_status public.booking_status;
  v_service_mode text;
BEGIN
  IF NEW.status = 'captured'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'captured') THEN
    IF current_setting('app.ledger_internal_capture', true) = 'on' THEN
      RETURN NEW;
    END IF;

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
      RAISE EXCEPTION
        'Paymob online payments can only be captured by the verified webhook.'
        USING ERRCODE = '42501';
    END IF;

    SELECT b.status, b.service_mode
      INTO v_booking_status, v_service_mode
    FROM public.bookings b
    WHERE b.id = NEW.booking_id;

    IF v_service_mode = 'online'
       AND v_booking_status IN ('pending', 'confirmed') THEN
      IF auth.uid() IS NULL
         OR public.has_role(auth.uid(), 'admin')
         OR current_setting('app.ledger_internal_capture', true) = 'on' THEN
        RETURN NEW;
      END IF;
    END IF;

    IF v_booking_status IS DISTINCT FROM 'completed' THEN
      RAISE EXCEPTION
        'Payment cannot be captured until the booking is completed (current booking status: %)',
        v_booking_status
        USING ERRCODE = '42501';
    END IF;

    IF COALESCE(NEW.payment_method_type, '') = 'cash' THEN
      RETURN NEW;
    END IF;

    IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'This payment method can only be captured after admin review.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_guard_payment_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reviewer boolean;
BEGIN
  IF current_setting('app.ledger_internal_capture', true) = 'on'
     OR current_setting('app.wallet_checkout_adjust', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF auth.role() = 'service_role' OR (v_uid IS NULL AND auth.role() IS NULL) THEN RETURN NEW; END IF;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.customer_id <> v_uid THEN
      RAISE EXCEPTION 'Only the booking customer can initialize payment.' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public.bookings WHERE id = NEW.booking_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.payments WHERE booking_id = NEW.booking_id
               AND status NOT IN ('rejected', 'failed', 'refunded')) THEN
      RAISE EXCEPTION 'A payment already exists for this booking.' USING ERRCODE = '23514';
    END IF;
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

  v_reviewer := public.has_role(v_uid, 'admin') OR (
    COALESCE(OLD.payment_method_type, '') = 'cash'
    AND EXISTS (
      SELECT 1 FROM public.bookings b JOIN public.providers p ON p.id = b.provider_id
      WHERE b.id = OLD.booking_id AND p.profile_id = v_uid
    )
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

REVOKE ALL ON FUNCTION public.tg_validate_payment_capture()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.tg_guard_payment_writes() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- #440: Late Paymob capture on a superseded attempt credits wallet idempotently.
-- (Derived from 20261123230700_wallet_capture_reclaim.sql)
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
    'paymob_superseded_capture'
  ));

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
      v_meta := v_meta || jsonb_build_object(
        'superseded_capture', true,
        'superseded_by_payment_id', v_funding_payment_id,
        'excluded_from_booking_funding', true,
        'superseded_excess_credited', GREATEST(v_excess, 0)
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
  RETURN jsonb_build_object(
    'ok', true,
    'payment_id', v_payment.id,
    'status', v_status,
    'outcome', v_outcome,
    'superseded_capture', v_funding_payment_id IS NOT NULL AND v_status = 'captured'
  );
END;
$$;