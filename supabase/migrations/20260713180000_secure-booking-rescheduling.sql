-- Patch 1 / Module 4: Booking Rescheduling.
-- Additive only. Reminder scheduling is explicitly out of scope (no
-- pg_cron / Edge Functions / reminder table exist in this project yet —
-- a dedicated later module owns that and will hook into accept_reschedule()
-- once it exists). Everything else — request/accept/reject/counter-propose,
-- full history, DB enforcement, notifications — is implemented here.

-- ============================================================
-- 1) Extract the reusable availability-slot check out of
-- tg_validate_booking_service() so booking creation AND reschedule
-- acceptance run the exact same validation instead of duplicating it.
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_booking_slot(
  p_provider_id uuid, p_start timestamptz, p_end timestamptz, p_exclude_booking_id uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider RECORD;
  v_local_date date;
  v_local_start time;
  v_local_end time;
  v_weekday smallint;
BEGIN
  SELECT * INTO v_provider FROM public.providers WHERE id = p_provider_id;
  IF NOT FOUND OR NOT v_provider.is_active THEN
    RAISE EXCEPTION 'This provider is not currently active.' USING ERRCODE = '23514';
  END IF;

  IF v_provider.vacation_mode THEN
    RAISE EXCEPTION 'This provider is not accepting bookings right now.' USING ERRCODE = '23514';
  END IF;

  IF p_start < now() + make_interval(hours => v_provider.min_notice_hours) THEN
    RAISE EXCEPTION 'This time does not meet the provider''s minimum notice period.' USING ERRCODE = '23514';
  END IF;

  IF p_start > now() + make_interval(days => v_provider.max_advance_days) THEN
    RAISE EXCEPTION 'This time is too far in the future for this provider.' USING ERRCODE = '23514';
  END IF;

  v_local_date := (p_start AT TIME ZONE 'Africa/Cairo')::date;
  v_local_start := (p_start AT TIME ZONE 'Africa/Cairo')::time;
  v_local_end := (p_end AT TIME ZONE 'Africa/Cairo')::time;
  v_weekday := EXTRACT(DOW FROM (p_start AT TIME ZONE 'Africa/Cairo'))::smallint;

  IF v_local_date <> (p_end AT TIME ZONE 'Africa/Cairo')::date THEN
    RAISE EXCEPTION 'Bookings cannot span past midnight.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.availability_rules ar
    WHERE ar.provider_id = p_provider_id AND ar.weekday = v_weekday
      AND ar.start_time <= v_local_start AND ar.end_time >= v_local_end
  ) THEN
    RAISE EXCEPTION 'This time is outside the provider''s working hours.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.provider_vacations pv
    WHERE pv.provider_id = p_provider_id AND v_local_date BETWEEN pv.start_date AND pv.end_date
  ) THEN
    RAISE EXCEPTION 'The provider is unavailable on this date.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.availability_exceptions ae
    WHERE ae.provider_id = p_provider_id
      AND ae.is_blocked
      AND v_local_date BETWEEN ae.date AND COALESCE(ae.end_date, ae.date)
      AND (ae.start_time IS NULL OR ae.end_time IS NULL OR (v_local_start < ae.end_time AND v_local_end > ae.start_time))
  ) THEN
    RAISE EXCEPTION 'The provider is unavailable during this time.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.provider_id = p_provider_id
      AND b.id IS DISTINCT FROM p_exclude_booking_id
      AND b.status IN ('pending','confirmed','on_the_way','arrived','arrival_confirmed','in_progress','completion_requested')
      AND tstzrange(b.start_at - make_interval(mins => v_provider.buffer_minutes), b.end_at + make_interval(mins => v_provider.buffer_minutes), '[)')
          && tstzrange(p_start, p_end, '[)')
  ) THEN
    RAISE EXCEPTION 'This time is too close to another booking for this provider.' USING ERRCODE = '23514';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.check_booking_slot(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_validate_booking_service()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_addr RECORD;
  v_zone RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.services s WHERE s.id = NEW.service_id AND s.is_active = true
  ) THEN
    RAISE EXCEPTION 'Selected service is not currently available.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.provider_services ps
    WHERE ps.provider_id = NEW.provider_id AND ps.service_id = NEW.service_id AND ps.status = 'approved'
  ) THEN
    RAISE EXCEPTION 'This provider is not approved to offer the selected service.' USING ERRCODE = '23514';
  END IF;

  IF NEW.address_id IS NULL THEN
    RAISE EXCEPTION 'A saved address with a valid location is required to book.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_addr FROM public.addresses WHERE id = NEW.address_id;
  IF NOT FOUND OR v_addr.lat IS NULL OR v_addr.lng IS NULL THEN
    RAISE EXCEPTION 'Selected address has no valid location coordinates.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_zone FROM public.resolve_zone(v_addr.lat, v_addr.lng);
  IF v_zone.zone_id IS NULL THEN
    RAISE EXCEPTION 'This area is not currently served.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.zone_services zs WHERE zs.zone_id = v_zone.zone_id AND zs.service_id = NEW.service_id) THEN
    RAISE EXCEPTION 'The selected service is not offered in this area.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.zone_providers zp WHERE zp.zone_id = v_zone.zone_id AND zp.provider_id = NEW.provider_id) THEN
    RAISE EXCEPTION 'This provider does not serve the selected area.' USING ERRCODE = '23514';
  END IF;

  PERFORM public.check_booking_slot(NEW.provider_id, NEW.start_at, NEW.end_at, NULL);

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_validate_booking_service() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 2) Narrow, audited carve-out in the schedule-immutability guard —
-- start_at/end_at may change only while a reschedule-acceptance RPC has
-- set this transaction-local flag; every other write path is still hard
-- blocked exactly as Module 1 left it.
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
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
     OR NEW.service_id IS DISTINCT FROM OLD.service_id
     OR NEW.address_id IS DISTINCT FROM OLD.address_id
     OR NEW.price_subtotal IS DISTINCT FROM OLD.price_subtotal
     OR NEW.price_discount IS DISTINCT FROM OLD.price_discount
     OR NEW.price_total IS DISTINCT FROM OLD.price_total
  THEN
    RAISE EXCEPTION 'Booking customer, provider, service, address, and pricing cannot be changed after creation.'
      USING ERRCODE = '42501';
  END IF;

  IF (NEW.start_at IS DISTINCT FROM OLD.start_at OR NEW.end_at IS DISTINCT FROM OLD.end_at)
     AND current_setting('app.reschedule_in_progress', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Booking schedule can only be changed through an accepted reschedule request.'
      USING ERRCODE = '42501';
  END IF;

  IF v_changing THEN
    v_is_customer := (OLD.customer_id = v_uid);
    v_is_provider := EXISTS (SELECT 1 FROM public.providers p WHERE p.id = OLD.provider_id AND p.profile_id = v_uid);
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
      OR (OLD.status = 'arrived' AND NEW.status = 'no_show' AND NEW.no_show_party = 'customer')
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

  NEW.status_changed_at := CASE WHEN v_changing THEN now() ELSE OLD.status_changed_at END;
  NEW.status_changed_by := CASE WHEN v_changing THEN v_uid ELSE OLD.status_changed_by END;
  NEW.completion_requested_at := CASE WHEN v_changing AND NEW.status = 'completion_requested' THEN now() ELSE OLD.completion_requested_at END;
  NEW.completed_at := CASE WHEN v_changing AND NEW.status = 'completed' THEN now() ELSE OLD.completed_at END;

  IF v_changing AND NEW.status = 'arrival_confirmed' THEN
    NEW.arrival_confirmed_at := now(); NEW.arrival_confirmed_by := v_uid;
  ELSE
    NEW.arrival_confirmed_at := OLD.arrival_confirmed_at; NEW.arrival_confirmed_by := OLD.arrival_confirmed_by;
  END IF;

  IF v_changing AND NEW.status = 'cancelled' THEN
    NEW.cancelled_at := now(); NEW.cancelled_by := v_uid;
  ELSE
    NEW.cancelled_at := OLD.cancelled_at; NEW.cancelled_by := OLD.cancelled_by; NEW.cancellation_reason := OLD.cancellation_reason;
  END IF;

  IF v_changing AND NEW.status = 'no_show' THEN
    NEW.no_show_reported_by := v_uid;
  ELSE
    NEW.no_show_party := OLD.no_show_party; NEW.no_show_reported_by := OLD.no_show_reported_by; NEW.no_show_reason := OLD.no_show_reason;
  END IF;

  IF v_changing AND NEW.status = 'disputed' THEN
    NEW.disputed_at := now();
  ELSE
    NEW.disputed_at := OLD.disputed_at; NEW.dispute_reason := OLD.dispute_reason;
  END IF;

  IF v_changing AND v_is_admin AND OLD.status = 'disputed' AND NEW.status IN ('completed', 'cancelled') THEN
    NEW.dispute_resolved_at := now(); NEW.dispute_resolved_by := v_uid;
  ELSE
    NEW.dispute_resolved_at := OLD.dispute_resolved_at; NEW.dispute_resolved_by := OLD.dispute_resolved_by;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_validate_booking_transition() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3) Reschedule request thread. One row per proposal; a counter-proposal
