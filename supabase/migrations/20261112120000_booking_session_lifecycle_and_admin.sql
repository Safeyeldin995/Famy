-- Issue #329: booking session timestamps, DB-enforced time windows, and admin
-- lifecycle RPCs. Additive only. Do not backfill. Do not UPDATE existing rows.
-- Do not apply this migration to QA or Production from this PR.

-- ============================================================
-- Flow choice (customer arrival):
-- When the customer confirms arrival from `arrived`, the booking moves
-- directly to `in_progress` (not `arrival_confirmed`). The trigger stamps
-- arrival_confirmed_at, arrival_confirmed_by, and session_started_at together
-- so the booked duration is counted from that confirmation.
--
-- The provider path `arrival_confirmed` -> `in_progress` is kept for legacy
-- rows that are already in `arrival_confirmed`.
--
-- Session duration end (inline helper used below):
--   COALESCE(session_started_at, arrival_confirmed_at, start_at) + (end_at - start_at)
-- ============================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS session_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS session_ended_at timestamptz;

COMMENT ON COLUMN public.bookings.session_started_at IS
  'Set by tg_validate_booking_transition when status becomes in_progress (customer arrived -> in_progress also stamps this with arrival_confirmed_at). Clients cannot write it; admin_set_booking_session_times can with app.admin_session_times_in_progress.';
COMMENT ON COLUMN public.bookings.session_ended_at IS
  'Set by tg_validate_booking_transition when status becomes completion_requested. Clients cannot write it; admin_set_booking_session_times can with app.admin_session_times_in_progress.';

-- Clients cannot write session timestamp columns. Table-level UPDATE remains
-- granted for status changes; the BEFORE UPDATE trigger is the real lock.
-- Column-level REVOKE is defense in depth (same pattern as commission columns).
REVOKE INSERT (session_started_at, session_ended_at)
  ON public.bookings FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (session_started_at, session_ended_at)
  ON public.bookings FROM PUBLIC, anon, authenticated;

-- ============================================================
-- Time windows. Replaces the old 3h / 30min / start_at completion rules.
-- Admin bypasses every window when app.admin_override_in_progress = on
-- (set only by admin_set_booking_status). Server paths (auth.uid() IS NULL)
-- are still unlimited.
-- ============================================================

CREATE OR REPLACE FUNCTION public.tg_booking_time_window_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_provider boolean := false;
  v_is_customer boolean := false;
  v_session_ends_at timestamptz;
  v_remaining_minutes integer;
