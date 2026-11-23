-- Online sessions: Codex audit scope (safety, attendance overlap, refunds, P2 launch flags).

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS guardian_consent_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS online_session_outcome text NULL,
  ADD COLUMN IF NOT EXISTS online_participant_minutes integer NULL;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_online_session_outcome_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_online_session_outcome_check
  CHECK (
    online_session_outcome IS NULL
    OR online_session_outcome IN (
      'complete',
      'provider_absent',
      'customer_absent',
      'both_absent',
      'admin_review_overlap',
      'admin_review_no_events'
    )
  );

CREATE TABLE IF NOT EXISTS public.session_livekit_webhook_events (
  id text PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  participant text NULL CHECK (participant IS NULL OR participant IN ('customer', 'provider')),
  event_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_livekit_webhook_events_booking_idx
  ON public.session_livekit_webhook_events (booking_id, event_at);

ALTER TABLE public.session_livekit_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.session_livekit_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.session_livekit_webhook_events TO authenticated;
GRANT SELECT, INSERT ON public.session_livekit_webhook_events TO service_role;

CREATE POLICY session_livekit_webhook_events_admin_read
  ON public.session_livekit_webhook_events
  FOR SELECT
  TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));

CREATE TABLE IF NOT EXISTS public.online_session_admin_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'dismissed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS online_session_admin_reviews_open_booking_idx
  ON public.online_session_admin_reviews (booking_id)
  WHERE status = 'open';

ALTER TABLE public.online_session_admin_reviews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.online_session_admin_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.online_session_admin_reviews TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.online_session_admin_reviews TO service_role;

CREATE POLICY online_session_admin_reviews_admin_all
  ON public.online_session_admin_reviews
  FOR ALL
  TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

INSERT INTO public.settings (key, value)
VALUES (
  'online_sessions',
  jsonb_build_object(
    'overlap_ratio', 0.5,
    'disconnect_ignore_seconds', 120,
    'monthly_usage_alert_minutes', NULL
  )
)
ON CONFLICT (key) DO NOTHING;

UPDATE public.settings
SET value = value || jsonb_build_object(
  'overlap_ratio', COALESCE((value->>'overlap_ratio')::numeric, 0.5),
  'disconnect_ignore_seconds', COALESCE((value->>'disconnect_ignore_seconds')::integer, 120),
  'monthly_usage_alert_minutes', value->'monthly_usage_alert_minutes'
)
WHERE key = 'online_sessions';

-- v1 launch: online_allowed only for tutoring (flag stays generic on schema).
UPDATE public.categories
SET online_allowed = true
WHERE slug = 'tutoring';

UPDATE public.services s
SET online_allowed = true
FROM public.categories c
WHERE c.id = s.category_id AND c.slug = 'tutoring';

