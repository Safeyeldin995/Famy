-- Famy Patch 3 / Module 2: Booking Cancellation Rules.
-- Additive only. Normal cancellation stays gated to pending/confirmed —
-- once a booking reaches on_the_way or later, this path is closed off at
-- the database level; no_show/dispute/support workflows (Patch 4) own
-- everything after that. Nothing here touches pricing snapshots, payments,
-- or existing cancelled-booking rows.

-- ============================================================
-- 1) cancellation_reasons — admin-managed reason catalog, mirrors the
-- payment_methods pattern (public read of active rows, admin full CRUD).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cancellation_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  description_en text,
  description_ar text,
  actor_type text NOT NULL CHECK (actor_type IN ('customer', 'provider', 'admin', 'any')),
  -- Normal cancellation is only ever legal while pending/confirmed (see
  -- cancel_booking below) — enforced again here so no reason can ever be
  -- configured to reach further into the lifecycle than the business rule
  -- allows, even by mistake.
  applicable_statuses public.booking_status[] NOT NULL DEFAULT ARRAY['pending', 'confirmed']::public.booking_status[]
    CHECK (applicable_statuses <@ ARRAY['pending', 'confirmed']::public.booking_status[] AND array_length(applicable_statuses, 1) > 0),
  requires_note boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.cancellation_reasons TO authenticated;
GRANT ALL ON public.cancellation_reasons TO service_role;
ALTER TABLE public.cancellation_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cancellation_reasons_public_read" ON public.cancellation_reasons;
CREATE POLICY "cancellation_reasons_public_read" ON public.cancellation_reasons
  FOR SELECT TO authenticated USING (is_active);
DROP POLICY IF EXISTS "cancellation_reasons_admin_all" ON public.cancellation_reasons;
CREATE POLICY "cancellation_reasons_admin_all" ON public.cancellation_reasons
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_cancellation_reasons_updated ON public.cancellation_reasons;
CREATE TRIGGER trg_cancellation_reasons_updated BEFORE UPDATE ON public.cancellation_reasons
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Reuse the existing generic audit mechanism (see 20260627164621/164829) so
-- admin edits to the reason catalog are recorded the same way every other
-- admin-configurable table already is.
DROP TRIGGER IF EXISTS trg_audit_cancellation_reasons ON public.cancellation_reasons;
CREATE TRIGGER trg_audit_cancellation_reasons AFTER INSERT OR UPDATE OR DELETE ON public.cancellation_reasons
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

INSERT INTO public.cancellation_reasons (code, name_en, name_ar, actor_type, requires_note, display_order) VALUES
  ('customer_change_of_plans', 'Change of plans', 'تغيير في الخطط', 'customer', false, 1),
  ('customer_found_alternative', 'Found another provider or solution', 'وجدت مزود خدمة أو حلاً آخر', 'customer', false, 2),
  ('customer_price_concern', 'Concerned about the price', 'قلق بخصوص السعر', 'customer', false, 3),
  ('customer_scheduling_conflict', 'Scheduling conflict', 'تعارض في المواعيد', 'customer', false, 4),
  ('customer_other', 'Other', 'أخرى', 'customer', true, 5),
  ('provider_unavailable', 'No longer available at this time', 'لم أعد متاحًا في هذا الوقت', 'provider', false, 1),
  ('provider_emergency', 'Personal emergency', 'ظرف طارئ شخصي', 'provider', false, 2),
  ('provider_customer_unreachable', 'Could not reach the customer', 'تعذر التواصل مع العميل', 'provider', false, 3),
  ('provider_scope_mismatch', 'Job details do not match what was booked', 'تفاصيل العمل لا تطابق الحجز', 'provider', true, 4),
  ('provider_other', 'Other', 'أخرى', 'provider', true, 5),
  ('admin_customer_request', 'Cancelled at the customer''s request (support)', 'تم الإلغاء بناءً على طلب العميل (الدعم)', 'admin', true, 1),
  ('admin_provider_request', 'Cancelled at the provider''s request (support)', 'تم الإلغاء بناءً على طلب المحترف (الدعم)', 'admin', true, 2),
  ('admin_policy_violation', 'Policy violation', 'مخالفة للسياسات', 'admin', true, 3),
  ('admin_other', 'Other (support intervention)', 'أخرى (تدخل الدعم)', 'admin', true, 4)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 2) booking_cancellations — one immutable record per cancelled booking.
-- Reason fields are a point-in-time snapshot (never a live join) so later
-- admin edits/deactivation of a reason can never rewrite history.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.booking_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  previous_status public.booking_status NOT NULL,
  cancelled_by_user_id uuid NOT NULL REFERENCES auth.users(id),
  cancelled_by_role text NOT NULL CHECK (cancelled_by_role IN ('customer', 'provider', 'admin')),
  reason_id uuid REFERENCES public.cancellation_reasons(id) ON DELETE SET NULL,
  reason_code text NOT NULL,
  reason_name_en text NOT NULL,
  reason_name_ar text NOT NULL,
  note text,
  cancelled_at timestamptz NOT NULL DEFAULT now()
);
-- A booking can only ever be cancelled once — belt-and-suspenders alongside
-- the row lock inside cancel_booking() against concurrent double-cancellation.
CREATE UNIQUE INDEX IF NOT EXISTS booking_cancellations_one_per_booking ON public.booking_cancellations(booking_id);