BEGIN
  IF v_uid IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Admin RPC bypass. Require both the GUC and has_role so a client cannot
  -- spoof set_config('app.admin_override_in_progress') to skip windows.
  IF current_setting('app.admin_override_in_progress', true) = 'on'
     AND public.has_role(v_uid, 'admin') THEN
    RETURN NEW;
  END IF;

  v_is_provider := EXISTS (
    SELECT 1 FROM public.providers p
    WHERE p.id = OLD.provider_id AND p.profile_id = v_uid
  );
  v_is_customer := (OLD.customer_id = v_uid);

  -- Provider on_the_way / arrived: only from start_at - 2 hours through end_at.
  IF v_is_provider AND NEW.status IN ('on_the_way', 'arrived') THEN
    IF now() < OLD.start_at - interval '2 hours' THEN
      IF NEW.status = 'arrived' THEN
        RAISE EXCEPTION 'تقدر تعلن الوصول قبل بداية الجلسة بساعتين'
          USING ERRCODE = '23514';
      ELSE
        RAISE EXCEPTION 'تقدر تعلن انك في الطريق قبل بداية الجلسة بساعتين'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    IF now() > OLD.end_at THEN
      IF NEW.status = 'arrived' THEN
        RAISE EXCEPTION 'ميعاد الجلسة خلص ومش تقدر تعلن الوصول'
          USING ERRCODE = '23514';
      ELSE
        RAISE EXCEPTION 'ميعاد الجلسة خلص ومش تقدر تعلن انك في الطريق'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  -- Session duration end: COALESCE(session_started_at, arrival_confirmed_at, start_at) + (end_at - start_at)
  v_session_ends_at := COALESCE(OLD.session_started_at, OLD.arrival_confirmed_at, OLD.start_at)
                       + (OLD.end_at - OLD.start_at);

  -- Provider completion_requested: booked duration must have elapsed since session start.
  IF v_is_provider AND OLD.status = 'in_progress' AND NEW.status = 'completion_requested' THEN
    IF now() < v_session_ends_at THEN
      v_remaining_minutes := GREATEST(
        1,
        CEIL(EXTRACT(EPOCH FROM (v_session_ends_at - now())) / 60.0)::integer
      );
      RAISE EXCEPTION 'تقدر تطلب انهاء الجلسة بعد % دقيقة', v_remaining_minutes
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Customer completed from completion_requested: same duration rule.
  IF v_is_customer AND OLD.status = 'completion_requested' AND NEW.status = 'completed' THEN
    IF now() < v_session_ends_at THEN
      v_remaining_minutes := GREATEST(
        1,
        CEIL(EXTRACT(EPOCH FROM (v_session_ends_at - now())) / 60.0)::integer
      );
      RAISE EXCEPTION 'تقدر تنهي الجلسة بعد % دقيقة', v_remaining_minutes
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_booking_time_window_guard() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- Transition guard: copy of 20261001121000 body, plus:
--   - customer arrived -> in_progress (not arrival_confirmed)
--   - admin_override bypass of the transition matrix
--   - session_started_at / session_ended_at stamps and write-lock
--   - admin_session_times GUC so admin_set_booking_session_times can write
-- Pricing locks, dispute/no-show, cancellation-through-RPC, and identity
-- locks are unchanged.
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
  v_admin_override boolean := (current_setting('app.admin_override_in_progress', true) = 'on');
  v_admin_session_times boolean := (current_setting('app.admin_session_times_in_progress', true) = 'on');
  v_dispute_eligible CONSTANT public.booking_status[] := ARRAY[
    'on_the_way', 'arrived', 'arrival_confirmed', 'in_progress', 'completion_requested'
  ]::public.booking_status[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  v_is_admin := public.has_role(v_uid, 'admin');

  IF NOT v_admin_session_times AND (
       NEW.session_started_at IS DISTINCT FROM OLD.session_started_at
    OR NEW.session_ended_at IS DISTINCT FROM OLD.session_ended_at
  ) THEN
    RAISE EXCEPTION 'Session timestamps cannot be changed directly.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
     OR NEW.service_id IS DISTINCT FROM OLD.service_id
     OR NEW.address_id IS DISTINCT FROM OLD.address_id
     OR NEW.family_member_id IS DISTINCT FROM OLD.family_member_id
     OR NEW.price_subtotal IS DISTINCT FROM OLD.price_subtotal
     OR NEW.price_discount IS DISTINCT FROM OLD.price_discount
     OR NEW.price_total IS DISTINCT FROM OLD.price_total
     OR NEW.price_platform_fee IS DISTINCT FROM OLD.price_platform_fee
     OR NEW.price_vat IS DISTINCT FROM OLD.price_vat
     OR NEW.price_extras_total IS DISTINCT FROM OLD.price_extras_total
     OR NEW.price_travel_fee IS DISTINCT FROM OLD.price_travel_fee
     OR NEW.price_commission_percent IS DISTINCT FROM OLD.price_commission_percent
     OR NEW.price_commission_amount IS DISTINCT FROM OLD.price_commission_amount
     OR NEW.price_provider_net IS DISTINCT FROM OLD.price_provider_net
     OR NEW.promo_code_id IS DISTINCT FROM OLD.promo_code_id
     OR NEW.promo_code IS DISTINCT FROM OLD.promo_code
     OR NEW.promo_discount_type IS DISTINCT FROM OLD.promo_discount_type
     OR NEW.promo_discount_value IS DISTINCT FROM OLD.promo_discount_value
     OR NEW.promo_description_en IS DISTINCT FROM OLD.promo_description_en
     OR NEW.promo_description_ar IS DISTINCT FROM OLD.promo_description_ar
  THEN
    RAISE EXCEPTION 'Booking customer, provider, service, address, family member, and pricing cannot be changed after creation.'
      USING ERRCODE = '42501';
  END IF;

  IF (NEW.start_at IS DISTINCT FROM OLD.start_at OR NEW.end_at IS DISTINCT FROM OLD.end_at)
     AND current_setting('app.reschedule_in_progress', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Booking schedule can only be changed through an accepted reschedule request.'
      USING ERRCODE = '42501';
  END IF;

  -- Normal cancellation (pending/confirmed) must go through cancel_booking().
  IF v_changing AND NEW.status = 'cancelled' AND OLD.status IN ('pending', 'confirmed')
     AND current_setting('app.cancellation_in_progress', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Bookings can only be cancelled through the cancel_booking function.'
      USING ERRCODE = '42501';
  END IF;

  IF v_changing THEN
    v_is_customer := (OLD.customer_id = v_uid);
    v_is_provider := EXISTS (SELECT 1 FROM public.providers p WHERE p.id = OLD.provider_id AND p.profile_id = v_uid);
    v_is_admin := public.has_role(v_uid, 'admin');

    -- Admin RPC: bypass the transition matrix (not pricing/schedule locks).
    IF v_is_admin AND v_admin_override THEN
      v_allowed := true;
    END IF;

    IF v_is_admin AND (
         (OLD.status = 'disputed' AND NEW.status IN ('completed', 'cancelled') AND current_setting('app.dispute_resolution_in_progress', true) = 'on')
      OR (OLD.status = 'no_show' AND NEW.status IN ('completed', 'cancelled') AND current_setting('app.no_show_resolution_in_progress', true) = 'on')
      OR (OLD.status IN ('pending', 'confirmed') AND NEW.status = 'cancelled')
    ) THEN
      v_allowed := true;
    END IF;

    IF NOT v_allowed AND v_is_provider AND (
         (OLD.status = 'pending' AND NEW.status = 'confirmed')
      OR (OLD.status = 'pending' AND NEW.status = 'cancelled')
      OR (OLD.status = 'confirmed' AND NEW.status = 'on_the_way')
      OR (OLD.status = 'confirmed' AND NEW.status = 'cancelled')
      OR (OLD.status = 'on_the_way' AND NEW.status = 'arrived')
      OR (OLD.status = 'arrival_confirmed' AND NEW.status = 'in_progress')
      OR (OLD.status = 'in_progress' AND NEW.status = 'completion_requested')
    ) THEN
      v_allowed := true;
    END IF;

    -- Customer confirms arrival from arrived by going straight to in_progress.
    -- arrival_confirmed remains only as a legacy source for the provider path.
    IF NOT v_allowed AND v_is_customer AND (
         (OLD.status = 'pending' AND NEW.status = 'cancelled')
      OR (OLD.status = 'confirmed' AND NEW.status = 'cancelled')
      OR (OLD.status = 'arrived' AND NEW.status = 'in_progress')
      -- Legacy step, kept so app versions released before this migration still work.
      OR (OLD.status = 'arrived' AND NEW.status = 'arrival_confirmed')
      OR (OLD.status = 'completion_requested' AND NEW.status = 'completed')
    ) THEN
      v_allowed := true;
    END IF;

    -- Dispute: customer or provider, from anywhere in the active lifecycle
    -- through completion_requested, only via open_booking_dispute().
    IF NOT v_allowed AND (v_is_customer OR v_is_provider) AND NEW.status = 'disputed'
       AND OLD.status = ANY(v_dispute_eligible)
       AND current_setting('app.dispute_in_progress', true) = 'on'
    THEN
      v_allowed := true;
    END IF;

    -- No-show: customer reports provider, provider reports customer, only
    -- via report_no_show(). Eligible states unchanged from the pre-Module-1
    -- lifecycle (on_the_way, arrived).
    IF NOT v_allowed AND (
         (v_is_customer AND NEW.no_show_party = 'provider')
      OR (v_is_provider AND NEW.no_show_party = 'customer')
       )
       AND NEW.status = 'no_show'
       AND OLD.status IN ('on_the_way', 'arrived')
       AND current_setting('app.no_show_in_progress', true) = 'on'
    THEN
      v_allowed := true;
    END IF;

    IF NOT v_allowed THEN
      RAISE EXCEPTION 'Booking transition % -> % is not permitted for this user', OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Lifecycle timestamps. Clients cannot persist session_* or arrival_confirmed_*.
  -- Admin session-times RPC keeps the three NEW timestamps. Admin status RPC
  -- fills any missing stamps with now() when moving forward. Everyone else is
  -- reset to OLD unless this status change is the one that owns the stamp.
  IF v_is_admin AND v_admin_session_times THEN
    NEW.session_started_at := COALESCE(NEW.session_started_at, OLD.session_started_at);
    NEW.session_ended_at := COALESCE(NEW.session_ended_at, OLD.session_ended_at);
    NEW.arrival_confirmed_at := COALESCE(NEW.arrival_confirmed_at, OLD.arrival_confirmed_at);
    NEW.arrival_confirmed_by := OLD.arrival_confirmed_by;
    NEW.status_changed_at := OLD.status_changed_at;
    NEW.status_changed_by := OLD.status_changed_by;
    NEW.completion_requested_at := OLD.completion_requested_at;
    NEW.completed_at := OLD.completed_at;
    NEW.cancelled_at := OLD.cancelled_at;
    NEW.cancelled_by := OLD.cancelled_by;
    NEW.cancellation_reason := OLD.cancellation_reason;
    NEW.no_show_party := OLD.no_show_party;
    NEW.no_show_reported_by := OLD.no_show_reported_by;
    NEW.no_show_reason := OLD.no_show_reason;
    NEW.disputed_at := OLD.disputed_at;
    NEW.dispute_reason := OLD.dispute_reason;
    NEW.dispute_resolved_at := OLD.dispute_resolved_at;
    NEW.dispute_resolved_by := OLD.dispute_resolved_by;
    RETURN NEW;
  END IF;

  IF v_is_admin AND v_admin_override THEN
    NEW.status_changed_at := CASE WHEN v_changing THEN now() ELSE OLD.status_changed_at END;
    NEW.status_changed_by := CASE WHEN v_changing THEN v_uid ELSE OLD.status_changed_by END;

    IF NEW.status IN ('arrival_confirmed', 'in_progress', 'completion_requested', 'completed') THEN
      NEW.arrival_confirmed_at := COALESCE(OLD.arrival_confirmed_at, now());
      NEW.arrival_confirmed_by := COALESCE(OLD.arrival_confirmed_by, v_uid);
    ELSE
      NEW.arrival_confirmed_at := OLD.arrival_confirmed_at;
      NEW.arrival_confirmed_by := OLD.arrival_confirmed_by;
    END IF;

    IF NEW.status IN ('in_progress', 'completion_requested', 'completed') THEN
      NEW.session_started_at := COALESCE(OLD.session_started_at, now());
    ELSE
      NEW.session_started_at := OLD.session_started_at;
    END IF;

    IF NEW.status IN ('completion_requested', 'completed') THEN
      NEW.session_ended_at := COALESCE(OLD.session_ended_at, now());
      NEW.completion_requested_at := COALESCE(OLD.completion_requested_at, now());
    ELSE
      NEW.session_ended_at := OLD.session_ended_at;
      NEW.completion_requested_at := OLD.completion_requested_at;
    END IF;

    IF NEW.status = 'completed' THEN
      NEW.completed_at := COALESCE(OLD.completed_at, now());
    ELSE
      NEW.completed_at := OLD.completed_at;
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

    IF v_changing AND OLD.status = 'disputed' AND NEW.status IN ('completed', 'cancelled') THEN
      NEW.dispute_resolved_at := now(); NEW.dispute_resolved_by := v_uid;
    ELSE
      NEW.dispute_resolved_at := OLD.dispute_resolved_at; NEW.dispute_resolved_by := OLD.dispute_resolved_by;
    END IF;

    RETURN NEW;
  END IF;

  NEW.status_changed_at := CASE WHEN v_changing THEN now() ELSE OLD.status_changed_at END;
  NEW.status_changed_by := CASE WHEN v_changing THEN v_uid ELSE OLD.status_changed_by END;
  NEW.completion_requested_at := CASE WHEN v_changing AND NEW.status = 'completion_requested' THEN now() ELSE OLD.completion_requested_at END;
  NEW.completed_at := CASE WHEN v_changing AND NEW.status = 'completed' THEN now() ELSE OLD.completed_at END;

  -- Arrival + session start. Customer arrived -> in_progress stamps both.
  -- Provider arrival_confirmed -> in_progress (legacy) only stamps session start.
  IF v_changing AND NEW.status = 'arrival_confirmed' THEN
    NEW.arrival_confirmed_at := now();
    NEW.arrival_confirmed_by := v_uid;
    NEW.session_started_at := OLD.session_started_at;
  ELSIF v_changing AND NEW.status = 'in_progress' THEN
    IF OLD.status = 'arrived' THEN
      NEW.arrival_confirmed_at := COALESCE(OLD.arrival_confirmed_at, now());
      NEW.arrival_confirmed_by := COALESCE(OLD.arrival_confirmed_by, v_uid);
    ELSE
      NEW.arrival_confirmed_at := OLD.arrival_confirmed_at;
      NEW.arrival_confirmed_by := OLD.arrival_confirmed_by;
    END IF;
    NEW.session_started_at := COALESCE(OLD.session_started_at, now());
  ELSE
    NEW.arrival_confirmed_at := OLD.arrival_confirmed_at;
    NEW.arrival_confirmed_by := OLD.arrival_confirmed_by;
    NEW.session_started_at := OLD.session_started_at;
  END IF;

  NEW.session_ended_at := CASE
    WHEN v_changing AND NEW.status = 'completion_requested' THEN COALESCE(OLD.session_ended_at, now())
    ELSE OLD.session_ended_at
  END;

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
-- Admin RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_set_booking_status(
  p_booking_id uuid,
  p_status public.booking_status,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_booking public.bookings;
  v_allowed_targets CONSTANT public.booking_status[] := ARRAY[
    'confirmed', 'on_the_way', 'arrived', 'arrival_confirmed',
    'in_progress', 'completion_requested', 'completed', 'cancelled'
  ]::public.booking_status[];
  v_lifecycle CONSTANT public.booking_status[] := ARRAY[
    'pending', 'confirmed', 'on_the_way', 'arrived', 'arrival_confirmed',
    'in_progress', 'completion_requested', 'completed'
  ]::public.booking_status[];
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'Booking is required.' USING ERRCODE = '23514';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required.' USING ERRCODE = '23514';
  END IF;
  IF p_status IS NULL OR NOT (p_status = ANY (v_allowed_targets)) THEN
    RAISE EXCEPTION 'Invalid booking status.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = '42501';
  END IF;
  IF v_booking.status IN ('disputed', 'no_show', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'This booking can no longer be changed.' USING ERRCODE = '23514';
  END IF;

  -- Same or later in lifecycle order. cancelled is always allowed from a
  -- non-terminal source.
  IF p_status IS DISTINCT FROM 'cancelled' THEN
    IF array_position(v_lifecycle, p_status) IS NULL
       OR array_position(v_lifecycle, v_booking.status) IS NULL
       OR array_position(v_lifecycle, p_status) < array_position(v_lifecycle, v_booking.status)
    THEN
      RAISE EXCEPTION 'Booking status can only move forward or stay the same.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  PERFORM set_config('app.admin_override_in_progress', 'on', true);
  PERFORM set_config('app.audit_reason', btrim(p_reason), true);
  -- Keep the cancel_booking() guard unchanged: pending/confirmed still need
  -- this GUC, which cancel_booking() also sets.
  IF p_status = 'cancelled' AND v_booking.status IN ('pending', 'confirmed') THEN
    PERFORM set_config('app.cancellation_in_progress', 'on', true);
  END IF;

  UPDATE public.bookings
  SET status = p_status
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_booking_status(uuid, public.booking_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_booking_status(uuid, public.booking_status, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_booking_session_times(
  p_booking_id uuid,
  p_session_started_at timestamptz,
  p_session_ended_at timestamptz,
  p_arrival_confirmed_at timestamptz,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'Booking is required.' USING ERRCODE = '23514';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required.' USING ERRCODE = '23514';
  END IF;
  IF p_session_started_at IS NULL AND p_session_ended_at IS NULL AND p_arrival_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'At least one timestamp is required.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = p_booking_id) THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.admin_session_times_in_progress', 'on', true);
  PERFORM set_config('app.audit_reason', btrim(p_reason), true);

  -- NULL args leave the current value unchanged. Never touches pricing/promo.
  UPDATE public.bookings
  SET
    session_started_at = COALESCE(p_session_started_at, session_started_at),
    session_ended_at = COALESCE(p_session_ended_at, session_ended_at),
    arrival_confirmed_at = COALESCE(p_arrival_confirmed_at, arrival_confirmed_at)
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_booking_session_times(uuid, timestamptz, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_booking_session_times(uuid, timestamptz, timestamptz, timestamptz, text) TO authenticated;

-- ============================================================
-- Needs-attention queue. Count is exposed as bookings_lifecycle_attention
-- on admin_work_queue_counts. The list RPC is for the admin UI filter.
-- Do not auto-complete or auto-cancel anything.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_bookings_needing_lifecycle_attention()
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT b.id
  FROM public.bookings b
  WHERE
    (b.status = 'confirmed' AND b.end_at < now())
    OR (b.status = 'arrived' AND b.status_changed_at < now() - interval '30 minutes')
    OR (b.status = 'completion_requested' AND b.completion_requested_at < now() - interval '12 hours')
    OR (b.status = 'in_progress' AND now() > b.start_at + (b.end_at - b.start_at) + interval '2 hours');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_bookings_needing_lifecycle_attention() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_bookings_needing_lifecycle_attention() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_work_queue_counts()
RETURNS TABLE(queue text, item_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT 'new_applications'::text, count(*) FROM public.providers p
    WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND p.resubmitted_at IS NULL
      AND p.id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'resubmitted_applications'::text, count(*) FROM public.providers p
    WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND p.resubmitted_at IS NOT NULL
      AND p.id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'new_service_requests'::text, count(*) FROM public.provider_services ps
    JOIN public.providers p ON p.id = ps.provider_id
    WHERE ps.status = 'pending' AND p.onboarding_status = 'APPROVED'
      AND ps.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'price_change_requests'::text, count(*) FROM public.provider_services ps
    WHERE ps.pending_price_override IS NOT NULL AND ps.status = 'approved'
      AND ps.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'pending_services'::text, count(*) FROM public.provider_services ps
    WHERE ps.status = 'pending'
      AND ps.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'pending_teaching_groups'::text, count(*) FROM (
    SELECT 1 FROM public.provider_teaching_capabilities c WHERE c.status = 'pending'
      AND c.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
    GROUP BY c.provider_id, c.service_id, c.subject_id, c.curriculum_id,
      c.session_duration_min, c.session_price
  ) groups_pending
  UNION ALL
  SELECT 'pending_documents'::text, count(*) FROM public.provider_documents d
    WHERE d.status = 'pending'
      AND d.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'open_cases'::text,
    (SELECT count(*) FROM public.disputes d WHERE d.status IN ('open', 'info_requested'))
    + (SELECT count(*) FROM public.support_tickets s WHERE s.status IN ('open', 'pending'))
  UNION ALL
  SELECT 'bookings_needing_action'::text, count(*) FROM public.bookings b
    WHERE b.status IN ('disputed', 'no_show')
  UNION ALL
  SELECT 'payments_pending_review'::text, count(*) FROM public.payments pay
    WHERE pay.status = 'pending_review'
  UNION ALL
  SELECT 'bookings_lifecycle_attention'::text, count(*) FROM public.bookings b
    WHERE
      (b.status = 'confirmed' AND b.end_at < now())
      OR (b.status = 'arrived' AND b.status_changed_at < now() - interval '30 minutes')
      OR (b.status = 'completion_requested' AND b.completion_requested_at < now() - interval '12 hours')
      OR (b.status = 'in_progress' AND now() > b.start_at + (b.end_at - b.start_at) + interval '2 hours');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_work_queue_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_work_queue_counts() TO authenticated;

NOTIFY pgrst, 'reload schema';
