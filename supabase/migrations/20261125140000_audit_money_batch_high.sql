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

    IF v_outcome = 'complete' AND v_booking.status = 'confirmed' THEN
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