-- Auto-complete completion_requested bookings after a configurable wait.
-- Additive only. Does not drop tables. Does not mutate existing booking rows.
-- Historic cutoff (completion_auto_from) is set at migration time when missing
-- so bookings requested before this instant are never auto-completed.

-- ============================================================
-- 1) Merge auto-complete keys into settings.booking_expiry.
-- UPDATE ... WHERE key = 'booking_expiry' adds missing keys only; existing
-- admin edits for those keys are left in place.
-- ============================================================
INSERT INTO public.settings (key, value)
VALUES (
  'booking_expiry',
  jsonb_build_object(
    'pending_ttl_hours', 12,
    'min_hours_before_start', 2,
    'auto_complete_hours', 6,
    'completion_auto_from', now()
  )
)
ON CONFLICT (key) DO NOTHING;

UPDATE public.settings
SET value = COALESCE(value, '{}'::jsonb)
  || CASE
       WHEN jsonb_typeof(value->'auto_complete_hours') = 'number' THEN '{}'::jsonb
       ELSE jsonb_build_object('auto_complete_hours', 6)
     END
  || CASE
       WHEN NULLIF(btrim(value->>'completion_auto_from'), '') IS NOT NULL THEN '{}'::jsonb
       ELSE jsonb_build_object('completion_auto_from', now())
     END
WHERE key = 'booking_expiry';

-- ============================================================
-- 2) Shared settings reader. Return type gained two columns, so DROP first.
-- Grant pattern unchanged: authenticated + service_role.
-- ============================================================
DROP FUNCTION IF EXISTS public.booking_expiry_settings();

CREATE OR REPLACE FUNCTION public.booking_expiry_settings()
RETURNS TABLE (
  pending_ttl_hours numeric,
  min_hours_before_start numeric,
  auto_complete_hours numeric,
  completion_auto_from timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value jsonb;
  v_ttl numeric;
  v_min numeric;
  v_auto numeric;
  v_from timestamptz;
BEGIN
  SELECT s.value INTO v_value FROM public.settings s WHERE s.key = 'booking_expiry';
  IF jsonb_typeof(v_value->'pending_ttl_hours') = 'number' THEN
    v_ttl := (v_value->>'pending_ttl_hours')::numeric;
  END IF;
  IF jsonb_typeof(v_value->'min_hours_before_start') = 'number' THEN
    v_min := (v_value->>'min_hours_before_start')::numeric;
  END IF;
  IF jsonb_typeof(v_value->'auto_complete_hours') = 'number' THEN
    v_auto := (v_value->>'auto_complete_hours')::numeric;
  END IF;
  IF jsonb_typeof(v_value->'completion_auto_from') = 'string' THEN
    BEGIN
      v_from := (v_value->>'completion_auto_from')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_from := NULL;
    END;
  END IF;
  pending_ttl_hours := CASE WHEN v_ttl IS NOT NULL AND v_ttl >= 0 THEN v_ttl ELSE 12 END;
  min_hours_before_start := CASE WHEN v_min IS NOT NULL AND v_min >= 0 THEN v_min ELSE 2 END;
  auto_complete_hours := CASE
    WHEN v_auto IS NULL THEN 6
    ELSE LEAST(24, GREATEST(1, v_auto))
  END;
  -- Missing/unparseable cutoff fails closed for auto-complete (now() matches
  -- no already-requested row) and fail-open for the legacy admin stall queue.
  completion_auto_from := COALESCE(v_from, now());
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.booking_expiry_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_expiry_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.booking_expiry_settings() TO service_role;

-- ============================================================
-- 3) auto_complete_bookings — service_role / scheduler only.
-- Status-only UPDATE; stamps and both-party notifications live in the
-- BEFORE/AFTER triggers when app.auto_complete_in_progress is on.
-- Idempotent: a second run finds no matching completion_requested rows.
-- Disputed rows are excluded because status will not match.
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_complete_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hours numeric;
  v_from timestamptz;
  v_row RECORD;
  v_count integer := 0;
BEGIN
  SELECT s.auto_complete_hours, s.completion_auto_from
    INTO v_hours, v_from
  FROM public.booking_expiry_settings() s;

  PERFORM set_config('app.auto_complete_in_progress', 'on', true);
  PERFORM set_config('app.audit_reason', 'auto_complete', true);

  FOR v_row IN
    SELECT b.id
    FROM public.bookings b
    WHERE b.status = 'completion_requested'
      AND b.completion_requested_at IS NOT NULL
      AND b.completion_requested_at >= v_from
      AND b.completion_requested_at + (v_hours * interval '1 hour') <= now()
    ORDER BY b.completion_requested_at
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    UPDATE public.bookings
    SET status = 'completed'
    WHERE id = v_row.id
      AND status = 'completion_requested';

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.auto_complete_bookings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_complete_bookings() TO service_role;