GRANT SELECT ON public.booking_cancellations TO authenticated;
GRANT ALL ON public.booking_cancellations TO service_role;
ALTER TABLE public.booking_cancellations ENABLE ROW LEVEL SECURITY;

-- No INSERT/UPDATE/DELETE policy exists for `authenticated` at all — the
-- only write path is cancel_booking() below, which runs SECURITY DEFINER.
DROP POLICY IF EXISTS "booking_cancellations_party_read" ON public.booking_cancellations;
CREATE POLICY "booking_cancellations_party_read" ON public.booking_cancellations FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND (
        b.customer_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.providers p WHERE p.id = b.provider_id AND p.profile_id = auth.uid())
      )
    )
  );

-- Defense in depth: even a caller with elevated grants can never mutate a
-- cancellation record once written, full stop.
CREATE OR REPLACE FUNCTION public.tg_block_cancellation_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Cancellation records are immutable.' USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS trg_cancellation_immutable ON public.booking_cancellations;
CREATE TRIGGER trg_cancellation_immutable BEFORE UPDATE OR DELETE ON public.booking_cancellations
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_cancellation_mutation();

DROP TRIGGER IF EXISTS trg_audit_booking_cancellations ON public.booking_cancellations;
CREATE TRIGGER trg_audit_booking_cancellations AFTER INSERT ON public.booking_cancellations
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

-- ============================================================
-- 3) Guard direct client mutation of bookings.status = 'cancelled' — same
-- transaction-local-flag pattern already used for start_at/end_at in
-- 20260713180000. Full replace of the Module 1 (family_members) body: adds
-- the cancellation guard and lets admin force-cancel pending/confirmed
-- bookings (the RPC below is the only caller that can ever set the flag).
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
     OR NEW.family_member_id IS DISTINCT FROM OLD.family_member_id
     OR NEW.price_subtotal IS DISTINCT FROM OLD.price_subtotal
     OR NEW.price_discount IS DISTINCT FROM OLD.price_discount
     OR NEW.price_total IS DISTINCT FROM OLD.price_total
     OR NEW.price_platform_fee IS DISTINCT FROM OLD.price_platform_fee
     OR NEW.price_vat IS DISTINCT FROM OLD.price_vat
     OR NEW.price_extras_total IS DISTINCT FROM OLD.price_extras_total
     OR NEW.price_travel_fee IS DISTINCT FROM OLD.price_travel_fee
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

  IF v_changing AND NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled'
     AND current_setting('app.cancellation_in_progress', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Bookings can only be cancelled through the cancel_booking function.'
      USING ERRCODE = '42501';
  END IF;

  IF v_changing THEN
    v_is_customer := (OLD.customer_id = v_uid);
    v_is_provider := EXISTS (SELECT 1 FROM public.providers p WHERE p.id = OLD.provider_id AND p.profile_id = v_uid);
    v_is_admin := public.has_role(v_uid, 'admin');

    IF v_is_admin AND (
         (OLD.status = 'disputed' AND NEW.status IN ('completed', 'cancelled'))
      OR (OLD.status = 'no_show' AND NEW.status IN ('completed', 'cancelled'))
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
-- 4) cancel_booking — the one atomic, server-authoritative cancellation
-- path for all three actor types. Role is derived from the caller's actual
-- relationship to the booking (never trusted from the client), so a
-- customer/provider/admin each automatically gets their own reason list and
-- permissions with a single function.
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id uuid, p_reason_id uuid, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_booking RECORD;
  v_reason RECORD;
  v_role text;
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

  IF v_booking.status NOT IN ('pending', 'confirmed') THEN
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

  -- Narrow, audited carve-out in the immutability guard — mirrors how
  -- reschedule acceptance flips app.reschedule_in_progress. Every other
  -- write path to bookings.status = 'cancelled' remains hard blocked.
  PERFORM set_config('app.cancellation_in_progress', 'on', true);
  UPDATE public.bookings SET status = 'cancelled' WHERE id = p_booking_id;

  INSERT INTO public.booking_cancellations (
    booking_id, previous_status, cancelled_by_user_id, cancelled_by_role,
    reason_id, reason_code, reason_name_en, reason_name_ar, note
  ) VALUES (
    p_booking_id, v_booking.status, v_uid, v_role,
    v_reason.id, v_reason.code, v_reason.name_en, v_reason.name_ar, NULLIF(btrim(p_note), '')
  ) RETURNING id INTO v_cancellation_id;

  RETURN v_cancellation_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cancel_booking(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid, uuid, text) TO authenticated;
