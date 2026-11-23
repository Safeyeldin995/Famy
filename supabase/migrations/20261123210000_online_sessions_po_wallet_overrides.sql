-- PO overrides (#396): no guardian consent, evidence-only session resolution, online
-- cancellation policy per service_mode, unpaid online expiry, customer wallet ledger.

ALTER TABLE public.bookings DROP COLUMN IF EXISTS guardian_consent_at;

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
  p_service_mode text DEFAULT 'in_person'
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

REVOKE ALL ON FUNCTION public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb,
  uuid, text, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb,
  uuid, text, text, text, text, text
) TO authenticated;

-- ---------------------------------------------------------------------------
-- Cancellation policy per service_mode (online default: 4h free, 50% fee)
-- ---------------------------------------------------------------------------
UPDATE public.settings
SET value = CASE
  WHEN value ? 'in_person' OR value ? 'online' THEN value
  ELSE jsonb_build_object(
    'in_person', value,
    'online', jsonb_build_object(
      'fee_mode', 'percent',
      'fee_value', 50,
      'free_cancel_hours', 4
    )
  )
END
WHERE key = 'cancellation_policy';

INSERT INTO public.settings (key, value)
VALUES (
  'online_prepayment',
  jsonb_build_object(
    'hours_after_confirm', 2,
    'hours_before_start', 1
  )
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.online_prepayment_settings()
RETURNS TABLE (hours_after_confirm numeric, hours_before_start numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    GREATEST(COALESCE((s.value->>'hours_after_confirm')::numeric, 2), 0),
    GREATEST(COALESCE((s.value->>'hours_before_start')::numeric, 1), 0)
  FROM public.settings s
  WHERE s.key = 'online_prepayment'
  UNION ALL
  SELECT 2::numeric, 1::numeric
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.cancellation_policy_for(p_service_mode text DEFAULT 'in_person')
RETURNS TABLE (fee_mode text, fee_value numeric, free_cancel_hours numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE WHEN (mode.value->>'fee_mode') = 'percent' THEN 'percent' ELSE 'fixed' END,
    GREATEST(COALESCE((mode.value->>'fee_value')::numeric, 0), 0),
    GREATEST(COALESCE((mode.value->>'free_cancel_hours')::numeric, 2), 0)
  FROM (
    SELECT COALESCE(
      (SELECT value FROM public.settings WHERE key = 'cancellation_policy'),
      '{}'::jsonb
    ) AS root
  ) s
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      CASE
        WHEN p_service_mode = 'online' AND s.root ? 'online' THEN s.root->'online'
        WHEN s.root ? 'in_person' THEN s.root->'in_person'
        ELSE s.root
      END,
      jsonb_build_object('fee_mode', 'fixed', 'fee_value', 0, 'free_cancel_hours', 2)
    ) AS value
  ) mode;
$$;

CREATE OR REPLACE FUNCTION public.cancellation_policy()
RETURNS TABLE (fee_mode text, fee_value numeric, free_cancel_hours numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.cancellation_policy_for('in_person');
$$;

CREATE OR REPLACE FUNCTION public.cancellation_fee_for_total(
  p_total numeric,
  p_service_mode text DEFAULT 'in_person'
)
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
  FROM public.cancellation_policy_for(COALESCE(NULLIF(btrim(p_service_mode), ''), 'in_person')) p;
$$;

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
  v_mode text;
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

  v_mode := COALESCE(NULLIF(btrim(v_b.service_mode), ''), 'in_person');

  IF v_b.status = 'cancelled' THEN
    RETURN COALESCE((
      SELECT c.cancellation_fee FROM public.booking_cancellations c
      WHERE c.booking_id = p_booking_id ORDER BY c.cancelled_at DESC LIMIT 1
    ), 0);
  END IF;
  IF v_b.status = 'no_show' THEN
    IF v_b.no_show_party IS DISTINCT FROM 'customer' THEN
      RETURN 0;
    END IF;
    RETURN COALESCE((
      SELECT r.cancellation_fee FROM public.no_show_reports r
      WHERE r.booking_id = p_booking_id AND r.reported_party = 'customer'
      ORDER BY r.created_at DESC LIMIT 1
    ), public.cancellation_fee_for_total(v_b.price_total, v_mode));
  END IF;
  IF v_b.status IN ('on_the_way', 'arrived') THEN
    RETURN public.cancellation_fee_for_total(v_b.price_total, v_mode);
  END IF;
  IF v_b.status = 'confirmed' THEN
    SELECT p.free_cancel_hours INTO v_free_hours FROM public.cancellation_policy_for(v_mode) p;
    IF now() > v_b.start_at - make_interval(secs => v_free_hours * 3600) THEN
      RETURN public.cancellation_fee_for_total(v_b.price_total, v_mode);
    END IF;
  END IF;
  RETURN 0;
END;
$$;

-- ---------------------------------------------------------------------------
-- Session resolver: evidence only (no automatic refunds or status changes)
-- ---------------------------------------------------------------------------
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
  v_event_count integer;
  v_customer_present boolean;
  v_provider_present boolean;
  v_participant_minutes integer;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_settings FROM public.online_session_settings() LIMIT 1;

  FOR v_booking IN
    SELECT b.*
    FROM public.bookings b
    WHERE b.service_mode = 'online'
      AND b.status IN ('confirmed', 'completed')
      AND b.end_at + interval '15 minutes' <= now()
      AND b.online_session_outcome IS NULL
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

    UPDATE public.bookings
    SET online_session_outcome = v_outcome,
        online_participant_minutes = v_participant_minutes
    WHERE id = v_booking.id AND online_session_outcome IS NULL;

    IF v_outcome IN ('admin_review_no_events', 'admin_review_overlap') THEN
      PERFORM public.open_online_session_admin_review(
        v_booking.id,
        'Online session evidence: ' || v_outcome,
        jsonb_build_object(
          'overlap_minutes', v_overlap,
          'required_overlap_minutes', v_required,
          'event_count', v_event_count,
          'outcome', v_outcome
        )
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Expire confirmed online bookings without captured prepayment

CREATE OR REPLACE FUNCTION public.credit_customer_wallet_customer_cancelled(p_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_pay public.payments%ROWTYPE;
  v_fee numeric;
  v_credit numeric;
  v_entry_id uuid;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR COALESCE(v_booking.service_mode, 'in_person') <> 'online' THEN
    RETURN NULL;
  END IF;

  PERFORM public.lock_customer_debts(v_booking.customer_id);
  PERFORM public.lock_customer_wallet(v_booking.customer_id);

  IF NOT public.booking_money_held(p_booking_id) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_pay
  FROM public.payments
  WHERE booking_id = p_booking_id
    AND status = 'captured'
    AND COALESCE(payment_method_type, '') IN ('online', 'manual_transfer')
  ORDER BY captured_at DESC NULLS LAST, created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_fee := LEAST(public.booking_cancellation_fee(p_booking_id), v_pay.amount);
  v_credit := GREATEST(v_pay.amount - v_fee, 0);

  IF v_credit > 0 THEN
    v_entry_id := public.customer_wallet_insert_entry(
      v_booking.customer_id,
      'credit',
      v_credit,
      'customer_cancelled_refund',
      p_booking_id,
      v_pay.id,
      NULL,
      'customer_cancelled:' || p_booking_id::text,
      jsonb_build_object('cancellation_fee', v_fee)
    );
  END IF;

  IF v_fee > 0 THEN
    PERFORM public.ledger_insert_entry(
      v_booking.provider_id,
      v_booking.id,
      'cancellation_fee_provider_share',
      'credit',
      v_fee,
      COALESCE(v_pay.payment_method_code, v_pay.payment_method_type),
      NULL,
      NULL,
      NULL
    );
  END IF;

  RETURN v_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_customer_wallet_customer_cancelled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credit_customer_wallet_customer_cancelled(uuid) TO service_role;

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

  IF v_role = 'customer' THEN
    v_fee := public.booking_cancellation_fee(p_booking_id);
  END IF;

  PERFORM set_config('app.cancellation_in_progress', 'on', true);
  UPDATE public.bookings SET status = 'cancelled' WHERE id = p_booking_id;

  INSERT INTO public.booking_cancellations (
    booking_id, previous_status, cancelled_by_user_id, cancelled_by_role,
    reason_id, reason_code, reason_name_en, reason_name_ar, note, cancellation_fee
  ) VALUES (
    p_booking_id, v_booking.status, v_uid, v_role,
    v_reason.id, v_reason.code, v_reason.name_en, v_reason.name_ar, NULLIF(btrim(p_note), ''), v_fee
  ) RETURNING id INTO v_cancellation_id;

  IF v_role = 'provider' AND public.booking_money_held(p_booking_id) THEN
    PERFORM public.credit_customer_wallet_provider_cancelled(p_booking_id);
  ELSIF v_role = 'customer' AND COALESCE(v_booking.service_mode, 'in_person') = 'online' THEN
    PERFORM public.credit_customer_wallet_customer_cancelled(p_booking_id);
  END IF;

  RETURN v_cancellation_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
