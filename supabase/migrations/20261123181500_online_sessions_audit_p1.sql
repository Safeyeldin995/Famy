-- Codex plan-audit P1/P2 additions for online sessions (Issue #396).

-- ---------------------------------------------------------------------------
-- Settings defaults
-- ---------------------------------------------------------------------------

INSERT INTO public.settings (key, value)
VALUES (
  'online_sessions',
  jsonb_build_object(
    'overlap_percent', 50,
    'disconnect_ignore_seconds', 120,
    'finalize_grace_minutes', 15,
    'monthly_participant_minutes_alert', 10000,
    'launch_tutoring_only', true
  )
)
ON CONFLICT (key) DO NOTHING;

UPDATE public.settings
SET value = value || jsonb_build_object(
  'overlap_percent', 50,
  'disconnect_ignore_seconds', 120,
  'finalize_grace_minutes', 15,
  'monthly_participant_minutes_alert', 10000,
  'launch_tutoring_only', true
)
WHERE key = 'online_sessions'
  AND NOT (value ? 'overlap_percent');

-- Launch default: tutoring category may offer online when admin enables service flags.
UPDATE public.categories
SET online_allowed = true
WHERE slug = 'tutoring'
  AND NOT online_allowed;

-- ---------------------------------------------------------------------------
-- Booking columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS guardian_consent_at timestamptz NULL;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS online_overlap_minutes numeric(10,2) NULL;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS livekit_participant_minutes integer NULL;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS online_session_outcome text NULL;

COMMENT ON COLUMN public.bookings.guardian_consent_at IS
  'Parent/guardian confirmed online session consent when the student is a minor.';
COMMENT ON COLUMN public.bookings.online_session_outcome IS
  'Server-written online session resolution code after grace period.';

-- ---------------------------------------------------------------------------
-- Webhook dedupe (idempotent ingest)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.livekit_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  booking_id uuid NULL REFERENCES public.bookings(id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.livekit_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.livekit_webhook_events TO service_role;

-- ---------------------------------------------------------------------------
-- Admin review queue + idempotent refund ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.online_session_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  reason text NOT NULL,
  overlap_minutes numeric(10,2) NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  resolved_by uuid NULL REFERENCES auth.users(id),
  admin_notes text NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS online_session_reviews_one_open_per_booking_idx
  ON public.online_session_reviews (booking_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS online_session_reviews_status_created_idx
  ON public.online_session_reviews (status, created_at DESC);

ALTER TABLE public.online_session_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.online_session_reviews FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON public.online_session_reviews TO authenticated;
GRANT ALL ON public.online_session_reviews TO service_role;

CREATE POLICY online_session_reviews_admin
  ON public.online_session_reviews FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.online_session_outcome_applications (
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  outcome_code text NOT NULL,
  payment_id uuid NULL REFERENCES public.payments(id) ON DELETE SET NULL,
  refund_channel text NULL CHECK (refund_channel IN ('paymob', 'instapay')),
  refund_status text NOT NULL DEFAULT 'pending'
  CHECK (refund_status IN ('pending', 'ledger_recorded', 'failed', 'not_required')),
  idempotency_ref text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, outcome_code)
);

REVOKE ALL ON public.online_session_outcome_applications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.online_session_outcome_applications TO authenticated;
GRANT ALL ON public.online_session_outcome_applications TO service_role;

CREATE TABLE IF NOT EXISTS public.online_session_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  reporter_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  participant text NOT NULL CHECK (participant IN ('customer', 'provider')),
  reported_at timestamptz NOT NULL DEFAULT now(),
  description text NOT NULL,
  support_ticket_id uuid NULL REFERENCES public.support_tickets(id) ON DELETE SET NULL
);

REVOKE ALL ON public.online_session_reports FROM PUBLIC, anon;
GRANT SELECT ON public.online_session_reports TO authenticated;
GRANT INSERT ON public.online_session_reports TO authenticated;
GRANT ALL ON public.online_session_reports TO service_role;

CREATE POLICY online_session_reports_admin
  ON public.online_session_reports FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY online_session_reports_self
  ON public.online_session_reports FOR SELECT TO authenticated
  USING (reporter_user_id = auth.uid());

CREATE POLICY online_session_reports_insert
  ON public.online_session_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Minor detection
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.family_member_is_minor(p_family_member_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.family_members fm
    WHERE fm.id = p_family_member_id
      AND fm.date_of_birth IS NOT NULL
      AND fm.date_of_birth > (CURRENT_DATE - interval '18 years')
  );
$$;

REVOKE ALL ON FUNCTION public.family_member_is_minor(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_booking: guardian consent + tutoring-only launch gate
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb,
  uuid, text, text, text, text
);

DROP FUNCTION IF EXISTS public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb,
  uuid, text, text, text, text, text
);

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
  p_guardian_consent boolean DEFAULT false
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
  v_launch_tutoring_only boolean;
  v_guardian_consent_at timestamptz := NULL;
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

  SELECT COALESCE((value->>'launch_tutoring_only')::boolean, true)
  INTO v_launch_tutoring_only
  FROM public.settings
  WHERE key = 'online_sessions';
  IF v_mode = 'online' AND COALESCE(v_launch_tutoring_only, true)
     AND v_category_slug IS DISTINCT FROM 'tutoring' THEN
    RAISE EXCEPTION
      'BOOKING_ONLINE_TUTORING_ONLY: Online sessions are limited to tutoring at launch.'
      USING ERRCODE = '23514';
  END IF;

  IF v_mode = 'online'
     AND p_family_member_id IS NOT NULL
     AND public.family_member_is_minor(p_family_member_id) THEN
    IF NOT COALESCE(p_guardian_consent, false) THEN
      RAISE EXCEPTION
        'BOOKING_GUARDIAN_CONSENT_REQUIRED: Guardian consent is required for online sessions with a minor student.'
        USING ERRCODE = '23514';
    END IF;
    v_guardian_consent_at := now();
  END IF;

  IF v_mode = 'in_person' AND v_category_slug IN ('babysitting', 'tutoring') THEN
    IF p_supervision_mode IS NULL
       OR p_supervision_mode NOT IN ('cameras', 'adult_present') THEN
      RAISE EXCEPTION
        'BOOKING_SUPERVISION_REQUIRED: Choose how your child will be supervised during this service.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  v_fingerprint := public.booking_request_fingerprint(
    p_provider_id, p_service_id, v_address, p_start_at, p_end_at,
    p_family_member_id, p_notes, p_promo_code_id,
    coalesce(p_requirement_selections, '[]'::jsonb),
    p_teaching_capability_id, p_teaching_subject_code,
    p_teaching_curriculum_code, p_teaching_level_code,
    p_supervision_mode, v_mode
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
  FROM public.providers WHERE id = p_provider_id;

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
    SELECT 1 FROM public.marketplace_eligibility_internal(
      p_provider_id, p_service_id, v_address, v_mode
    ) e WHERE e.is_eligible
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
      service_mode,
      guardian_consent_at
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
      v_mode,
      v_guardian_consent_at
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

  PERFORM set_config('app.create_booking_in_progress', 'off', true);

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'created', v_created,
    'idempotent_replay', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb,
  uuid, text, text, text, text, text, boolean
) TO authenticated;

