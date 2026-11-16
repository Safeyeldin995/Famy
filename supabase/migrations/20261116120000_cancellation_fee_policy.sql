-- Cancellation fee policy (decided by the Product Owner):
-- * Admin sets the fee as a fixed amount or a percentage of the booking, and the free
--   cancellation window in hours (default 2).
-- * The customer pays the fee when they cancel inside the window, cancel after the provider
--   set off (on_the_way / arrived), or don't show up (no-show reported against the customer).
-- * The whole fee goes to the provider (credited to their wallet); the rest of a prepaid
--   amount goes back to the customer. A provider no-show or provider/admin cancellation is free.

-- 1) Policy (admin-editable in settings; defaults keep today's behaviour: no fee)
INSERT INTO public.settings (key, value)
VALUES ('cancellation_policy', '{"fee_mode": "fixed", "fee_value": 0, "free_cancel_hours": 2}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cancellation_policy()
RETURNS TABLE (fee_mode text, fee_value numeric, free_cancel_hours numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE WHEN s.value->>'fee_mode' = 'percent' THEN 'percent' ELSE 'fixed' END,
    GREATEST(COALESCE((s.value->>'fee_value')::numeric, 0), 0),
    GREATEST(COALESCE((s.value->>'free_cancel_hours')::numeric, 2), 0)
  FROM (SELECT (SELECT value FROM public.settings WHERE key = 'cancellation_policy') AS value) s
$$;

REVOKE ALL ON FUNCTION public.cancellation_policy() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancellation_policy() TO anon, authenticated;

-- Fee for a booking total under the current policy (never more than the total).
CREATE OR REPLACE FUNCTION public.cancellation_fee_for_total(p_total numeric)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT LEAST(
    GREATEST(COALESCE(p_total, 0), 0),
    CASE WHEN p.fee_mode = 'percent'
      THEN round(GREATEST(COALESCE(p_total, 0), 0) * LEAST(p.fee_value, 100) / 100, 2)
      ELSE round(p.fee_value, 2)
    END
  )
  FROM public.cancellation_policy() p
$$;

REVOKE ALL ON FUNCTION public.cancellation_fee_for_total(numeric) FROM PUBLIC, anon, authenticated;

-- 2) Fee recorded with each cancellation (snapshot, so later policy edits don't change it)
ALTER TABLE public.booking_cancellations
  ADD COLUMN IF NOT EXISTS cancellation_fee numeric(12,2) NOT NULL DEFAULT 0
  CHECK (cancellation_fee >= 0);

-- Fee the customer owes for this booking: what it would be if they cancelled now
-- (active bookings), or what was charged (cancelled / customer no-show).
CREATE OR REPLACE FUNCTION public.booking_cancellation_fee(p_booking_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_b public.bookings%ROWTYPE;
  v_free_hours numeric;
BEGIN
  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_uid IS NULL OR NOT (
    v_b.customer_id = v_uid
    OR public.has_role(v_uid, 'admin')
    OR EXISTS (SELECT 1 FROM public.providers p WHERE p.id = v_b.provider_id AND p.profile_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;

  IF v_b.status = 'cancelled' THEN
    RETURN COALESCE((
      SELECT c.cancellation_fee FROM public.booking_cancellations c
      WHERE c.booking_id = p_booking_id ORDER BY c.cancelled_at DESC LIMIT 1
    ), 0);
  END IF;
  IF v_b.status = 'no_show' THEN
    RETURN CASE WHEN v_b.no_show_party = 'customer'
      THEN public.cancellation_fee_for_total(v_b.price_total) ELSE 0 END;
  END IF;
  IF v_b.status IN ('on_the_way', 'arrived') THEN
    RETURN public.cancellation_fee_for_total(v_b.price_total);
  END IF;
  IF v_b.status = 'confirmed' THEN
    SELECT p.free_cancel_hours INTO v_free_hours FROM public.cancellation_policy() p;
    IF now() > v_b.start_at - make_interval(secs => v_free_hours * 3600) THEN
      RETURN public.cancellation_fee_for_total(v_b.price_total);
    END IF;
  END IF;
  RETURN 0;
END;
$$;

REVOKE ALL ON FUNCTION public.booking_cancellation_fee(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_cancellation_fee(uuid) TO authenticated;

-- 3) Customers may also cancel after the provider set off (with the fee).
ALTER TABLE public.cancellation_reasons
  DROP CONSTRAINT IF EXISTS cancellation_reasons_applicable_statuses_check;
ALTER TABLE public.cancellation_reasons
  ADD CONSTRAINT cancellation_reasons_applicable_statuses_check
  CHECK (
    applicable_statuses <@ ARRAY['pending', 'confirmed', 'on_the_way', 'arrived']::public.booking_status[]
    AND array_length(applicable_statuses, 1) > 0
  );
UPDATE public.cancellation_reasons
SET applicable_statuses = applicable_statuses || ARRAY['on_the_way', 'arrived']::public.booking_status[]
WHERE actor_type = 'customer'
  AND NOT ('on_the_way' = ANY(applicable_statuses));

-- Booking status guard: allow the customer's late cancellation (only via cancel_booking).
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
    IF current_setting('app.auto_complete_in_progress', true) = 'on'
       AND OLD.status = 'completion_requested'
       AND NEW.status = 'completed' THEN
      NEW.customer_id := OLD.customer_id;
      NEW.provider_id := OLD.provider_id;
      NEW.service_id := OLD.service_id;
      NEW.address_id := OLD.address_id;
      NEW.family_member_id := OLD.family_member_id;
      NEW.price_subtotal := OLD.price_subtotal;
      NEW.price_discount := OLD.price_discount;
      NEW.price_total := OLD.price_total;
      NEW.price_platform_fee := OLD.price_platform_fee;
      NEW.price_vat := OLD.price_vat;
      NEW.price_extras_total := OLD.price_extras_total;
      NEW.price_travel_fee := OLD.price_travel_fee;
      NEW.price_commission_percent := OLD.price_commission_percent;
      NEW.price_commission_amount := OLD.price_commission_amount;
      NEW.price_provider_net := OLD.price_provider_net;
      NEW.promo_code_id := OLD.promo_code_id;
      NEW.promo_code := OLD.promo_code;
      NEW.promo_discount_type := OLD.promo_discount_type;
      NEW.promo_discount_value := OLD.promo_discount_value;
      NEW.promo_description_en := OLD.promo_description_en;
      NEW.promo_description_ar := OLD.promo_description_ar;
      NEW.start_at := OLD.start_at;
      NEW.end_at := OLD.end_at;
      NEW.session_started_at := OLD.session_started_at;
      NEW.session_ended_at := OLD.session_ended_at;
      NEW.session_duration_min := OLD.session_duration_min;
      NEW.arrival_confirmed_at := OLD.arrival_confirmed_at;
      NEW.arrival_confirmed_by := OLD.arrival_confirmed_by;
      NEW.completion_requested_at := OLD.completion_requested_at;
      NEW.completed_at := COALESCE(OLD.completed_at, now());
      NEW.status_changed_at := now();
      NEW.status_changed_by := NULL;
      RETURN NEW;
    END IF;
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
      -- Late cancellation after the provider set off: only through cancel_booking(),
      -- which records the cancellation fee.
      OR (OLD.status IN ('on_the_way', 'arrived') AND NEW.status = 'cancelled'
          AND current_setting('app.cancellation_in_progress', true) = 'on')
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

CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id uuid, p_reason_id uuid, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_booking RECORD;
  v_reason RECORD;
  v_role text;
  v_fee numeric := 0;
  v_cancellation_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = '42501';
  END IF;

  IF v_booking.customer_id = v_uid THEN
    v_role := 'customer';
  ELSIF EXISTS (SELECT 1 FROM public.providers p WHERE p.id = v_booking.provider_id AND p.profile_id = v_uid) THEN
    v_role := 'provider';
  ELSIF public.has_role(v_uid, 'admin') THEN
    v_role := 'admin';
  ELSE
    RAISE EXCEPTION 'You are not authorized to cancel this booking.' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    v_booking.status IN ('pending', 'confirmed')
    OR (v_role = 'customer' AND v_booking.status IN ('on_the_way', 'arrived'))
  ) THEN
    RAISE EXCEPTION 'This booking has already progressed and can no longer be cancelled this way. Please use support, no-show, or dispute options instead.'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_reason FROM public.cancellation_reasons WHERE id = p_reason_id;
  IF NOT FOUND OR NOT v_reason.is_active THEN
    RAISE EXCEPTION 'Selected cancellation reason is not available.' USING ERRCODE = '23514';
  END IF;
  IF v_reason.actor_type NOT IN (v_role, 'any') THEN
    RAISE EXCEPTION 'Selected cancellation reason is not available for your role.' USING ERRCODE = '23514';
  END IF;
  IF NOT (v_booking.status = ANY(v_reason.applicable_statuses)) THEN
    RAISE EXCEPTION 'Selected cancellation reason does not apply to this booking''s current status.' USING ERRCODE = '23514';
  END IF;
  IF v_reason.requires_note AND (p_note IS NULL OR btrim(p_note) = '') THEN
    RAISE EXCEPTION 'A note is required for this cancellation reason.' USING ERRCODE = '23514';
  END IF;

  -- Only the customer pays a cancellation fee (late, or after the provider set off).
  IF v_role = 'customer' THEN
    v_fee := public.booking_cancellation_fee(p_booking_id);
  END IF;

  -- Narrow, audited carve-out in the immutability guard. Every other write path to
  -- bookings.status = 'cancelled' remains hard blocked.
  PERFORM set_config('app.cancellation_in_progress', 'on', true);
  UPDATE public.bookings SET status = 'cancelled' WHERE id = p_booking_id;

  INSERT INTO public.booking_cancellations (
    booking_id, previous_status, cancelled_by_user_id, cancelled_by_role,
    reason_id, reason_code, reason_name_en, reason_name_ar, note, cancellation_fee
  ) VALUES (
    p_booking_id, v_booking.status, v_uid, v_role,
    v_reason.id, v_reason.code, v_reason.name_en, v_reason.name_ar, NULLIF(btrim(p_note), ''), v_fee
  ) RETURNING id INTO v_cancellation_id;

  RETURN v_cancellation_id;
END;
$$;

-- 4) Provider wallet: the fee is credited to the provider.
ALTER TABLE public.provider_ledger_entries DROP CONSTRAINT IF EXISTS provider_ledger_entries_kind_check;
ALTER TABLE public.provider_ledger_entries ADD CONSTRAINT provider_ledger_entries_kind_check CHECK (kind IN (
  'cash_collected_platform_share', 'online_provider_share', 'payout_sent',
  'debt_payment_received', 'adjustment', 'cancellation_fee_provider_share'
));
ALTER TABLE public.provider_ledger_entries DROP CONSTRAINT IF EXISTS provider_ledger_kind_direction_chk;
ALTER TABLE public.provider_ledger_entries ADD CONSTRAINT provider_ledger_kind_direction_chk CHECK (
  (kind = 'cash_collected_platform_share' AND direction = 'debit')
  OR (kind = 'online_provider_share' AND direction = 'credit')
  OR (kind = 'payout_sent' AND direction = 'debit')
  OR (kind = 'debt_payment_received' AND direction = 'credit')
  OR (kind = 'cancellation_fee_provider_share' AND direction = 'credit')
  OR kind = 'adjustment'
);
DROP INDEX IF EXISTS public.provider_ledger_booking_kind_uidx;
CREATE UNIQUE INDEX provider_ledger_booking_kind_uidx
  ON public.provider_ledger_entries (provider_id, booking_id, kind)
  WHERE booking_id IS NOT NULL
    AND kind IN ('cash_collected_platform_share', 'online_provider_share', 'cancellation_fee_provider_share');

-- 5) Refund = what was paid minus the fee; the fee goes to the provider's wallet.
CREATE OR REPLACE FUNCTION public.admin_record_payment_refund(
  p_payment_id uuid,
  p_reference text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay public.payments%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_fee numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_reference IS NULL OR btrim(p_reference) = '' THEN
    RAISE EXCEPTION 'Refund reference is required' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_booking FROM public.bookings b WHERE b.id = v_pay.booking_id;

  IF v_booking.status::text NOT IN ('cancelled', 'no_show') THEN
    RAISE EXCEPTION 'Refunds are recorded only for cancelled or no-show bookings' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (v_pay.status = 'captured' AND COALESCE(v_pay.payment_method_type, '') IN ('online', 'manual_transfer'))
    OR (v_pay.status = 'pending_review' AND v_pay.payment_method_type = 'manual_transfer'
        AND v_pay.proof_path IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'This payment has no money to refund' USING ERRCODE = '23514';
  END IF;

  v_fee := LEAST(public.booking_cancellation_fee(v_booking.id), v_pay.amount);

  PERFORM set_config('app.audit_reason', 'Refund recorded: ' || btrim(p_reference), true);
  PERFORM set_config('app.ledger_internal_capture', 'on', true);
  UPDATE public.payments
  SET status = CASE WHEN v_fee > 0 THEN 'partially_refunded'::public.payment_status
                    ELSE 'refunded'::public.payment_status END,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'refund', jsonb_build_object(
          'reference', btrim(p_reference),
          'amount_refunded', v_pay.amount - v_fee,
          'cancellation_fee', v_fee,
          'recorded_at', now(),
          'recorded_by', auth.uid(),
          'previous_status', v_pay.status
        )
      )
  WHERE id = p_payment_id;
  PERFORM set_config('app.ledger_internal_capture', 'off', true);

  IF v_fee > 0 THEN
    PERFORM public.ledger_insert_entry(
      v_booking.provider_id, v_booking.id, 'cancellation_fee_provider_share', 'credit', v_fee,
      COALESCE(v_pay.payment_method_code, v_pay.payment_method_type), NULL, auth.uid(), NULL
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_record_payment_refund(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_record_payment_refund(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
