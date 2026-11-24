-- Codex second audit (PO-aligned): no auto attendance money, unpaid confirm expiry,
-- lesson issue reports + payout hold, customer age 12+ for online, provider privacy.

DROP FUNCTION IF EXISTS public.apply_online_session_payment_outcome(
  public.bookings, text, numeric, boolean
);
DROP FUNCTION IF EXISTS public.booking_expiry_settings();
DROP FUNCTION IF EXISTS public.online_session_settings();

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS date_of_birth date NULL;

COMMENT ON COLUMN public.profiles.date_of_birth IS
  'Required before the customer''s first online lesson (12+ self-book).';

CREATE OR REPLACE FUNCTION public.online_session_settings()
RETURNS TABLE (
  overlap_ratio numeric,
  disconnect_ignore_seconds integer,
  grace_minutes_after_end integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    LEAST(
      GREATEST(COALESCE((s.value->>'overlap_ratio')::numeric, 0.5), 0),
      1
    ),
    GREATEST(COALESCE((s.value->>'disconnect_ignore_seconds')::integer, 120), 0),
    GREATEST(COALESCE((s.value->>'grace_minutes_after_end')::integer, 15), 0)
  FROM public.settings s
  WHERE s.key = 'online_sessions'
  UNION ALL
  SELECT 0.5::numeric, 120, 15
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.booking_online_age_years(
  p_customer_id uuid,
  p_family_member_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_family_member_id IS NOT NULL THEN (
      SELECT EXTRACT(year FROM age(CURRENT_DATE, fm.date_of_birth::date))::integer
      FROM public.family_members fm
      WHERE fm.id = p_family_member_id AND fm.customer_id = p_customer_id
    )
    ELSE (
      SELECT EXTRACT(year FROM age(CURRENT_DATE, pr.date_of_birth))::integer
      FROM public.profiles pr
      WHERE pr.id = p_customer_id
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.booking_online_age_years(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_online_age_years(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.booking_expiry_settings()
RETURNS TABLE (
  pending_ttl_hours numeric,
  min_hours_before_start numeric,
  auto_complete_hours numeric,
  completion_auto_from timestamptz,
  confirmed_unpaid_hours_after_confirm numeric,
  confirmed_unpaid_minutes_before_start numeric
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
  pending_ttl_hours := NULL;
  min_hours_before_start := NULL;
  IF jsonb_typeof(v_value->'pending_ttl_hours') = 'number' THEN
    pending_ttl_hours := (v_value->>'pending_ttl_hours')::numeric;
  END IF;
  IF jsonb_typeof(v_value->'min_hours_before_start') = 'number' THEN
    min_hours_before_start := (v_value->>'min_hours_before_start')::numeric;
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
  pending_ttl_hours :=
    CASE WHEN pending_ttl_hours IS NOT NULL AND pending_ttl_hours >= 0 THEN pending_ttl_hours ELSE 12 END;
  min_hours_before_start :=
    CASE WHEN min_hours_before_start IS NOT NULL AND min_hours_before_start >= 0
      THEN min_hours_before_start ELSE 2 END;
  auto_complete_hours := CASE
    WHEN v_auto IS NULL THEN 6
    ELSE LEAST(24, GREATEST(1, v_auto))
  END;
  completion_auto_from := COALESCE(v_from, now());
  confirmed_unpaid_hours_after_confirm :=
    COALESCE((v_value->>'confirmed_unpaid_hours_after_confirm')::numeric, 2);
  confirmed_unpaid_minutes_before_start :=
    COALESCE((v_value->>'confirmed_unpaid_minutes_before_start')::numeric, 60);
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.booking_expiry_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_expiry_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.booking_expiry_settings() TO service_role;

CREATE OR REPLACE FUNCTION public.expire_unpaid_confirmed_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings record;
  v_row RECORD;
  v_deadline timestamptz;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_settings FROM public.booking_expiry_settings() LIMIT 1;

  FOR v_row IN
    SELECT b.*
    FROM public.bookings b
    WHERE b.service_mode = 'online'
      AND b.status = 'confirmed'
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.booking_id = b.id
          AND p.status = 'captured'
          AND COALESCE(p.payment_method_type, '') IN ('online', 'manual_transfer')
      )
    ORDER BY b.start_at, b.id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_deadline := LEAST(
      COALESCE(v_row.status_changed_at, v_row.created_at)
        + (v_settings.confirmed_unpaid_hours_after_confirm * interval '1 hour'),
      v_row.start_at - (v_settings.confirmed_unpaid_minutes_before_start * interval '1 minute')
    );
  IF now() < v_deadline THEN
      CONTINUE;
    END IF;

    PERFORM set_config('app.audit_reason', 'unpaid_confirmed_expired', true);
    UPDATE public.bookings
    SET status = 'cancelled',
        cancellation_reason = 'Payment deadline passed before the online lesson.',
        status_changed_at = now(),
        status_changed_by = NULL
    WHERE id = v_row.id AND status = 'confirmed';
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_unpaid_confirmed_bookings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unpaid_confirmed_bookings() TO service_role;

CREATE TABLE IF NOT EXISTS public.online_lesson_issue_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  reported_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reporter_role text NOT NULL CHECK (reporter_role IN ('customer', 'provider')),
  category text NOT NULL CHECK (category IN ('absence', 'connection', 'behavior')),
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'rejected')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
  minor_involved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  resolved_by uuid NULL REFERENCES auth.users(id),
  admin_notes text NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS online_lesson_issue_reports_open_reporter_uidx
  ON public.online_lesson_issue_reports (booking_id, reported_by)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS online_lesson_issue_reports_open_age_idx
  ON public.online_lesson_issue_reports (created_at)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS online_lesson_issue_reports_resolved_by_idx
  ON public.online_lesson_issue_reports (resolved_by);

ALTER TABLE public.online_lesson_issue_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.online_lesson_issue_reports FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.online_lesson_issue_reports TO authenticated;
GRANT ALL ON public.online_lesson_issue_reports TO service_role;

CREATE POLICY online_lesson_issue_reports_party_read
  ON public.online_lesson_issue_reports FOR SELECT TO authenticated
  USING (
    reported_by = (select auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.bookings b
      JOIN public.providers p ON p.id = b.provider_id
      WHERE b.id = booking_id
        AND (b.customer_id = (select auth.uid()) OR p.profile_id = (select auth.uid()))
    )
    OR public.has_role((select auth.uid()), 'admin')
  );

CREATE POLICY online_lesson_issue_reports_party_insert
  ON public.online_lesson_issue_reports FOR INSERT TO authenticated
  WITH CHECK (reported_by = (select auth.uid()));

CREATE POLICY online_lesson_issue_reports_admin_write
  ON public.online_lesson_issue_reports FOR ALL TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'))
  WITH CHECK (public.has_role((select auth.uid()), 'admin'));

CREATE OR REPLACE FUNCTION public.report_online_lesson_issue(
  p_booking_id uuid,
  p_category text,
  p_description text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_booking public.bookings%ROWTYPE;
  v_role text;
  v_age integer;
  v_minor boolean := false;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR SHARE;
  IF NOT FOUND OR v_booking.service_mode IS DISTINCT FROM 'online' THEN
    RAISE EXCEPTION 'Not an online lesson booking.' USING ERRCODE = '23514';
  END IF;

  SELECT CASE
    WHEN v_booking.customer_id = v_uid THEN 'customer'
    WHEN EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = v_booking.provider_id AND p.profile_id = v_uid
    ) THEN 'provider'
    ELSE NULL
  END INTO v_role;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
  END IF;

  IF now() < v_booking.start_at - interval '10 minutes'
     OR now() > v_booking.end_at + interval '24 hours' THEN
    RAISE EXCEPTION 'Reporting is closed for this lesson window.' USING ERRCODE = '23514';
  END IF;

  IF p_category NOT IN ('absence', 'connection', 'behavior') THEN
    RAISE EXCEPTION 'Invalid report category.' USING ERRCODE = '23514';
  END IF;

  IF btrim(p_description) = '' OR length(btrim(p_description)) < 10 THEN
    RAISE EXCEPTION 'Description required.' USING ERRCODE = '23514';
  END IF;

  v_age := public.booking_online_age_years(v_booking.customer_id, v_booking.family_member_id);
  v_minor := v_age IS NOT NULL AND v_age < 18;

  SELECT r.id INTO v_id
  FROM public.online_lesson_issue_reports r
  WHERE r.booking_id = p_booking_id
    AND r.reported_by = v_uid
    AND r.status = 'open';

  IF v_id IS NULL THEN
    INSERT INTO public.online_lesson_issue_reports (
      booking_id, reported_by, reporter_role, category, description, priority, minor_involved
    ) VALUES (
      p_booking_id, v_uid, v_role, p_category, btrim(p_description),
      CASE WHEN v_minor THEN 'high' ELSE 'normal' END,
      v_minor
    )
    RETURNING id INTO v_id;
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.bookings
    SET provider_payout_held = true
    WHERE id = p_booking_id AND provider_payout_held IS NOT TRUE;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.report_online_lesson_issue(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_online_lesson_issue(uuid, text, text) TO authenticated;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS provider_payout_held boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.ledger_apply_booking_shares(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_cutoff timestamptz;
  v_platform_share numeric;
  v_pay public.payments%ROWTYPE;
  v_carried numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('famy_ledger_booking:' || p_booking_id::text, 0));
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_booking.status IS DISTINCT FROM 'completed' THEN
    RETURN;
  END IF;

  IF v_booking.provider_payout_held
     OR EXISTS (
       SELECT 1 FROM public.online_lesson_issue_reports r
       WHERE r.booking_id = p_booking_id AND r.status = 'open'
     ) THEN
    RETURN;
  END IF;

  SELECT * INTO v_pay
  FROM public.payments
  WHERE booking_id = p_booking_id
  ORDER BY CASE WHEN status = 'captured' THEN 0 ELSE 1 END, created_at DESC
  LIMIT 1;

  IF FOUND AND v_booking.carried_fees_amount > 0 THEN
    IF COALESCE(v_pay.payment_method_type, '') = 'cash' THEN
      v_carried := public.settle_carried_fees(p_booking_id, 'cash', NULL);
      IF v_carried > 0 THEN
        PERFORM public.ledger_insert_entry(
          v_booking.provider_id, p_booking_id, 'carried_fee_collected', 'debit',
          v_carried, 'cash', NULL, NULL, NULL
        );
      END IF;
    ELSIF v_pay.status = 'captured'
          AND COALESCE(v_pay.payment_method_type, '') IN ('online', 'manual_transfer') THEN
      PERFORM public.settle_carried_fees(
        p_booking_id, COALESCE(v_pay.payment_method_code, v_pay.payment_method_type), NULL
      );
    END IF;
  END IF;

  IF v_booking.price_provider_net IS NULL THEN
    RETURN;
  END IF;

  SELECT s.ledger_auto_from INTO v_cutoff FROM public.provider_settlement_settings() s;
  IF v_booking.completed_at IS NULL OR v_booking.completed_at < v_cutoff THEN
    RETURN;
  END IF;

  v_platform_share := GREATEST(COALESCE(v_booking.price_total, 0) - COALESCE(v_booking.price_provider_net, 0), 0);

  IF v_pay.id IS NULL THEN
    RETURN;
  END IF;

  IF COALESCE(v_pay.payment_method_type, '') = 'cash' THEN
    IF v_platform_share > 0 THEN
      PERFORM public.ledger_insert_entry(
        v_booking.provider_id, p_booking_id, 'cash_collected_platform_share', 'debit',
        v_platform_share, 'cash', NULL, NULL, NULL
      );
    END IF;
    IF v_pay.status IS DISTINCT FROM 'captured' THEN
      PERFORM set_config('app.ledger_internal_capture', 'on', true);
      UPDATE public.payments
      SET status = 'captured', captured_at = COALESCE(captured_at, now())
      WHERE id = v_pay.id AND status IS DISTINCT FROM 'captured';
      PERFORM set_config('app.ledger_internal_capture', 'off', true);
    END IF;
  ELSIF v_pay.status = 'captured'
        AND COALESCE(v_pay.payment_method_type, '') IN ('online', 'manual_transfer')
        AND COALESCE(v_booking.price_provider_net, 0) > 0 THEN
    PERFORM public.ledger_insert_entry(
      v_booking.provider_id, p_booking_id, 'online_provider_share', 'credit',
      v_booking.price_provider_net,
      COALESCE(v_pay.payment_method_code, v_pay.payment_method_type), NULL, NULL, NULL
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_party_profiles(p_booking_ids uuid[])
RETURNS TABLE (
  booking_id uuid,
  viewer_role text,
  other_user_id uuid,
  other_name text,
  other_avatar_url text,
  other_phone text,
  area text,
  zone_name_en text,
  zone_name_ar text,
  member_first_name text,
  member_age_years integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_booking_ids IS NULL OR cardinality(p_booking_ids) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_booking_ids) > 200 THEN
    RAISE EXCEPTION 'Too many bookings requested' USING ERRCODE = '22023';
  END IF;
  v_admin := public.has_role(v_uid, 'admin');

  RETURN QUERY
  WITH scoped AS (
    SELECT
      b.id,
      b.status,
      b.service_mode,
      b.customer_id,
      pv.profile_id AS provider_user_id,
      CASE
        WHEN b.customer_id = v_uid THEN 'customer'
        WHEN pv.profile_id = v_uid THEN 'provider'
        ELSE 'admin'
      END AS role,
      b.status IN ('confirmed', 'on_the_way', 'arrived', 'arrival_confirmed', 'in_progress', 'completion_requested') AS is_active,
      b.status IN ('pending', 'confirmed', 'on_the_way', 'arrived', 'arrival_confirmed', 'in_progress', 'completion_requested') AS is_open
    FROM public.bookings b
    JOIN public.providers pv ON pv.id = b.provider_id
    WHERE b.id = ANY (p_booking_ids)
      AND b.deleted_at IS NULL
      AND (b.customer_id = v_uid OR pv.profile_id = v_uid OR v_admin)
  )
  SELECT
    s.id,
    s.role,
    other.id,
    NULLIF(btrim(other.full_name), ''),
    other.avatar_url,
    CASE
      WHEN s.service_mode = 'online' AND s.role = 'provider' THEN NULL
      WHEN s.is_active OR s.role = 'admin' THEN other.phone
    END,
    CASE WHEN s.is_active OR s.role = 'admin' OR s.role = 'customer'
      THEN COALESCE(NULLIF(btrim(bl.area), ''), NULLIF(btrim(bl.city), ''))
    END,
    CASE WHEN s.is_open OR s.role IN ('admin', 'customer') THEN bl.zone_name_en END,
    CASE WHEN s.is_open OR s.role IN ('admin', 'customer') THEN bl.zone_name_ar END,
    CASE WHEN (s.role = 'provider' AND s.is_open) OR s.role = 'admin'
      THEN NULLIF(split_part(btrim(fm.full_name), ' ', 1), '')
    END,
    CASE WHEN ((s.role = 'provider' AND s.is_open) OR s.role = 'admin') AND fm.date_of_birth IS NOT NULL
      THEN date_part('year', age(current_date, fm.date_of_birth))::integer
    END
  FROM scoped s
  JOIN public.bookings b ON b.id = s.id
  JOIN public.profiles other
    ON other.id = CASE WHEN s.role = 'customer' THEN s.provider_user_id ELSE s.customer_id END
  LEFT JOIN public.booking_locations bl ON bl.booking_id = s.id
  LEFT JOIN public.booking_family_member_snapshots fm ON fm.booking_id = s.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_booking(
  p_provider_id uuid,
  p_service_id uuid,
  p_address_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_idempotency_key uuid,
  p_family_member_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_promo_code_id uuid DEFAULT NULL,
  p_requirement_selections jsonb DEFAULT '[]'::jsonb,
  p_teaching_capability_id uuid DEFAULT NULL,
  p_teaching_subject_code text DEFAULT NULL,
  p_teaching_curriculum_code text DEFAULT NULL,
  p_teaching_level_code text DEFAULT NULL,
  p_supervision_mode text DEFAULT NULL,
  p_service_mode text DEFAULT 'in_person',
  p_online_guardian_consent boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mode text := COALESCE(NULLIF(btrim(p_service_mode), ''), 'in_person');
  v_address uuid;
  v_fingerprint text;
  v_existing RECORD;
  v_booking_id uuid;
  v_created boolean := false;
  v_min_hours_before_start numeric;
  v_provider_min_notice integer;
  v_required_hours numeric;
  v_category_slug text;
  v_age integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '42501';
  END IF;
  IF public.is_not_suspended(v_uid) IS NOT TRUE THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Account is suspended.'
      USING ERRCODE = '42501';
  END IF;
  IF v_mode NOT IN ('in_person', 'online') THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Invalid service mode.'
      USING ERRCODE = '23514';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Idempotency key is required.'
      USING ERRCODE = '23514';
  END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Invalid booking time range.'
      USING ERRCODE = '23514';
  END IF;

  v_address := CASE WHEN v_mode = 'online' THEN NULL ELSE p_address_id END;

  SELECT cat.slug INTO v_category_slug
  FROM public.services s
  JOIN public.categories cat ON cat.id = s.category_id
  WHERE s.id = p_service_id;

  IF v_mode = 'in_person' AND v_category_slug IN ('babysitting', 'tutoring') THEN
    IF p_supervision_mode IS NULL
       OR p_supervision_mode NOT IN ('cameras', 'adult_present') THEN
      RAISE EXCEPTION
        'BOOKING_SUPERVISION_REQUIRED: Choose how your child will be supervised during this service.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_mode = 'online' THEN
    v_age := public.booking_online_age_years(v_uid, p_family_member_id);
    IF v_age IS NULL THEN
      RAISE EXCEPTION
        'BOOKING_ONLINE_BIRTH_DATE_REQUIRED: Add a date of birth before booking an online lesson.'
        USING ERRCODE = '23514';
    ELSIF v_age < 12 THEN
      RAISE EXCEPTION
        'BOOKING_ONLINE_AGE_MINIMUM: Online lessons are available from age 12.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  v_fingerprint := public.booking_request_fingerprint(
    p_provider_id,
    p_service_id,
    v_address,
    p_start_at,
    p_end_at,
    p_family_member_id,
    p_notes,
    p_promo_code_id,
    coalesce(p_requirement_selections, '[]'::jsonb),
    p_teaching_capability_id,
    p_teaching_subject_code,
    p_teaching_curriculum_code,
    p_teaching_level_code,
    p_supervision_mode,
    v_mode
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':' || p_idempotency_key::text, 0)
  );

  SELECT id, request_fingerprint INTO v_existing
  FROM public.bookings
  WHERE customer_id = v_uid AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION
        'BOOKING_DUPLICATE_REQUEST_CONFLICT: Idempotency key reused with different booking details.'
        USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object(
      'booking_id', v_existing.id,
      'created', false,
      'idempotent_replay', true
    );
  END IF;

  SELECT s.min_hours_before_start INTO v_min_hours_before_start
  FROM public.booking_expiry_settings() s;

  SELECT min_notice_hours INTO v_provider_min_notice
  FROM public.providers
  WHERE id = p_provider_id;

  v_required_hours := GREATEST(
    COALESCE(v_min_hours_before_start, 2),
    COALESCE(v_provider_min_notice, 0)::numeric
  );
  IF p_start_at < now() + (v_required_hours * interval '1 hour') THEN
    RAISE EXCEPTION
      'BOOKING_INVALID_BOOKING_REQUEST: This start time is too soon for the provider to respond in time.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.marketplace_eligibility_internal(
      p_provider_id, p_service_id, v_address, v_mode
    ) e
    WHERE e.is_eligible
  ) THEN
    RAISE EXCEPTION
      'BOOKING_PROVIDER_INELIGIBLE: Provider is not eligible for this service mode and address.'
      USING ERRCODE = '23514';
  END IF;

  IF public.provider_cash_debt_blocked(p_provider_id) THEN
    RAISE EXCEPTION
      'BOOKING_PROVIDER_SETTLEMENT_BLOCKED: Provider cannot receive new bookings until platform balance is settled.'
      USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.create_booking_in_progress', 'on', true);

  BEGIN
    INSERT INTO public.bookings (
      customer_id,
      provider_id,
      service_id,
      address_id,
      start_at,
      end_at,
      status,
      notes,
      family_member_id,
      requirement_selections,
      promo_code_id,
      price_subtotal,
      price_discount,
      price_total,
      price_platform_fee,
      price_vat,
      price_extras_total,
      price_travel_fee,
      idempotency_key,
      request_fingerprint,
      currency,
      teaching_capability_id,
      teaching_subject_code,
      teaching_curriculum_code,
      teaching_level_code,
      supervision_mode,
      service_mode
    ) VALUES (
      v_uid,
      p_provider_id,
      p_service_id,
      v_address,
      p_start_at,
      p_end_at,
      'pending',
      NULLIF(btrim(p_notes), ''),
      p_family_member_id,
      coalesce(p_requirement_selections, '[]'::jsonb),
      p_promo_code_id,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      p_idempotency_key,
      v_fingerprint,
      'EGP',
      p_teaching_capability_id,
      NULLIF(btrim(p_teaching_subject_code), ''),
      NULLIF(btrim(p_teaching_curriculum_code), ''),
      NULLIF(btrim(p_teaching_level_code), ''),
      p_supervision_mode,
      v_mode
    )
    RETURNING id INTO v_booking_id;
    v_created := true;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id, request_fingerprint INTO v_existing
      FROM public.bookings
      WHERE customer_id = v_uid AND idempotency_key = p_idempotency_key;

      IF FOUND AND v_existing.request_fingerprint = v_fingerprint THEN
        RETURN jsonb_build_object(
          'booking_id', v_existing.id,
          'created', false,
          'idempotent_replay', true
        );
      END IF;
      RAISE EXCEPTION
        'BOOKING_DUPLICATE_REQUEST_CONFLICT: Concurrent duplicate booking request.'
        USING ERRCODE = '23514';
    WHEN exclusion_violation THEN
      RAISE EXCEPTION
        'BOOKING_SLOT_UNAVAILABLE: That time slot is no longer available.'
        USING ERRCODE = '23514';
    WHEN SQLSTATE '23514' THEN
      RAISE;
    WHEN SQLSTATE '42501' THEN
      RAISE;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'BOOKING_%' THEN
        RAISE;
      END IF;
      RAISE EXCEPTION
        'BOOKING_INVALID_BOOKING_REQUEST: Unable to create booking.'
        USING ERRCODE = '23514';
  END;

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'created', v_created,
    'idempotent_replay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_work_queue_counts()
RETURNS TABLE(queue text, item_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
  SELECT 'bookings_needing_action'::text,
    (SELECT count(*) FROM public.bookings b WHERE b.status IN ('disputed', 'no_show'))
    + (SELECT count(*) FROM public.online_session_admin_reviews rc WHERE rc.status = 'open')
  UNION ALL
  SELECT 'online_lesson_issue_reports'::text,
    (SELECT count(*) FROM public.online_lesson_issue_reports r WHERE r.status = 'open')
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

NOTIFY pgrst, 'reload schema';