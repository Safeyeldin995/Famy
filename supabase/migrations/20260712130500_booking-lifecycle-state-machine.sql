-- Booking Lifecycle Phase 3A (2/2): metadata columns, a database-level
-- transition validator, payment-capture gating, and expanded lifecycle
-- notifications. Runs after 20260712130000 has committed the new enum
-- values, so they're safe to reference here.
--
-- Existing tables/policies/RLS ownership checks are untouched — RLS still
-- decides WHO may touch a booking row; this migration adds the missing
-- layer that decides WHAT status transition they're allowed to make,
-- enforced at the database level regardless of caller (app, raw SQL, or
-- any future integration).

-- ============================================================
-- 1) Booking metadata columns
-- ============================================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS no_show_party text CHECK (no_show_party IN ('customer', 'provider')),
  ADD COLUMN IF NOT EXISTS no_show_reported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS no_show_reason text,
  ADD COLUMN IF NOT EXISTS disputed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispute_reason text,
  ADD COLUMN IF NOT EXISTS dispute_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispute_resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================
-- 2) Transition validator — the actual state machine.
-- Fires on every UPDATE (not just status changes) so that
-- server-controlled fields (timestamps, actor ids, admin-resolution
-- fields) can never be smuggled into an unrelated column update either.
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_validate_booking_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_customer boolean := false;
  v_is_provider boolean := false;
  v_is_admin boolean := false;
  v_allowed boolean := false;
  v_changing boolean := (NEW.status IS DISTINCT FROM OLD.status);
BEGIN
  -- No session (service_role / trusted backend job) bypasses role-based
  -- transition checks — every authenticated app caller below is fully
  -- validated regardless of what the client sends.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_changing THEN
    v_is_customer := (OLD.customer_id = v_uid);
    v_is_provider := EXISTS (
      SELECT 1 FROM public.providers p WHERE p.id = OLD.provider_id AND p.profile_id = v_uid
    );
    v_is_admin := public.has_role(v_uid, 'admin');

    IF v_is_admin AND (
         (OLD.status = 'disputed' AND NEW.status IN ('completed', 'cancelled'))
      OR (OLD.status = 'no_show' AND NEW.status IN ('completed', 'cancelled'))
    ) THEN
      v_allowed := true;
    END IF;

    IF NOT v_allowed AND v_is_provider AND (
         (OLD.status = 'pending' AND NEW.status = 'confirmed')
      OR (OLD.status = 'pending' AND NEW.status = 'cancelled')
      OR (OLD.status = 'confirmed' AND NEW.status = 'on_the_way')
      OR (OLD.status = 'confirmed' AND NEW.status = 'cancelled')
      OR (OLD.status = 'on_the_way' AND NEW.status = 'arrived')
      OR (OLD.status = 'on_the_way' AND NEW.status = 'no_show' AND NEW.no_show_party = 'customer')
      OR (OLD.status = 'arrived' AND NEW.status = 'in_progress')
      OR (OLD.status = 'arrived' AND NEW.status = 'no_show' AND NEW.no_show_party = 'customer')
      OR (OLD.status = 'in_progress' AND NEW.status = 'completion_requested')
    ) THEN
      v_allowed := true;
    END IF;

    IF NOT v_allowed AND v_is_customer AND (
         (OLD.status = 'pending' AND NEW.status = 'cancelled')
      OR (OLD.status = 'confirmed' AND NEW.status = 'cancelled')
      OR (OLD.status = 'on_the_way' AND NEW.status = 'no_show' AND NEW.no_show_party = 'provider')
      OR (OLD.status = 'completion_requested' AND NEW.status = 'completed')
      OR (OLD.status = 'completion_requested' AND NEW.status = 'disputed')
    ) THEN
      v_allowed := true;
    END IF;

    IF NOT v_allowed THEN
      RAISE EXCEPTION 'Booking transition % -> % is not permitted for this user', OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Server-controlled bookkeeping: always derived here, never trusted from
  -- client input, on every update (status-changing or not).
  NEW.status_changed_at := CASE WHEN v_changing THEN now() ELSE OLD.status_changed_at END;
  NEW.status_changed_by := CASE WHEN v_changing THEN v_uid ELSE OLD.status_changed_by END;

  NEW.completion_requested_at := CASE WHEN v_changing AND NEW.status = 'completion_requested' THEN now() ELSE OLD.completion_requested_at END;
  NEW.completed_at := CASE WHEN v_changing AND NEW.status = 'completed' THEN now() ELSE OLD.completed_at END;

  IF v_changing AND NEW.status = 'cancelled' THEN
    NEW.cancelled_at := now();
    NEW.cancelled_by := v_uid;
    -- cancellation_reason passes through from the client on this update.
  ELSE
    NEW.cancelled_at := OLD.cancelled_at;
    NEW.cancelled_by := OLD.cancelled_by;
    NEW.cancellation_reason := OLD.cancellation_reason;
  END IF;

  IF v_changing AND NEW.status = 'no_show' THEN
    NEW.no_show_reported_by := v_uid;
    -- no_show_party / no_show_reason pass through (party already validated above).
  ELSE
    NEW.no_show_party := OLD.no_show_party;
    NEW.no_show_reported_by := OLD.no_show_reported_by;
    NEW.no_show_reason := OLD.no_show_reason;
  END IF;

  IF v_changing AND NEW.status = 'disputed' THEN
    NEW.disputed_at := now();
    -- dispute_reason passes through from the client on this update.
  ELSE
    NEW.disputed_at := OLD.disputed_at;
    NEW.dispute_reason := OLD.dispute_reason;
  END IF;

  IF v_changing AND v_is_admin AND OLD.status = 'disputed' AND NEW.status IN ('completed', 'cancelled') THEN
    NEW.dispute_resolved_at := now();
    NEW.dispute_resolved_by := v_uid;
  ELSE
    NEW.dispute_resolved_at := OLD.dispute_resolved_at;
    NEW.dispute_resolved_by := OLD.dispute_resolved_by;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_validate_booking_transition() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_booking_transition_guard ON public.bookings;