-- ============================================================
-- 4) Transition guard: copy of 20261112120000 body, plus a null-uid
-- auto-complete path that stamps completed_at / status_changed_at and
-- forces status_changed_by NULL while preserving pricing/promo/session
-- fields from OLD. Every other null-uid update still returns NEW early.
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
-- 5) Notify: copy of 20261001140000 body, plus
--   - completion_requested copy mentions auto-close after N hours
--   - completed notifies customer AND provider when auto-complete is on
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_booking_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider_user uuid;
  v_customer_name text;
  v_service_name text;
  v_conversation_id uuid;
  v_customer_link text;
  v_provider_link text;
  v_auto_hours numeric;
  v_auto_hours_n integer;
  v_hours_en text;
  v_hours_ar text;
BEGIN
  SELECT profile_id INTO v_provider_user FROM public.providers WHERE id = NEW.provider_id;
  SELECT full_name INTO v_customer_name FROM public.profiles WHERE id = NEW.customer_id;
  SELECT name_en INTO v_service_name FROM public.services WHERE id = NEW.service_id;
  SELECT id INTO v_conversation_id FROM public.conversations WHERE booking_id = NEW.id;
  v_customer_link := '/booking/' || NEW.id;
  v_provider_link := '/pro/booking/' || NEW.id;

  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        v_provider_user, 'booking_request', 'booking',
        'New booking request',
        COALESCE(v_customer_name, 'A customer') || ' requested ' || COALESCE(v_service_name, 'a service'),
        'New booking request', 'طلب حجز جديد',
        COALESCE(v_customer_name, 'A customer') || ' requested ' || COALESCE(v_service_name, 'a service'),
        COALESCE(v_customer_name, 'عميل') || ' طلب ' || COALESCE(v_service_name, 'خدمة'),
        jsonb_build_object('booking_id', NEW.id), v_provider_link, NEW.id
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP <> 'UPDATE' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'confirmed' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      NEW.customer_id, 'booking_confirmed', 'booking',
      'Booking confirmed', 'Your booking has been accepted.',
      'Booking confirmed', 'تم تأكيد الحجز',
      'Your booking has been accepted.', 'تم قبول حجزك.',
      jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
    );
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Booking confirmed.', 'booking_confirmed');
    END IF;

  ELSIF NEW.status = 'on_the_way' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      NEW.customer_id, 'booking_on_the_way', 'booking',
      'Your provider is on the way', 'Your provider is heading to your location.',
      'Your provider is on the way', 'مزود الخدمة في الطريق إليك',
      'Your provider is heading to your location.', 'مزود الخدمة في طريقه إلى موقعك.',
      jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
    );
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Provider is on the way.', 'on_the_way');
    END IF;

  ELSIF NEW.status = 'arrived' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      NEW.customer_id, 'booking_arrived', 'booking',
      'Your provider has arrived', 'Your provider reported that they have arrived. Please confirm arrival in the app.',
      'Your provider has arrived', 'وصل مزود الخدمة',
      'Your provider reported that they have arrived. Please confirm arrival in the app.', 'أبلغ مزود الخدمة بوصوله. يرجى تأكيد الوصول في التطبيق.',
      jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
    );

  ELSIF NEW.status = 'arrival_confirmed' THEN
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        v_provider_user, 'booking_arrival_confirmed', 'booking',
        'Arrival confirmed', 'The customer confirmed your arrival. You can start the service.',
        'Arrival confirmed', 'تم تأكيد الوصول',
        'The customer confirmed your arrival. You can start the service.', 'أكد العميل وصولك. يمكنك بدء الخدمة.',
        jsonb_build_object('booking_id', NEW.id), v_provider_link, NEW.id
      );
    END IF;

  ELSIF NEW.status = 'in_progress' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      NEW.customer_id, 'booking_in_progress', 'booking',
      'Service started', 'Your service is now in progress.',
      'Service started', 'بدأت الخدمة',
      'Your service is now in progress.', 'خدمتك جارية الآن.',
      jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
    );
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Service started.', 'service_started');
    END IF;

  ELSIF NEW.status = 'completion_requested' THEN
    SELECT s.auto_complete_hours INTO v_auto_hours
    FROM public.booking_expiry_settings() s;
    v_auto_hours_n := GREATEST(1, LEAST(24, ROUND(COALESCE(v_auto_hours, 6))))::integer;
    v_hours_en := v_auto_hours_n::text || CASE WHEN v_auto_hours_n = 1 THEN ' hour' ELSE ' hours' END;
    v_hours_ar := CASE
      WHEN v_auto_hours_n = 1 THEN 'ساعة'
      WHEN v_auto_hours_n = 2 THEN 'ساعتين'
      ELSE v_auto_hours_n::text || ' ساعات'
    END;
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      NEW.customer_id, 'booking_completion_requested', 'booking',
      'Confirm your service',
      'Your provider marked this booking as done. Please confirm to complete it. If there is no problem, it will close automatically after ' || v_hours_en || '.',
      'Confirm your service', 'أكد إتمام الخدمة',
      'Your provider marked this booking as done. Please confirm to complete it. If there is no problem, it will close automatically after ' || v_hours_en || '.',
      'مقدم الخدمة قال إن الخدمة خلصت لو مفيش مشكلة الحجز هيتقفل لوحده بعد ' || v_hours_ar,
      jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
    );
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Provider marked the service as complete. Awaiting customer confirmation.', 'completion_requested');
    END IF;

  ELSIF NEW.status = 'completed' THEN
    IF current_setting('app.auto_complete_in_progress', true) = 'on' THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        NEW.customer_id, 'booking_completed', 'booking',
        'Booking completed', 'This booking was completed automatically because no problem was reported.',
        'Booking completed', 'الحجز خلص لوحده',
        'This booking was completed automatically because no problem was reported.',
        'الحجز اتقفل لوحده عشان مفيش مشكلة اتبلغ عنها',
        jsonb_build_object('booking_id', NEW.id, 'reason', 'auto_complete'), v_customer_link, NEW.id
      );
      IF v_provider_user IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
        VALUES (
          v_provider_user, 'booking_completed', 'booking',
          'Booking completed', 'This booking was completed automatically because the customer did not report a problem.',
          'Booking completed', 'الحجز خلص لوحده',
          'This booking was completed automatically because the customer did not report a problem.',
          'الحجز اتقفل لوحده عشان العميل مبلغش عن مشكلة',
          jsonb_build_object('booking_id', NEW.id, 'reason', 'auto_complete'), v_provider_link, NEW.id
        );
      END IF;
    ELSIF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        v_provider_user, 'booking_completed', 'booking',
        'Booking completed', 'The customer confirmed the service is complete.',
        'Booking completed', 'اكتمل الحجز',
        'The customer confirmed the service is complete.', 'أكد العميل اكتمال الخدمة.',
        jsonb_build_object('booking_id', NEW.id), v_provider_link, NEW.id
      );
    END IF;
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Booking completed.', 'booking_completed');
    END IF;

  ELSIF NEW.status = 'disputed' THEN
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        v_provider_user, 'booking_disputed', 'booking',
        'Booking disputed', 'The customer disputed this booking''s completion. Our team will review it.',
        'Booking disputed', 'حجز محل نزاع',
        'The customer disputed this booking''s completion. Our team will review it.', 'اعترض العميل على إتمام هذا الحجز. سيقوم فريقنا بمراجعته.',
        jsonb_build_object('booking_id', NEW.id), v_provider_link, NEW.id
      );
    END IF;

  ELSIF NEW.status = 'no_show' THEN
    IF NEW.no_show_party = 'provider' AND v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        v_provider_user, 'booking_no_show', 'booking',
        'No-show reported', 'The customer reported that you did not show up for this booking.',
        'No-show reported', 'تم الإبلاغ عن عدم الحضور',
        'The customer reported that you did not show up for this booking.', 'أبلغ العميل بأنك لم تحضر لهذا الحجز.',
        jsonb_build_object('booking_id', NEW.id), v_provider_link, NEW.id
      );
    ELSIF NEW.no_show_party = 'customer' THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        NEW.customer_id, 'booking_no_show', 'booking',
        'No-show reported', 'Your provider reported that you were unavailable for this booking.',
        'No-show reported', 'تم الإبلاغ عن عدم الحضور',
        'Your provider reported that you were unavailable for this booking.', 'أبلغ مزود الخدمة بأنك لم تكن متاحًا لهذا الحجز.',
        jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
      );
    END IF;

  ELSIF NEW.status = 'cancelled' THEN
    -- Latest body from 20260714233000, plus an expiry skip so we do not
    -- send a second customer "declined" notification. Expiry already
    -- inserts customer + provider notifications in expire_pending_bookings().
    IF NEW.cancellation_reason = 'provider_no_response'
       OR current_setting('app.pending_expiry_in_progress', true) = 'on' THEN
      NULL;
    ELSIF OLD.status = 'pending' AND NEW.cancelled_by IS DISTINCT FROM NEW.customer_id THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        NEW.customer_id, 'booking_declined', 'booking',
        'Booking declined', 'Your booking request was not accepted. Please try another provider or time.',
        'Booking declined', 'تم رفض الحجز',
        'Your booking request was not accepted. Please try another provider or time.', 'لم يتم قبول طلب حجزك. يرجى تجربة مزود خدمة أو موعد آخر.',
        jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
      );
    ELSIF NEW.cancelled_by = NEW.customer_id THEN
      IF v_provider_user IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
        VALUES (
          v_provider_user, 'booking_cancelled', 'booking',
          'Booking cancelled', 'The customer cancelled this booking.',
          'Booking cancelled', 'تم إلغاء الحجز',
          'The customer cancelled this booking.', 'ألغى العميل هذا الحجز.',
          jsonb_build_object('booking_id', NEW.id), v_provider_link, NEW.id
        );
      END IF;
    ELSE
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        NEW.customer_id, 'booking_cancelled', 'booking',
        'Booking cancelled', 'Your booking was cancelled.',
        'Booking cancelled', 'تم إلغاء الحجز',
        'Your booking was cancelled.', 'تم إلغاء حجزك.',
        jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
      );
    END IF;
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      IF NEW.cancellation_reason = 'provider_no_response'
         OR current_setting('app.pending_expiry_in_progress', true) = 'on' THEN
        INSERT INTO public.messages (conversation_id, body, system_key)
        VALUES (v_conversation_id, 'Booking request expired.', 'booking_expired');
      ELSE
        INSERT INTO public.messages (conversation_id, body, system_key)
        VALUES (v_conversation_id, 'Booking cancelled.', 'booking_cancelled');
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_booking_notify() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 6) Needs-attention queue: completion_requested stall is legacy-only.
-- Rows requested at/after completion_auto_from are handled by
-- auto_complete_bookings and must not appear here.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_bookings_needing_lifecycle_attention()
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT s.completion_auto_from INTO v_cutoff
  FROM public.booking_expiry_settings() s;

  RETURN QUERY
  SELECT b.id
  FROM public.bookings b
  WHERE
    (b.status = 'confirmed' AND b.end_at < now())
    OR (b.status = 'arrived' AND b.status_changed_at < now() - interval '30 minutes')
    OR (b.status = 'completion_requested'
        AND b.completion_requested_at IS NOT NULL
        AND b.completion_requested_at < v_cutoff
        AND b.completion_requested_at < now() - interval '12 hours')
    OR (b.status = 'in_progress' AND now() > b.start_at + (b.end_at - b.start_at) + interval '2 hours');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_bookings_needing_lifecycle_attention() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_bookings_needing_lifecycle_attention() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_work_queue_counts()
RETURNS TABLE(queue text, item_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_cutoff timestamptz;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT s.completion_auto_from INTO v_cutoff
  FROM public.booking_expiry_settings() s;

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
      OR (b.status = 'completion_requested'
          AND b.completion_requested_at IS NOT NULL
          AND b.completion_requested_at < v_cutoff
          AND b.completion_requested_at < now() - interval '12 hours')
      OR (b.status = 'in_progress' AND now() > b.start_at + (b.end_at - b.start_at) + interval '2 hours');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_work_queue_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_work_queue_counts() TO authenticated;

-- ============================================================
-- 7) Best-effort pg_cron, same pattern as expire_pending_bookings.
-- Every 5 minutes. Environments without pg_cron still work once
-- auto_complete_bookings() is invoked by any scheduler.
-- ============================================================
DO $$
BEGIN
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron extension unavailable (%); schedule auto_complete_bookings() externally.', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'famy-auto-complete-bookings') THEN
      PERFORM cron.unschedule('famy-auto-complete-bookings');
    END IF;
    PERFORM cron.schedule('famy-auto-complete-bookings', '*/5 * * * *', 'SELECT public.auto_complete_bookings();');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron scheduling skipped (%); schedule auto_complete_bookings() externally.', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