CREATE OR REPLACE FUNCTION public.family_member_is_minor(p_member_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_member_id IS NULL THEN false
    ELSE (
      SELECT EXTRACT(year FROM age((fm.date_of_birth::date)))::integer < 18
      FROM public.family_members fm
      WHERE fm.id = p_member_id
        AND fm.date_of_birth IS NOT NULL
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.family_member_is_minor(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_member_is_minor(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.online_session_settings()
RETURNS TABLE (overlap_ratio numeric, disconnect_ignore_seconds integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    LEAST(
      GREATEST(COALESCE((s.value->>'overlap_ratio')::numeric, 0.5), 0),
      1
    ) AS overlap_ratio,
    GREATEST(COALESCE((s.value->>'disconnect_ignore_seconds')::integer, 120), 0)
      AS disconnect_ignore_seconds
  FROM public.settings s
  WHERE s.key = 'online_sessions'
  UNION ALL
  SELECT 0.5::numeric, 120
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.online_session_settings() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.open_online_session_admin_review(
  p_booking_id uuid,
  p_reason text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.online_session_admin_reviews r
    WHERE r.booking_id = p_booking_id AND r.status = 'open'
  ) THEN
    RETURN;
  END IF;
  INSERT INTO public.online_session_admin_reviews (booking_id, reason, metadata)
  VALUES (p_booking_id, p_reason, COALESCE(p_metadata, '{}'::jsonb));
  UPDATE public.payments
  SET needs_admin_review = true
  WHERE booking_id = p_booking_id
    AND status IN ('captured', 'pending_review');
END;
$$;

REVOKE ALL ON FUNCTION public.open_online_session_admin_review(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_online_session_admin_review(uuid, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.online_session_refund_reference(
  p_booking_id uuid,
  p_outcome text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'online-session-outcome-' || p_outcome || '-' || p_booking_id::text;
$$;

REVOKE ALL ON FUNCTION public.online_session_refund_reference(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_online_session_payment_outcome(
  p_booking public.bookings,
  p_outcome text,
  p_cancellation_fee numeric,
  p_settle_carried boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay public.payments%ROWTYPE;
  v_ref text := public.online_session_refund_reference(p_booking.id, p_outcome);
  v_carried numeric := 0;
  v_fee numeric;
  v_method text;
  v_refund_amount numeric;
  v_manual boolean;
BEGIN
  SELECT * INTO v_pay
  FROM public.payments pay
  WHERE pay.booking_id = p_booking.id
    AND pay.status IN ('captured', 'pending_review')
    AND COALESCE(pay.payment_method_type, '') IN ('online', 'manual_transfer')
  ORDER BY pay.captured_at DESC NULLS LAST, pay.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
  IF p_outcome IN ('provider_absent', 'both_absent', 'customer_absent') THEN
      RAISE EXCEPTION 'Paid online booking has no refundable payment.'
        USING ERRCODE = 'P0002';
    END IF;
    RETURN;
  END IF;

  IF v_pay.metadata ? 'refund'
     AND (v_pay.metadata->'refund'->>'reference') = v_ref THEN
    RETURN;
  END IF;

  v_method := COALESCE(v_pay.payment_method_code, v_pay.payment_method_type);
  v_manual := COALESCE(v_pay.payment_method_type, '') = 'manual_transfer';

  IF p_settle_carried THEN
    v_carried := LEAST(
      public.settle_carried_fees(p_booking.id, v_method, NULL),
      v_pay.amount
    );
  END IF;

  v_fee := LEAST(
    COALESCE(p_cancellation_fee, 0),
    GREATEST(v_pay.amount - v_carried, 0)
  );

  IF p_outcome = 'provider_absent' OR p_outcome = 'both_absent' THEN
    v_fee := 0;
    v_carried := 0;
  END IF;

  v_refund_amount := GREATEST(v_pay.amount - v_fee - v_carried, 0);

  PERFORM set_config('app.ledger_internal_capture', 'on', true);
  UPDATE public.payments
  SET status = CASE
        WHEN v_fee + v_carried > 0
          THEN 'partially_refunded'::public.payment_status
        ELSE 'refunded'::public.payment_status
      END,
      needs_admin_review = CASE
        WHEN v_manual THEN true
        ELSE needs_admin_review
      END,
      reviewed_by = NULL,
      reviewed_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'refund', jsonb_build_object(
          'reference', v_ref,
          'amount_refunded', v_refund_amount,
          'cancellation_fee', v_fee,
          'carried_fees', v_carried,
          'recorded_at', now(),
          'recorded_by', NULL,
          'previous_status', v_pay.status,
          'reason', 'online_session_' || p_outcome,
          'channel', CASE WHEN v_manual THEN 'instapay_manual' ELSE 'paymob' END,
          'customer_visible_status', CASE
            WHEN v_manual THEN 'refund_pending_review'
            ELSE 'refund_processing'
          END
        )
      )
  WHERE id = v_pay.id;
  PERFORM set_config('app.ledger_internal_capture', 'off', true);

  IF v_fee > 0 THEN
    PERFORM public.ledger_insert_entry(
      p_booking.provider_id,
      p_booking.id,
      'cancellation_fee_provider_share',
      'credit',
      v_fee,
      v_method,
      NULL,
      NULL,
      NULL
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_online_session_payment_outcome(
  public.bookings, text, numeric, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_online_session_payment_outcome(
  public.bookings, text, numeric, boolean
) TO service_role;

-- Overlap minutes with 2-minute disconnect merge (per participant interval sets).
CREATE OR REPLACE FUNCTION public.online_session_overlap_minutes(p_booking_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_ignore interval;
  v_end_cap timestamptz;
  v_customer numeric := 0;
  v_provider numeric := 0;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT make_interval(secs => s.disconnect_ignore_seconds)
  INTO v_ignore
  FROM public.online_session_settings() s;

  v_end_cap := LEAST(now(), v_booking.end_at);

  WITH raw AS (
    SELECT
      se.participant,
      se.joined_at AS start_at,
      COALESCE(se.left_at, v_end_cap) AS end_at
    FROM public.session_events se
    WHERE se.booking_id = p_booking_id
      AND se.joined_at < v_end_cap
  ), ordered AS (
    SELECT
      participant,
      start_at,
      GREATEST(end_at, start_at) AS end_at,
      lag(GREATEST(end_at, start_at)) OVER (
        PARTITION BY participant ORDER BY start_at
      ) AS prev_end
    FROM raw
  ), merged AS (
    SELECT
      participant,
      start_at,
      end_at,
      sum(CASE
        WHEN prev_end IS NULL OR start_at - prev_end > v_ignore THEN 1
        ELSE 0
      END) OVER (PARTITION BY participant ORDER BY start_at) AS grp
    FROM ordered
  ), intervals AS (
    SELECT participant, min(start_at) AS start_at, max(end_at) AS end_at
    FROM merged
    GROUP BY participant, grp
  )
  SELECT
    COALESCE(sum(
      EXTRACT(epoch FROM (
        LEAST(c.end_at, p.end_at) - GREATEST(c.start_at, p.start_at)
      )) / 60.0
    ), 0)
  INTO v_customer
  FROM intervals c
  JOIN intervals p ON p.participant = 'provider'
  WHERE c.participant = 'customer'
    AND c.end_at > c.start_at
    AND p.end_at > p.start_at
    AND LEAST(c.end_at, p.end_at) > GREATEST(c.start_at, p.start_at);

  RETURN GREATEST(v_customer, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.online_session_overlap_minutes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.online_session_overlap_minutes(uuid) TO service_role;

DROP FUNCTION IF EXISTS public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb,
  uuid, text, text, text, text, text
);

DROP FUNCTION IF EXISTS public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb,
  uuid, text, text, text, text, text, boolean
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
  v_needs_consent boolean;
  v_guardian_consent_at timestamptz;
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

  -- Online bookings never retain an unrelated address reference.
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

  v_needs_consent :=
    v_mode = 'online'
    AND p_family_member_id IS NOT NULL
    AND public.family_member_is_minor(p_family_member_id);

  IF v_needs_consent AND COALESCE(p_online_guardian_consent, false) IS NOT TRUE THEN
    RAISE EXCEPTION
      'BOOKING_GUARDIAN_CONSENT_REQUIRED: Guardian consent is required for online sessions with a minor.'
      USING ERRCODE = '23514';
  END IF;

  v_guardian_consent_at := CASE WHEN v_needs_consent THEN now() ELSE NULL END;

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

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'created', v_created,
    'idempotent_replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb,
  uuid, text, text, text, text, text, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb,
  uuid, text, text, text, text, text, boolean
) TO authenticated;

CREATE OR REPLACE FUNCTION public.online_session_participant_present(
  p_booking_id uuid,
  p_participant text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.session_events se
    WHERE se.booking_id = p_booking_id
      AND se.participant = p_participant
      AND (
        se.left_at IS NULL
        OR se.left_at > se.joined_at + interval '1 second'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.online_session_participant_present(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.online_session_participant_present(uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_online_session_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_settings record;
  v_overlap numeric;
  v_required numeric;
  v_duration_min numeric;
  v_outcome text;
  v_reporter uuid;
  v_reported_party text;
  v_reason text;
  v_cancellation_fee numeric;
  v_event_count integer;
  v_customer_present boolean;
  v_provider_present boolean;
  v_participant_minutes integer;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_settings FROM public.online_session_settings() LIMIT 1;

  FOR v_booking IN
    SELECT
      b.*,
      p.profile_id AS provider_user_id
    FROM public.bookings b
    JOIN public.providers p ON p.id = b.provider_id
    WHERE b.service_mode = 'online'
      AND b.status = 'confirmed'
      AND b.end_at + interval '15 minutes' <= now()
      AND b.online_session_outcome IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.payments pay
        WHERE pay.booking_id = b.id
          AND pay.status = 'captured'
          AND COALESCE(pay.payment_method_type, '') IN ('online', 'manual_transfer')
      )
    ORDER BY b.end_at, b.id
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    SELECT count(*)::integer INTO v_event_count
    FROM public.session_events se
    WHERE se.booking_id = v_booking.id;

    v_duration_min := GREATEST(
      EXTRACT(epoch FROM (v_booking.end_at - v_booking.start_at)) / 60.0,
      0
    );
    v_required := v_duration_min * COALESCE(v_settings.overlap_ratio, 0.5);
    v_overlap := public.online_session_overlap_minutes(v_booking.id);
    v_customer_present := public.online_session_participant_present(v_booking.id, 'customer');
    v_provider_present := public.online_session_participant_present(v_booking.id, 'provider');

    IF v_event_count = 0 THEN
      v_outcome := 'admin_review_no_events';
    ELSIF NOT v_customer_present AND NOT v_provider_present THEN
      v_outcome := 'both_absent';
    ELSIF NOT v_provider_present THEN
      v_outcome := 'provider_absent';
    ELSIF NOT v_customer_present THEN
      v_outcome := 'customer_absent';
    ELSIF v_overlap < v_required THEN
      v_outcome := 'admin_review_overlap';
    ELSE
      v_outcome := 'complete';
    END IF;

  UPDATE public.bookings
  SET online_session_outcome = v_outcome
  WHERE id = v_booking.id AND online_session_outcome IS NULL;

    IF v_outcome = 'complete' THEN
      SELECT COALESCE(
        sum(
          GREATEST(
            EXTRACT(
              epoch FROM (
                COALESCE(se.left_at, LEAST(now(), v_booking.end_at)) - se.joined_at
              )
            ),
            0
          )
        )::integer / 60,
        0
      ) INTO v_participant_minutes
      FROM public.session_events se
      WHERE se.booking_id = v_booking.id;

      PERFORM set_config('app.auto_complete_in_progress', 'on', true);
      PERFORM set_config('app.audit_reason', 'online_session_auto_complete', true);

      UPDATE public.bookings
      SET status = 'completed',
          online_participant_minutes = v_participant_minutes,
          session_started_at = COALESCE(session_started_at, v_booking.start_at),
          session_ended_at = COALESCE(session_ended_at, v_booking.end_at),
          completion_requested_at = COALESCE(completion_requested_at, v_booking.end_at),
          completed_at = COALESCE(completed_at, now()),
          status_changed_at = now(),
          status_changed_by = NULL
      WHERE id = v_booking.id
        AND status = 'confirmed';

      v_count := v_count + 1;
      CONTINUE;
    END IF;

    IF v_outcome IN ('admin_review_no_events', 'admin_review_overlap') THEN
      PERFORM public.open_online_session_admin_review(
        v_booking.id,
        'Automatic online session resolution: ' || v_outcome,
        jsonb_build_object(
          'overlap_minutes', v_overlap,
          'required_overlap_minutes', v_required,
          'event_count', v_event_count
        )
      );
      v_count := v_count + 1;
      CONTINUE;
    END IF;

    PERFORM public.lock_customer_debts(v_booking.customer_id);
    PERFORM set_config('app.no_show_in_progress', 'on', true);

    IF v_outcome = 'provider_absent' THEN
      v_reporter := v_booking.customer_id;
      v_reported_party := 'provider';
      v_reason :=
        'Automatic online-session resolution: provider absent (no verified attendance).';
      v_cancellation_fee := 0;
    ELSIF v_outcome = 'customer_absent' THEN
      v_reporter := v_booking.provider_user_id;
      v_reported_party := 'customer';
      v_reason :=
        'Automatic online-session resolution: customer absent (no verified attendance).';
      v_cancellation_fee := public.cancellation_fee_for_total(v_booking.price_total);
    ELSE
      v_reporter := NULL;
      v_reported_party := NULL;
      v_reason :=
        'Automatic online-session resolution: both parties absent.';
      v_cancellation_fee := 0;
    END IF;

    IF v_outcome = 'both_absent' THEN
      UPDATE public.bookings
      SET status = 'cancelled',
          cancellation_reason = v_reason,
          status_changed_at = now(),
          status_changed_by = NULL
      WHERE id = v_booking.id AND status = 'confirmed';
    ELSE
      PERFORM set_config(
        'app.audit_reason',
        'online_session_' || v_reported_party || '_no_show',
        true
      );
      UPDATE public.bookings
      SET status = 'no_show',
          no_show_party = v_reported_party,
          no_show_reported_by = v_reporter,
          no_show_reason = v_reason,
          status_changed_at = now(),
          status_changed_by = NULL
      WHERE id = v_booking.id
        AND status = 'confirmed';

      INSERT INTO public.no_show_reports (
        booking_id,
        reported_by,
        reporter_role,
        reported_party,
        previous_status,
        reason,
        evidence_paths,
        cancellation_fee,
        status,
        admin_notes,
        resolved_at
      ) VALUES (
        v_booking.id,
        v_reporter,
        CASE WHEN v_reported_party = 'provider' THEN 'customer' ELSE 'provider' END,
        v_reported_party,
        v_booking.status,
        v_reason,
        '{}'::text[],
        v_cancellation_fee,
        'resolved',
        'Automatically resolved from overlapped attendance policy.',
        now()
      );
    END IF;

    PERFORM public.apply_online_session_payment_outcome(
      v_booking,
      v_outcome,
      v_cancellation_fee,
      v_outcome = 'customer_absent'
    );

    IF v_outcome = 'customer_absent' THEN
      IF EXISTS (
        SELECT 1 FROM public.customer_debts d
        WHERE d.booking_id = v_booking.id AND d.status = 'paid'
      ) THEN
        NULL;
      ELSIF EXISTS (
        SELECT 1 FROM public.customer_debts d
        JOIN public.bookings cb ON cb.id = d.carried_booking_id
        WHERE d.booking_id = v_booking.id
          AND d.status = 'open'
          AND cb.status::text NOT IN ('cancelled', 'no_show', 'completed')
      ) THEN
        NULL;
      ELSE
        UPDATE public.customer_debts
        SET status = 'waived',
            resolved_at = now(),
            resolved_by = NULL,
            resolution_note = 'Deducted from the automatic online no-show refund'
        WHERE booking_id = v_booking.id
          AND status = 'open';
      END IF;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_online_session_bookings()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_online_session_bookings()
  TO service_role;

NOTIFY pgrst, 'reload schema';