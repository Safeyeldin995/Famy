-- Child safety: babysitting and tutoring bookings require supervision_mode.
-- Review-only until applied to Production.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS supervision_mode text NULL
  CONSTRAINT bookings_supervision_mode_check
  CHECK (supervision_mode IS NULL OR supervision_mode IN ('cameras', 'adult_present'));

DROP FUNCTION IF EXISTS public.booking_request_fingerprint(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, text, uuid, jsonb, uuid, text, text, text
);

CREATE OR REPLACE FUNCTION public.booking_request_fingerprint(
  p_provider_id uuid,
  p_service_id uuid,
  p_address_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_family_member_id uuid,
  p_notes text,
  p_promo_code_id uuid,
  p_requirement_selections jsonb,
  p_teaching_capability_id uuid DEFAULT NULL,
  p_teaching_subject_code text DEFAULT NULL,
  p_teaching_curriculum_code text DEFAULT NULL,
  p_teaching_level_code text DEFAULT NULL,
  p_supervision_mode text DEFAULT NULL
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT concat_ws('|', p_provider_id::text, p_service_id::text, p_address_id::text,
    p_start_at::text, p_end_at::text, coalesce(p_family_member_id::text, ''),
    coalesce(p_notes, ''), coalesce(p_promo_code_id::text, ''),
    coalesce(p_requirement_selections::text, '[]'),
    coalesce(p_teaching_capability_id::text, ''),
    coalesce(p_teaching_subject_code, ''),
    coalesce(p_teaching_curriculum_code, ''),
    coalesce(p_teaching_level_code, ''),
    coalesce(p_supervision_mode, ''));
$$;
REVOKE ALL ON FUNCTION public.booking_request_fingerprint(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, text, uuid, jsonb, uuid, text, text, text, text
) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb, uuid, text, text, text
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
  p_supervision_mode text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
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
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF public.is_not_suspended(v_uid) IS NOT TRUE THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Account is suspended.' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Idempotency key is required.' USING ERRCODE = '23514';
  END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Invalid booking time range.' USING ERRCODE = '23514';
  END IF;

  SELECT cat.slug INTO v_category_slug
  FROM public.services s
  JOIN public.categories cat ON cat.id = s.category_id
  WHERE s.id = p_service_id;

  IF v_category_slug IN ('babysitting', 'tutoring') THEN
    IF p_supervision_mode IS NULL OR p_supervision_mode NOT IN ('cameras', 'adult_present') THEN
      RAISE EXCEPTION 'BOOKING_SUPERVISION_REQUIRED: Choose how your child will be supervised during this service.' USING ERRCODE = '23514';
    END IF;
  END IF;

  v_fingerprint := public.booking_request_fingerprint(
    p_provider_id, p_service_id, p_address_id, p_start_at, p_end_at,
    p_family_member_id, p_notes, p_promo_code_id, coalesce(p_requirement_selections, '[]'::jsonb),
    p_teaching_capability_id, p_teaching_subject_code, p_teaching_curriculum_code, p_teaching_level_code,
    p_supervision_mode
  );

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_idempotency_key::text, 0));

  SELECT id, request_fingerprint INTO v_existing
  FROM public.bookings
  WHERE customer_id = v_uid AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'BOOKING_DUPLICATE_REQUEST_CONFLICT: Idempotency key reused with different booking details.' USING ERRCODE = '23514';
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
  v_required_hours := GREATEST(COALESCE(v_min_hours_before_start, 2), COALESCE(v_provider_min_notice, 0)::numeric);
  IF p_start_at < now() + (v_required_hours * interval '1 hour') THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: This start time is too soon for the provider to respond in time.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.marketplace_eligibility_internal(p_provider_id, p_service_id, p_address_id) e
    WHERE e.is_eligible
  ) THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Provider is not eligible for this service and address.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.create_booking_in_progress', 'on', true);

  BEGIN
    INSERT INTO public.bookings (
      customer_id, provider_id, service_id, address_id,
      start_at, end_at, status, notes, family_member_id,
      requirement_selections, promo_code_id,
      price_subtotal, price_discount, price_total,
      price_platform_fee, price_vat, price_extras_total, price_travel_fee,
      idempotency_key, request_fingerprint, currency,
      teaching_capability_id, teaching_subject_code, teaching_curriculum_code, teaching_level_code,
      supervision_mode
    ) VALUES (
      v_uid, p_provider_id, p_service_id, p_address_id,
      p_start_at, p_end_at, 'pending', NULLIF(btrim(p_notes), ''), p_family_member_id,
      coalesce(p_requirement_selections, '[]'::jsonb), p_promo_code_id,
      0, 0, 0, 0, 0, 0, 0,
      p_idempotency_key, v_fingerprint, 'EGP',
      p_teaching_capability_id, NULLIF(btrim(p_teaching_subject_code), ''),
      NULLIF(btrim(p_teaching_curriculum_code), ''), NULLIF(btrim(p_teaching_level_code), ''),
      p_supervision_mode
    ) RETURNING id INTO v_booking_id;
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
      RAISE EXCEPTION 'BOOKING_DUPLICATE_REQUEST_CONFLICT: Concurrent duplicate booking request.' USING ERRCODE = '23514';
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'BOOKING_SLOT_UNAVAILABLE: That time slot is no longer available.' USING ERRCODE = '23514';
    WHEN SQLSTATE '23514' THEN
      RAISE;
    WHEN SQLSTATE '42501' THEN
      RAISE;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'BOOKING_%' THEN
        RAISE;
      END IF;
      RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Unable to create booking.' USING ERRCODE = '23514';
  END;

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'created', v_created,
    'idempotent_replay', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb, uuid, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb, uuid, text, text, text, text
) TO authenticated;