-- is a NEW row linked via responds_to_id, so history is never overwritten.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.booking_reschedule_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  responds_to_id uuid REFERENCES public.booking_reschedule_requests(id) ON DELETE SET NULL,
  original_start_at timestamptz NOT NULL,
  original_end_at timestamptz NOT NULL,
  proposed_start_at timestamptz NOT NULL,
  proposed_end_at timestamptz NOT NULL CHECK (proposed_end_at > proposed_start_at),
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  request_reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','counter_proposed','cancelled')),
  responded_by uuid REFERENCES auth.users(id),
  response_reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reschedule_booking ON public.booking_reschedule_requests(booking_id, requested_at DESC);
-- At most one open (awaiting-response) thread per booking at a time.
DROP INDEX IF EXISTS reschedule_one_open_per_booking;
CREATE UNIQUE INDEX reschedule_one_open_per_booking ON public.booking_reschedule_requests(booking_id) WHERE status = 'pending';

GRANT SELECT ON public.booking_reschedule_requests TO authenticated;
GRANT ALL ON public.booking_reschedule_requests TO service_role;
ALTER TABLE public.booking_reschedule_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reschedule_party_read" ON public.booking_reschedule_requests;
CREATE POLICY "reschedule_party_read" ON public.booking_reschedule_requests FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND (
        b.customer_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.providers p WHERE p.id = b.provider_id AND p.profile_id = auth.uid())
      )
    )
  );