CREATE TRIGGER trg_booking_transition_guard
BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.tg_validate_booking_transition();

-- ============================================================
-- 3) Payment capture/release gate — DB level.
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_validate_payment_capture()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking_status public.booking_status;
BEGIN
  IF NEW.status = 'captured' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'captured') THEN
    SELECT status INTO v_booking_status FROM public.bookings WHERE id = NEW.booking_id;
    IF v_booking_status IS DISTINCT FROM 'completed' THEN
      RAISE EXCEPTION 'Payment cannot be captured until the booking is completed (current booking status: %)', v_booking_status
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_validate_payment_capture() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validate_payment_capture ON public.payments;
CREATE TRIGGER trg_validate_payment_capture
BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.tg_validate_payment_capture();

-- ============================================================
-- 4) Lifecycle notifications — extend the existing trigger function
-- (introduced in 20260707095401) to cover the new statuses. Trigger
-- registration itself (AFTER INSERT OR UPDATE OF status) is unchanged.
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_booking_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider_user uuid;
  v_customer_name text;
  v_service_name text;
BEGIN
  SELECT profile_id INTO v_provider_user FROM public.providers WHERE id = NEW.provider_id;
  SELECT full_name INTO v_customer_name FROM public.profiles WHERE id = NEW.customer_id;
  SELECT name_en INTO v_service_name FROM public.services WHERE id = NEW.service_id;

  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, payload)
      VALUES (
        v_provider_user, 'booking_request',
        'New booking request',
        COALESCE(v_customer_name, 'A customer') || ' requested ' || COALESCE(v_service_name, 'a service'),
        jsonb_build_object('booking_id', NEW.id)
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP <> 'UPDATE' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'confirmed' THEN
    INSERT INTO public.notifications (user_id, type, title, body, payload)
    VALUES (
      NEW.customer_id, 'booking_confirmed',
      'Booking confirmed',
      'Your booking has been accepted.',
      jsonb_build_object('booking_id', NEW.id)
    );

  ELSIF NEW.status = 'on_the_way' THEN
    INSERT INTO public.notifications (user_id, type, title, body, payload)
    VALUES (
      NEW.customer_id, 'booking_on_the_way',
      'Your provider is on the way',
      'Your provider is heading to your location.',
      jsonb_build_object('booking_id', NEW.id)
    );

  ELSIF NEW.status = 'arrived' THEN
    INSERT INTO public.notifications (user_id, type, title, body, payload)
    VALUES (
      NEW.customer_id, 'booking_arrived',
      'Your provider has arrived',
      'Your provider has arrived at your location.',
      jsonb_build_object('booking_id', NEW.id)
    );

  ELSIF NEW.status = 'in_progress' THEN
    INSERT INTO public.notifications (user_id, type, title, body, payload)
    VALUES (
      NEW.customer_id, 'booking_in_progress',
      'Service started',
      'Your service is now in progress.',
      jsonb_build_object('booking_id', NEW.id)
    );

  ELSIF NEW.status = 'completion_requested' THEN
    INSERT INTO public.notifications (user_id, type, title, body, payload)
    VALUES (
      NEW.customer_id, 'booking_completion_requested',
      'Confirm your service',
      'Your provider marked this booking as done. Please confirm to complete it.',
      jsonb_build_object('booking_id', NEW.id)
    );

  ELSIF NEW.status = 'completed' THEN
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, payload)
      VALUES (
        v_provider_user, 'booking_completed',
        'Booking completed',
        'The customer confirmed the service is complete.',
        jsonb_build_object('booking_id', NEW.id)
      );
    END IF;

  ELSIF NEW.status = 'disputed' THEN
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, payload)
      VALUES (
        v_provider_user, 'booking_disputed',
        'Booking disputed',
        'The customer disputed this booking''s completion. Our team will review it.',
        jsonb_build_object('booking_id', NEW.id)
      );
    END IF;

  ELSIF NEW.status = 'no_show' THEN
    IF NEW.no_show_party = 'provider' AND v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, payload)
      VALUES (
        v_provider_user, 'booking_no_show',
        'No-show reported',
        'The customer reported that you did not show up for this booking.',
        jsonb_build_object('booking_id', NEW.id)
      );
    ELSIF NEW.no_show_party = 'customer' THEN
      INSERT INTO public.notifications (user_id, type, title, body, payload)
      VALUES (
        NEW.customer_id, 'booking_no_show',
        'No-show reported',
        'Your provider reported that you were unavailable for this booking.',
        jsonb_build_object('booking_id', NEW.id)
      );
    END IF;

  ELSIF NEW.status = 'cancelled' THEN
    IF OLD.status = 'pending' AND NEW.cancelled_by IS DISTINCT FROM NEW.customer_id THEN
      INSERT INTO public.notifications (user_id, type, title, body, payload)
      VALUES (
        NEW.customer_id, 'booking_declined',
        'Booking declined',
        'Your booking request was not accepted. Please try another provider or time.',
        jsonb_build_object('booking_id', NEW.id)
      );
    ELSIF NEW.cancelled_by = NEW.customer_id THEN
      IF v_provider_user IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, title, body, payload)
        VALUES (
          v_provider_user, 'booking_cancelled',
          'Booking cancelled',
          'The customer cancelled this booking.',
          jsonb_build_object('booking_id', NEW.id)
        );
      END IF;
    ELSE
      INSERT INTO public.notifications (user_id, type, title, body, payload)
      VALUES (
        NEW.customer_id, 'booking_cancelled',
        'Booking cancelled',
        'Your booking was cancelled.',
        jsonb_build_object('booking_id', NEW.id)
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