-- ---------------------------------------------------------------------------
-- Report and leave (opens support ticket + audit row)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.online_session_report_and_leave(
  p_booking_id uuid,
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
  v_provider_profile uuid;
  v_party text;
  v_ticket_id uuid;
  v_report_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF p_description IS NULL OR length(btrim(p_description)) < 10 THEN
    RAISE EXCEPTION 'Please describe what happened.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_booking.service_mode IS DISTINCT FROM 'online' THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = '42501';
  END IF;

  SELECT profile_id INTO v_provider_profile
  FROM public.providers WHERE id = v_booking.provider_id;

  IF v_booking.customer_id = v_uid THEN
    v_party := 'customer';
  ELSIF v_provider_profile = v_uid THEN
    v_party := 'provider';
  ELSE
    RAISE EXCEPTION 'You are not a participant in this session.' USING ERRCODE = '42501';
  END IF;

  SELECT public.create_support_ticket(
    p_booking_id,
    'provider_behavior',
    'Online session safety report',
    btrim(p_description)
  ) INTO v_ticket_id;

  INSERT INTO public.online_session_reports (
    booking_id, reporter_user_id, participant, description, support_ticket_id
  ) VALUES (
    p_booking_id, v_uid, v_party, btrim(p_description), v_ticket_id
  )
  RETURNING id INTO v_report_id;

  INSERT INTO public.online_session_reviews (booking_id, reason, status)
  VALUES (
    p_booking_id,
    'Participant reported and left the online session during the call.',
    'open'
  )
  ON CONFLICT DO NOTHING;

  RETURN v_report_id;
END;
$$;

REVOKE ALL ON FUNCTION public.online_session_report_and_leave(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.online_session_report_and_leave(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Idempotent online refund application
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_online_session_outcome_refund(
  p_booking_id uuid,
  p_outcome_code text,
  p_cancellation_fee numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_pay public.payments%ROWTYPE;
  v_carried numeric;
  v_fee numeric;
  v_method text;
  v_channel text;
  v_ref text;
  v_idem text;
BEGIN
  v_idem := 'online-session-' || p_outcome_code || '-' || p_booking_id::text;

  IF EXISTS (
    SELECT 1 FROM public.online_session_outcome_applications
    WHERE booking_id = p_booking_id AND outcome_code = p_outcome_code
  ) THEN
    RETURN;
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_pay
  FROM public.payments pay
  WHERE pay.booking_id = p_booking_id
    AND pay.status = 'captured'
    AND COALESCE(pay.payment_method_type, '') IN ('online', 'manual_transfer')
  ORDER BY pay.captured_at DESC NULLS LAST, pay.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.online_session_outcome_applications (
      booking_id, outcome_code, refund_status, idempotency_ref, metadata
    ) VALUES (
      p_booking_id, p_outcome_code, 'not_required', v_idem,
      jsonb_build_object('reason', 'no_captured_payment')
    );
    RETURN;
  END IF;

  PERFORM public.lock_customer_debts(v_booking.customer_id);
  v_method := COALESCE(v_pay.payment_method_code, v_pay.payment_method_type);
  v_channel := CASE WHEN v_pay.payment_method_type = 'online' THEN 'paymob' ELSE 'instapay' END;
  v_ref := v_idem;

  v_fee := LEAST(COALESCE(p_cancellation_fee, 0), v_pay.amount);

  IF p_outcome_code IN ('provider_absent', 'both_absent', 'admin_review_no_events') THEN
    v_fee := 0;
    UPDATE public.customer_debts
    SET status = 'waived',
        resolved_at = now(),
        resolved_by = NULL,
        resolution_note = 'Released on online session provider/platform refund'
    WHERE status = 'open'
      AND (booking_id = p_booking_id OR carried_booking_id = p_booking_id);
    v_carried := 0;
  ELSE
    v_carried := LEAST(
      public.settle_carried_fees(p_booking_id, v_method, NULL),
      v_pay.amount
    );
    v_fee := LEAST(COALESCE(p_cancellation_fee, 0), GREATEST(v_pay.amount - v_carried, 0));
  END IF;

  PERFORM set_config('app.ledger_internal_capture', 'on', true);
  UPDATE public.payments
  SET status = CASE
        WHEN v_fee + v_carried > 0
          THEN 'partially_refunded'::public.payment_status
        ELSE 'refunded'::public.payment_status
      END,
      reviewed_by = NULL,
      reviewed_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'refund', jsonb_build_object(
          'reference', v_ref,
          'amount_refunded', v_pay.amount - v_fee - v_carried,
          'cancellation_fee', v_fee,
          'carried_fees', v_carried,
          'recorded_at', now(),
          'recorded_by', NULL,
          'previous_status', v_pay.status,
          'reason', p_outcome_code,
          'channel', v_channel,
          'external_status', CASE
            WHEN v_channel = 'paymob' THEN 'paymob_manual_or_api_pending'
            ELSE 'instapay_manual_queue'
          END
        )
      )
  WHERE id = v_pay.id;
  PERFORM set_config('app.ledger_internal_capture', 'off', true);

  IF v_fee > 0 AND p_outcome_code = 'customer_absent' THEN
    PERFORM public.ledger_insert_entry(
      v_booking.provider_id, v_booking.id,
      'cancellation_fee_provider_share', 'credit', v_fee,
      v_method, NULL, NULL, NULL
    );
  END IF;

  INSERT INTO public.online_session_outcome_applications (
    booking_id, outcome_code, payment_id, refund_channel,
    refund_status, idempotency_ref, metadata
  ) VALUES (
    p_booking_id, p_outcome_code, v_pay.id, v_channel,
    'ledger_recorded', v_idem,
    jsonb_build_object(
      'amount_refunded', v_pay.amount - v_fee - v_carried,
      'cancellation_fee', v_fee,
      'carried_fees', v_carried
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_online_session_outcome_refund(uuid, text, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_online_session_outcome_refund(uuid, text, numeric)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Overlap resolution (finalize only after end + grace; webhook writes events only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_online_session_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_grace_minutes integer := 15;
  v_ignore_seconds integer := 120;
  v_overlap_percent numeric := 50;
  v_duration_minutes numeric;
  v_required_overlap numeric;
  v_customer_minutes numeric := 0;
  v_provider_minutes numeric := 0;
  v_overlap_minutes numeric := 0;
  v_has_events boolean;
  v_outcome text;
  v_count integer := 0;
BEGIN
  SELECT
    COALESCE((value->>'finalize_grace_minutes')::integer, 15),
    COALESCE((value->>'disconnect_ignore_seconds')::integer, 120),
    COALESCE((value->>'overlap_percent')::numeric, 50)
  INTO v_grace_minutes, v_ignore_seconds, v_overlap_percent
  FROM public.settings
  WHERE key = 'online_sessions';

  FOR v_booking IN
    SELECT b.*, p.profile_id AS provider_user_id
    FROM public.bookings b
    JOIN public.providers p ON p.id = b.provider_id
    WHERE b.service_mode = 'online'
      AND b.status = 'confirmed'
      AND b.end_at + make_interval(mins => v_grace_minutes) <= now()
      AND NOT EXISTS (
        SELECT 1 FROM public.online_session_outcome_applications a
        WHERE a.booking_id = b.id
          AND a.outcome_code IN (
            'completed', 'provider_absent', 'customer_absent',
            'both_absent', 'admin_review_no_events', 'admin_review_low_overlap'
          )
      )
    ORDER BY b.start_at, b.id
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    v_has_events := EXISTS (
      SELECT 1 FROM public.session_events se WHERE se.booking_id = v_booking.id
    );

    IF NOT v_has_events THEN
      v_outcome := 'admin_review_no_events';
      INSERT INTO public.online_session_reviews (booking_id, reason, overlap_minutes)
      SELECT v_booking.id, 'No LiveKit attendance events were recorded.', NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM public.online_session_reviews r
        WHERE r.booking_id = v_booking.id AND r.status = 'open'
      );
      UPDATE public.bookings
      SET online_session_outcome = v_outcome,
          status_changed_at = now()
      WHERE id = v_booking.id;
      INSERT INTO public.online_session_outcome_applications (
        booking_id, outcome_code, refund_status, idempotency_ref
      ) VALUES (
        v_booking.id, v_outcome, 'not_required',
        'online-session-' || v_outcome || '-' || v_booking.id::text
      )
      ON CONFLICT (booking_id, outcome_code) DO NOTHING;
      v_count := v_count + 1;
      CONTINUE;
    END IF;

    SELECT
      COALESCE(SUM(
        GREATEST(
          EXTRACT(EPOCH FROM (
            LEAST(COALESCE(se.left_at, v_booking.end_at), v_booking.end_at)
            - GREATEST(se.joined_at, v_booking.start_at)
          )) / 60.0,
          0
        )
      ) FILTER (WHERE se.participant = 'customer'), 0),
      COALESCE(SUM(
        GREATEST(
          EXTRACT(EPOCH FROM (
            LEAST(COALESCE(se.left_at, v_booking.end_at), v_booking.end_at)
            - GREATEST(se.joined_at, v_booking.start_at)
          )) / 60.0,
          0
        )
      ) FILTER (WHERE se.participant = 'provider'), 0)
    INTO v_customer_minutes, v_provider_minutes
    FROM public.session_events se
    WHERE se.booking_id = v_booking.id;

    v_overlap_minutes := GREATEST(LEAST(v_customer_minutes, v_provider_minutes), 0);
    v_duration_minutes := GREATEST(
      EXTRACT(EPOCH FROM (v_booking.end_at - v_booking.start_at)) / 60.0,
      1
    );
    v_required_overlap := v_duration_minutes * v_overlap_percent / 100.0;

    IF v_customer_minutes <= 0 AND v_provider_minutes <= 0 THEN
      v_outcome := 'both_absent';
    ELSIF v_provider_minutes <= 0 THEN
      v_outcome := 'provider_absent';
    ELSIF v_customer_minutes <= 0 THEN
      v_outcome := 'customer_absent';
    ELSIF v_overlap_minutes >= v_required_overlap THEN
      v_outcome := 'completed';
    ELSE
      v_outcome := 'admin_review_low_overlap';
      INSERT INTO public.online_session_reviews (
        booking_id, reason, overlap_minutes
      ) VALUES (
        v_booking.id,
        'Insufficient overlapping attendance for automatic completion.',
        v_overlap_minutes
      )
      ON CONFLICT DO NOTHING;
    END IF;

  IF v_outcome = 'completed' THEN
      PERFORM set_config('app.auto_complete_in_progress', 'on', true);
      PERFORM set_config('app.audit_reason', 'online_session_auto_complete', true);
      UPDATE public.bookings
      SET status = 'completed',
          online_session_outcome = v_outcome,
          online_overlap_minutes = v_overlap_minutes,
          livekit_participant_minutes =
            CEIL(v_customer_minutes + v_provider_minutes)::integer,
          session_ended_at = COALESCE(session_ended_at, v_booking.end_at),
          completion_requested_at = COALESCE(completion_requested_at, v_booking.end_at),
          completed_at = COALESCE(completed_at, now()),
          status_changed_at = now(),
          status_changed_by = NULL
      WHERE id = v_booking.id AND status = 'confirmed';
      IF FOUND THEN v_count := v_count + 1; END IF;
    ELSIF v_outcome IN ('provider_absent', 'both_absent') THEN
      PERFORM public.lock_customer_debts(v_booking.customer_id);
      PERFORM set_config('app.no_show_in_progress', 'on', true);
      UPDATE public.bookings
      SET status = 'no_show',
          no_show_party = 'provider',
          no_show_reported_by = v_booking.customer_id,
          no_show_reason = 'Automatic online overlap resolution: ' || v_outcome,
          online_session_outcome = v_outcome,
          online_overlap_minutes = v_overlap_minutes,
          status_changed_at = now(),
          status_changed_by = NULL
      WHERE id = v_booking.id AND status = 'confirmed';
      PERFORM public.apply_online_session_outcome_refund(v_booking.id, v_outcome, 0);
      v_count := v_count + 1;
    ELSIF v_outcome = 'customer_absent' THEN
      PERFORM public.lock_customer_debts(v_booking.customer_id);
      PERFORM set_config('app.no_show_in_progress', 'on', true);
      UPDATE public.bookings
      SET status = 'no_show',
          no_show_party = 'customer',
          no_show_reported_by = v_booking.provider_user_id,
          no_show_reason = 'Automatic online overlap resolution: customer absent.',
          online_session_outcome = v_outcome,
          online_overlap_minutes = v_overlap_minutes,
          status_changed_at = now(),
          status_changed_by = NULL
      WHERE id = v_booking.id AND status = 'confirmed';
      PERFORM public.apply_online_session_outcome_refund(
        v_booking.id,
        v_outcome,
        public.cancellation_fee_for_total(v_booking.price_total)
      );
      v_count := v_count + 1;
    ELSE
      UPDATE public.bookings
      SET online_session_outcome = v_outcome,
          online_overlap_minutes = v_overlap_minutes,
          status_changed_at = now()
      WHERE id = v_booking.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_online_session_bookings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_online_session_bookings() TO service_role;

NOTIFY pgrst, 'reload schema';