DROP POLICY IF EXISTS "reschedule_admin_all" ON public.booking_reschedule_requests;
CREATE POLICY "reschedule_admin_all" ON public.booking_reschedule_requests FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Defense in depth: once a row leaves 'pending' it is immutable — the RPCs
-- below are the only path that ever transitions status, exactly once each.
CREATE OR REPLACE FUNCTION public.tg_block_reschedule_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'This reschedule request has already been resolved.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_reschedule_immutable ON public.booking_reschedule_requests;
CREATE TRIGGER trg_reschedule_immutable BEFORE UPDATE ON public.booking_reschedule_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_reschedule_mutation();

DROP TRIGGER IF EXISTS trg_audit_reschedule ON public.booking_reschedule_requests;
CREATE TRIGGER trg_audit_reschedule AFTER INSERT OR UPDATE OR DELETE ON public.booking_reschedule_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

-- Notifications for each stage — same SECURITY DEFINER / no-client-insert
-- pattern as the existing tg_booking_notify().
CREATE OR REPLACE FUNCTION public.tg_reschedule_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking RECORD;
  v_provider_user uuid;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = NEW.booking_id;
  SELECT profile_id INTO v_provider_user FROM public.providers WHERE id = v_booking.provider_id;

  IF TG_OP = 'INSERT' THEN
    -- Notify whichever party did not make this proposal.
    IF NEW.requested_by = v_booking.customer_id THEN
      IF v_provider_user IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, title, body, payload)
        VALUES (v_provider_user, 'reschedule_requested', 'Reschedule requested',
          'The customer proposed a new time for this booking.', jsonb_build_object('booking_id', NEW.booking_id, 'request_id', NEW.id));
      END IF;
    ELSE
      INSERT INTO public.notifications (user_id, type, title, body, payload)
      VALUES (v_booking.customer_id, 'reschedule_requested', 'New proposed time',
        'Your provider proposed a different time for this booking.', jsonb_build_object('booking_id', NEW.booking_id, 'request_id', NEW.id));
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'accepted' THEN
      INSERT INTO public.notifications (user_id, type, title, body, payload)
      VALUES (NEW.requested_by, 'reschedule_accepted', 'Reschedule accepted',
        'Your proposed time was accepted. The booking has been updated.', jsonb_build_object('booking_id', NEW.booking_id, 'request_id', NEW.id));
    ELSIF NEW.status = 'rejected' THEN
      INSERT INTO public.notifications (user_id, type, title, body, payload)
      VALUES (NEW.requested_by, 'reschedule_rejected', 'Reschedule declined',
        COALESCE(NEW.response_reason, 'Your proposed time was declined.'), jsonb_build_object('booking_id', NEW.booking_id, 'request_id', NEW.id));
    ELSIF NEW.status = 'cancelled' THEN
      -- Requester cancelled their own pending request — notify the other party.
      IF NEW.requested_by = v_booking.customer_id THEN
        IF v_provider_user IS NOT NULL THEN
          INSERT INTO public.notifications (user_id, type, title, body, payload)
          VALUES (v_provider_user, 'reschedule_cancelled', 'Reschedule request withdrawn',
            'The customer withdrew their reschedule request.', jsonb_build_object('booking_id', NEW.booking_id, 'request_id', NEW.id));
        END IF;
      ELSE
        INSERT INTO public.notifications (user_id, type, title, body, payload)
        VALUES (v_booking.customer_id, 'reschedule_cancelled', 'Reschedule proposal withdrawn',
          'Your provider withdrew their proposed time.', jsonb_build_object('booking_id', NEW.booking_id, 'request_id', NEW.id));
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_reschedule_notify ON public.booking_reschedule_requests;
CREATE TRIGGER trg_reschedule_notify AFTER INSERT OR UPDATE ON public.booking_reschedule_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_reschedule_notify();

