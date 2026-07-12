-- Booking Lifecycle Phase 3A.1: arrival confirmation fix.
-- Closes the gap where a provider could mark arrived and immediately start
-- the service with no customer confirmation, and where the customer had no
-- safe way to report a provider who never actually arrived once already at
-- 'arrived'. Does not touch the two already-applied Phase 3A migrations.

-- ============================================================
-- 1) New status
-- ============================================================
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'arrival_confirmed' AFTER 'arrived';

-- ============================================================
-- 2) Metadata columns
-- ============================================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS arrival_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS arrival_confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================
-- 3) Transition validator — corrected rule set.
-- Full replace of the Phase 3A function: adds arrival_confirmed handling,
-- removes provider's arrived -> in_progress shortcut in favor of
-- arrival_confirmed -> in_progress, and adds customer's arrived ->
-- arrival_confirmed / arrived -> no_show(provider) transitions.
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

    -- Admin: restricted resolution transitions only. No unrestricted
    -- any-status-to-any-status editing.
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
      OR (OLD.status = 'arrived' AND NEW.status = 'no_show' AND NEW.no_show_party = 'customer')
      -- Provider may only start the job after the customer has confirmed
      -- arrival — 'arrived' -> 'in_progress' directly is deliberately not
      -- in this list, and 'arrival_confirmed' is never provider-settable.
      OR (OLD.status = 'arrival_confirmed' AND NEW.status = 'in_progress')
      OR (OLD.status = 'in_progress' AND NEW.status = 'completion_requested')
    ) THEN
      v_allowed := true;
    END IF;

    IF NOT v_allowed AND v_is_customer AND (
         (OLD.status = 'pending' AND NEW.status = 'cancelled')
      OR (OLD.status = 'confirmed' AND NEW.status = 'cancelled')
      OR (OLD.status = 'on_the_way' AND NEW.status = 'no_show' AND NEW.no_show_party = 'provider')
      OR (OLD.status = 'arrived' AND NEW.status = 'arrival_confirmed')
      OR (OLD.status = 'arrived' AND NEW.status = 'no_show' AND NEW.no_show_party = 'provider')
      -- Customer may never move a booking to in_progress themselves.
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

  IF v_changing AND NEW.status = 'arrival_confirmed' THEN
    NEW.arrival_confirmed_at := now();
    NEW.arrival_confirmed_by := v_uid;
  ELSE
    NEW.arrival_confirmed_at := OLD.arrival_confirmed_at;
    NEW.arrival_confirmed_by := OLD.arrival_confirmed_by;
  END IF;

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

-- ============================================================
-- 4) Lifecycle notifications — clarify 'arrived' wording and add
-- 'arrival_confirmed'. Trigger registration itself is unchanged.
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
      'Your provider reported that they have arrived. Please confirm arrival in the app.',
      jsonb_build_object('booking_id', NEW.id)
    );

  ELSIF NEW.status = 'arrival_confirmed' THEN
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, payload)
      VALUES (
        v_provider_user, 'booking_arrival_confirmed',
        'Arrival confirmed',
        'The customer confirmed your arrival. You can start the service.',
        jsonb_build_object('booking_id', NEW.id)
      );
    END IF;

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
