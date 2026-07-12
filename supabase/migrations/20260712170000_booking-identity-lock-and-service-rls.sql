-- Services Phase 4B.2: final security correction.
--
-- Issue 2 — booking identity/pricing immutability.
-- bookings_customer_update / bookings_provider_update only ever checked row
-- OWNERSHIP (USING/WITH CHECK on customer_id / provider_id), never WHICH
-- columns changed. A customer updating their own booking could freely
-- rewrite provider_id, service_id, start_at/end_at, or any price_* field —
-- the transition trigger only validated `status`. This extends the
-- existing tg_validate_booking_transition() (BEFORE UPDATE, fires on every
-- update already, not just status changes) to hard-reject any change to
-- these fields post-creation, for every authenticated caller including
-- admin. No feature in this app updates them today (booking creation sets
-- them once via useCreateBooking; the only existing UPDATE path is status
-- transitions), so this is a pure lock-down, not a behavior change to any
-- real flow — and it makes the "validate active service / approved
-- provider_services offering on any permitted identity-changing update"
-- requirement trivially satisfied, since no such update is permitted at all.
-- If a genuine admin-reassignment need ever arises, it belongs in a new,
-- explicit, separately-validated admin path — not a relaxation of this rule.
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

  -- Identity, schedule, and pricing fields are immutable after creation —
  -- checked first, before any status-transition logic, so it applies even
  -- to updates that don't touch status at all.
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
     OR NEW.service_id IS DISTINCT FROM OLD.service_id
     OR NEW.start_at IS DISTINCT FROM OLD.start_at
     OR NEW.end_at IS DISTINCT FROM OLD.end_at
     OR NEW.price_subtotal IS DISTINCT FROM OLD.price_subtotal
     OR NEW.price_discount IS DISTINCT FROM OLD.price_discount
     OR NEW.price_total IS DISTINCT FROM OLD.price_total
  THEN
    RAISE EXCEPTION 'Booking customer, provider, service, schedule, and pricing cannot be changed after creation.'
      USING ERRCODE = '42501';
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
-- Issue 3 — precise services RLS instead of a blanket USING (true).
--
-- Active services: public, unchanged from the original intent.
-- Inactive services: visible only to (a) a provider who already has a
-- provider_services row for it, or (b) the customer/provider of a booking
-- that references it. Admin is already fully covered by the pre-existing
-- "services_admin_all" FOR ALL policy, so it isn't duplicated here.
-- Two permissive SELECT policies for the same role/command are OR'd by
-- Postgres, so a row is visible if it satisfies either one.
-- ============================================================
DROP POLICY IF EXISTS "services_public_read" ON public.services;

CREATE POLICY "services_active_read" ON public.services
  FOR SELECT TO anon, authenticated
  USING (is_active);

CREATE POLICY "services_inactive_read" ON public.services
  FOR SELECT TO authenticated
  USING (
    NOT is_active
    AND (
      EXISTS (
        SELECT 1 FROM public.provider_services ps
        JOIN public.providers p ON p.id = ps.provider_id
        WHERE ps.service_id = services.id AND p.profile_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.bookings b
        WHERE b.service_id = services.id
          AND (
            b.customer_id = auth.uid()
            OR EXISTS (SELECT 1 FROM public.providers p2 WHERE p2.id = b.provider_id AND p2.profile_id = auth.uid())
          )
      )
    )
  );