-- ============================================================
-- 4) The state machine itself — three SECURITY DEFINER RPCs. Clients never
-- INSERT/UPDATE this table directly (no grant above covers it); every
-- transition is server-validated the same way tg_validate_booking_transition
-- already gates bookings.status.
-- ============================================================
CREATE OR REPLACE FUNCTION public.request_reschedule(
  p_booking_id uuid, p_proposed_start timestamptz, p_proposed_end timestamptz, p_reason text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking RECORD;
  v_id uuid;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_booking.customer_id <> auth.uid() THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = '42501';
  END IF;
  IF v_booking.status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'This booking can no longer be rescheduled.' USING ERRCODE = '23514';
  END IF;
  IF p_proposed_end <= p_proposed_start THEN
    RAISE EXCEPTION 'Invalid proposed time range.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.booking_reschedule_requests (
    booking_id, original_start_at, original_end_at, proposed_start_at, proposed_end_at, requested_by, request_reason
  ) VALUES (
    p_booking_id, v_booking.start_at, v_booking.end_at, p_proposed_start, p_proposed_end, auth.uid(), p_reason
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.request_reschedule(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_reschedule(uuid, timestamptz, timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_reschedule_request(p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req RECORD;
BEGIN
  SELECT * INTO v_req FROM public.booking_reschedule_requests WHERE id = p_request_id;
  IF NOT FOUND OR v_req.requested_by <> auth.uid() OR v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This request cannot be cancelled.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.booking_reschedule_requests SET status = 'cancelled', responded_by = auth.uid(), responded_at = now()
    WHERE id = p_request_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cancel_reschedule_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_reschedule_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_reschedule(
  p_request_id uuid, p_action text, p_reason text DEFAULT NULL,
  p_counter_start timestamptz DEFAULT NULL, p_counter_end timestamptz DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req RECORD;
  v_booking RECORD;
  v_is_provider boolean;
  v_expected_responder_is_provider boolean;
  v_new_id uuid;
BEGIN
  IF p_action NOT IN ('accept', 'reject', 'counter') THEN
    RAISE EXCEPTION 'Invalid action.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_req FROM public.booking_reschedule_requests WHERE id = p_request_id;
  IF NOT FOUND OR v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This reschedule request is no longer open.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_req.booking_id;
  v_is_provider := EXISTS (SELECT 1 FROM public.providers p WHERE p.id = v_booking.provider_id AND p.profile_id = auth.uid());
  -- The party who did NOT make this proposal is the one who must respond.
  v_expected_responder_is_provider := (v_req.requested_by = v_booking.customer_id);

  IF v_expected_responder_is_provider AND NOT v_is_provider THEN
    RAISE EXCEPTION 'Only the provider can respond to this request.' USING ERRCODE = '42501';
  END IF;
  IF NOT v_expected_responder_is_provider AND v_booking.customer_id <> auth.uid() THEN
    RAISE EXCEPTION 'Only the customer can respond to this request.' USING ERRCODE = '42501';
  END IF;
  -- Customer may only accept/reject a provider counter-proposal, never counter it again.
  IF p_action = 'counter' AND NOT v_expected_responder_is_provider THEN
    RAISE EXCEPTION 'Only the provider may propose a different time.' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'accept' THEN
    IF v_booking.status NOT IN ('pending', 'confirmed') THEN
      RAISE EXCEPTION 'This booking can no longer be rescheduled.' USING ERRCODE = '23514';
    END IF;
    PERFORM public.check_booking_slot(v_booking.provider_id, v_req.proposed_start_at, v_req.proposed_end_at, v_booking.id);

    PERFORM set_config('app.reschedule_in_progress', 'on', true);
    UPDATE public.bookings SET start_at = v_req.proposed_start_at, end_at = v_req.proposed_end_at WHERE id = v_booking.id;

    UPDATE public.booking_reschedule_requests
      SET status = 'accepted', responded_by = auth.uid(), response_reason = p_reason, responded_at = now()
      WHERE id = p_request_id;

  ELSIF p_action = 'reject' THEN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
      RAISE EXCEPTION 'A reason is required to decline a reschedule request.' USING ERRCODE = '23514';
    END IF;
    UPDATE public.booking_reschedule_requests
      SET status = 'rejected', responded_by = auth.uid(), response_reason = p_reason, responded_at = now()
      WHERE id = p_request_id;

  ELSE -- counter
    IF p_counter_start IS NULL OR p_counter_end IS NULL OR p_counter_end <= p_counter_start THEN
      RAISE EXCEPTION 'A valid counter-proposed time range is required.' USING ERRCODE = '23514';
    END IF;
    IF v_booking.status NOT IN ('pending', 'confirmed') THEN
      RAISE EXCEPTION 'This booking can no longer be rescheduled.' USING ERRCODE = '23514';
    END IF;

    UPDATE public.booking_reschedule_requests
      SET status = 'counter_proposed', responded_by = auth.uid(), response_reason = p_reason, responded_at = now()
      WHERE id = p_request_id;

    INSERT INTO public.booking_reschedule_requests (
      booking_id, responds_to_id, original_start_at, original_end_at, proposed_start_at, proposed_end_at, requested_by, request_reason
    ) VALUES (
      v_booking.id, p_request_id, v_booking.start_at, v_booking.end_at, p_counter_start, p_counter_end, auth.uid(), p_reason
    ) RETURNING id INTO v_new_id;
  END IF;

  RETURN COALESCE(v_new_id, p_request_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.respond_reschedule(uuid, text, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_reschedule(uuid, text, text, timestamptz, timestamptz) TO authenticated;

-- Admin intervention — force-resolve an open request with a mandatory
-- reason. Fully audited via trg_audit_reschedule (generic tg_audit_changes()).
CREATE OR REPLACE FUNCTION public.admin_resolve_reschedule(p_request_id uuid, p_action text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req RECORD;
  v_booking RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin only.' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for admin intervention.' USING ERRCODE = '23514';
  END IF;
  IF p_action NOT IN ('accept', 'reject') THEN
    RAISE EXCEPTION 'Invalid action.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_req FROM public.booking_reschedule_requests WHERE id = p_request_id;
  IF NOT FOUND OR v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This reschedule request is no longer open.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = v_req.booking_id;

  IF p_action = 'accept' THEN
    IF v_booking.status NOT IN ('pending', 'confirmed') THEN
      RAISE EXCEPTION 'This booking can no longer be rescheduled.' USING ERRCODE = '23514';
    END IF;
    PERFORM public.check_booking_slot(v_booking.provider_id, v_req.proposed_start_at, v_req.proposed_end_at, v_booking.id);

    PERFORM set_config('app.reschedule_in_progress', 'on', true);
    UPDATE public.bookings SET start_at = v_req.proposed_start_at, end_at = v_req.proposed_end_at WHERE id = v_booking.id;

    UPDATE public.booking_reschedule_requests
      SET status = 'accepted', responded_by = auth.uid(), response_reason = p_reason, responded_at = now()
      WHERE id = p_request_id;
  ELSE
    UPDATE public.booking_reschedule_requests
      SET status = 'rejected', responded_by = auth.uid(), response_reason = p_reason, responded_at = now()
      WHERE id = p_request_id;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_resolve_reschedule(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_reschedule(uuid, text, text) TO authenticated;
