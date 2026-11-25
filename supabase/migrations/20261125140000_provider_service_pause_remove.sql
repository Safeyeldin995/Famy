-- Provider pause / remove approved services (PO #provider-services-status).

ALTER TABLE public.provider_services
  DROP CONSTRAINT IF EXISTS provider_services_status_check;

ALTER TABLE public.provider_services
  ADD CONSTRAINT provider_services_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'paused', 'removed'));

CREATE OR REPLACE FUNCTION public.tg_guard_provider_services()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin');
  v_becoming_approved boolean;
  v_category_slug text;
  v_lifecycle_allowed boolean :=
    COALESCE(current_setting('app.provider_service_lifecycle', true), '') = '1';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending' AND NOT v_is_admin THEN
      RAISE EXCEPTION 'New service requests must start pending.' USING ERRCODE = '42501';
    END IF;
    v_becoming_approved := (NEW.status = 'approved');
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT v_is_admin
       AND NOT v_lifecycle_allowed THEN
      RAISE EXCEPTION 'Only admin can change service approval status.' USING ERRCODE = '42501';
    END IF;
    v_becoming_approved := (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved');
  END IF;

  IF v_becoming_approved AND EXISTS (
    SELECT 1 FROM public.service_requirements sr
    WHERE sr.service_id = NEW.service_id AND sr.is_active AND sr.required_for_provider_approval
      AND NOT EXISTS (
        SELECT 1 FROM public.provider_requirement_fulfillments prf
        WHERE prf.provider_id = NEW.provider_id AND prf.requirement_id = sr.id AND prf.status IN ('passed','waived')
      )
  ) THEN
    RAISE EXCEPTION 'This provider has not completed all mandatory requirements for this service.' USING ERRCODE = '23514';
  END IF;

  IF v_becoming_approved THEN
    SELECT c.slug INTO v_category_slug
    FROM public.services s
    JOIN public.categories c ON c.id = s.category_id
    WHERE s.id = NEW.service_id;
    IF v_category_slug = 'tutoring'
       AND EXISTS (
         SELECT 1 FROM public.providers p
         WHERE p.id = NEW.provider_id AND p.onboarding_status = 'APPROVED'
       )
       AND NOT EXISTS (
      SELECT 1 FROM public.provider_teaching_capabilities tc
      WHERE tc.provider_id = NEW.provider_id
        AND tc.service_id = NEW.service_id
        AND tc.status IN ('pending', 'approved')
    ) THEN
      RAISE EXCEPTION 'Tutoring service requests require at least one subject and grade before approval.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.provider_set_service_active(
  p_service_id uuid,
  p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_ps public.provider_services;
  v_new_status text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501';
  END IF;
  IF v_provider.onboarding_status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Only approved providers can pause or resume services.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ps
  FROM public.provider_services
  WHERE provider_id = v_provider.id AND service_id = p_service_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider service not found.' USING ERRCODE = '42501';
  END IF;

  IF p_active THEN
    IF v_ps.status <> 'paused' THEN
      RAISE EXCEPTION 'Only paused services can be resumed.' USING ERRCODE = '23514';
    END IF;
    IF v_ps.flagged_for_review THEN
      v_new_status := 'pending';
    ELSE
      v_new_status := 'approved';
    END IF;
  ELSE
    IF v_ps.status <> 'approved' THEN
      RAISE EXCEPTION 'Only active approved services can be paused.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'paused';
  END IF;

  PERFORM set_config('app.provider_service_lifecycle', '1', true);
  PERFORM set_config('app.audit_reason', CASE WHEN p_active THEN 'provider_resume_service' ELSE 'provider_pause_service' END, true);

  UPDATE public.provider_services
  SET status = v_new_status
  WHERE id = v_ps.id;

  RETURN jsonb_build_object(
    'ok', true,
    'provider_service_id', v_ps.id,
    'status', v_new_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.provider_set_service_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_set_service_active(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.provider_remove_service(p_service_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_ps public.provider_services;
  v_upcoming integer;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501';
  END IF;
  IF v_provider.onboarding_status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Only approved providers can remove services.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ps
  FROM public.provider_services
  WHERE provider_id = v_provider.id AND service_id = p_service_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider service not found.' USING ERRCODE = '42501';
  END IF;

  IF v_ps.status NOT IN ('approved', 'paused', 'rejected') THEN
    RAISE EXCEPTION 'This service cannot be removed in its current status.' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer INTO v_upcoming
  FROM public.bookings b
  WHERE b.provider_id = v_provider.id
    AND b.service_id = p_service_id
    AND b.status IN (
      'pending',
      'confirmed',
      'on_the_way',
      'arrived',
      'arrival_confirmed',
      'in_progress',
      'completion_requested'
    );

  PERFORM set_config('app.provider_service_lifecycle', '1', true);
  PERFORM set_config('app.audit_reason', 'provider_remove_service', true);

  UPDATE public.provider_services
  SET status = 'removed'
  WHERE id = v_ps.id;

  RETURN jsonb_build_object(
    'ok', true,
    'provider_service_id', v_ps.id,
    'upcoming_bookings', v_upcoming
  );
END;
$$;

REVOKE ALL ON FUNCTION public.provider_remove_service(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_remove_service(uuid) TO authenticated;

-- Allow lifecycle RPCs and resubmit to change status without admin role.
CREATE OR REPLACE FUNCTION public.provider_resubmit_rejected_service(p_service_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_ps public.provider_services;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ps
  FROM public.provider_services
  WHERE provider_id = v_provider.id AND service_id = p_service_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider service not found.' USING ERRCODE = '42501';
  END IF;

  IF v_ps.status <> 'rejected' THEN
    RAISE EXCEPTION 'Only rejected services can be resubmitted.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.provider_service_lifecycle', '1', true);

  UPDATE public.provider_services
  SET status = 'pending', rejection_reason = NULL
  WHERE id = v_ps.id;

  UPDATE public.provider_teaching_capabilities
  SET status = 'pending', review_note = NULL, reviewed_at = NULL, reviewed_by = NULL
  WHERE provider_id = v_provider.id
    AND service_id = p_service_id
    AND status = 'rejected';
END;
$$;

-- P2: re-request after removed (and lifecycle on status transition in RPC).
CREATE OR REPLACE FUNCTION public.provider_request_service(
  p_service_id uuid,
  p_payload jsonb,
  p_idempotency_key uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_service RECORD;
  v_ps public.provider_services;
  v_group jsonb;
  v_level_id uuid;
  v_level_ids uuid[];
  v_req jsonb;
  v_cap_count int := 0;
  v_price int;
  v_max int;
  v_cap jsonb;
  v_existing public.provider_age_group_capabilities;
  v_code text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Request payload must be a JSON object.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501';
  END IF;
  IF v_provider.onboarding_status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Only approved providers can request new services this way.' USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_provider.id::text || ':' || p_idempotency_key::text, 0));
    SELECT * INTO v_ps FROM public.provider_services
    WHERE provider_id = v_provider.id AND request_idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'provider_service_id', v_ps.id, 'idempotent_replay', true);
    END IF;
  END IF;

  SELECT s.*, c.slug AS category_slug
  INTO v_service
  FROM public.services s
  JOIN public.categories c ON c.id = s.category_id
  WHERE s.id = p_service_id AND s.is_active AND c.is_active;
  IF NOT FOUND OR NOT public.is_phase1_category_slug(v_service.category_slug) THEN
    RAISE EXCEPTION 'Service is not available.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_ps
  FROM public.provider_services
  WHERE provider_id = v_provider.id AND service_id = p_service_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_ps.status = 'approved' THEN
      RAISE EXCEPTION 'Service is already active on your profile.' USING ERRCODE = '23514';
    ELSIF v_ps.status = 'pending' THEN
      RAISE EXCEPTION 'You already have a pending request for this service.' USING ERRCODE = '23514';
    ELSIF v_ps.status IN ('rejected', 'removed') THEN
      DELETE FROM public.provider_teaching_capabilities
      WHERE provider_id = v_provider.id AND service_id = p_service_id AND status IN ('pending', 'rejected');
      PERFORM set_config('app.provider_service_lifecycle', '1', true);
      UPDATE public.provider_services
      SET status = 'pending', rejection_reason = NULL, request_idempotency_key = p_idempotency_key
      WHERE id = v_ps.id;
    ELSIF v_ps.status = 'paused' THEN
      RAISE EXCEPTION 'Resume a paused service before submitting a new request.' USING ERRCODE = '23514';
    END IF;
  ELSE
    PERFORM set_config('app.provider_service_request', '1', true);
    INSERT INTO public.provider_services (provider_id, service_id, status, request_idempotency_key)
    VALUES (v_provider.id, p_service_id, 'pending', p_idempotency_key)
    RETURNING * INTO v_ps;
  END IF;

  IF v_service.category_slug = 'tutoring' THEN
    IF NOT (p_payload ? 'teaching_groups') OR jsonb_typeof(p_payload->'teaching_groups') <> 'array'
       OR jsonb_array_length(p_payload->'teaching_groups') < 1 THEN
      RAISE EXCEPTION 'At least one subject, grade, and session price is required for tutoring services.'
        USING ERRCODE = '23514';
    END IF;
    FOR v_group IN SELECT jsonb_array_elements(p_payload->'teaching_groups') LOOP
      v_level_ids := ARRAY(
        SELECT jsonb_array_elements_text(v_group->'level_ids')::uuid
      );
      PERFORM public.provider_save_teaching_group(
        p_service_id,
        (v_group->>'subject_id')::uuid,
        (v_group->>'curriculum_id')::uuid,
        v_level_ids,
        (v_group->>'session_duration_min')::int,
        (v_group->>'session_price')::int
      );
      v_cap_count := v_cap_count + cardinality(v_level_ids);
    END LOOP;
    IF v_cap_count < 1 THEN
      RAISE EXCEPTION 'At least one subject, grade, and session price is required for tutoring services.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF v_service.provider_pricing_allowed THEN
    IF NOT (p_payload ? 'price_override') OR p_payload->'price_override' IS NULL THEN
      RAISE EXCEPTION 'Session price is required for this service.' USING ERRCODE = '23514';
    END IF;
    v_price := (p_payload->>'price_override')::int;
    IF v_service.minimum_price IS NOT NULL AND v_price < v_service.minimum_price THEN
      RAISE EXCEPTION 'Price is below the allowed minimum.' USING ERRCODE = '23514';
    END IF;
    IF v_service.maximum_price IS NOT NULL AND v_price > v_service.maximum_price THEN
      RAISE EXCEPTION 'Price is above the allowed maximum.' USING ERRCODE = '23514';
    END IF;
    UPDATE public.provider_services SET price_override = v_price WHERE id = v_ps.id;
  END IF;

  IF v_service.category_slug = 'babysitting' THEN
    IF p_payload ? 'max_children_per_booking' THEN
      v_max := (p_payload->>'max_children_per_booking')::int;
      IF v_max IS NULL OR v_max < 1 OR v_max > 6 THEN
        RAISE EXCEPTION 'max_children_per_booking must be between 1 and 6.' USING ERRCODE = '23514';
      END IF;
      PERFORM set_config('app.max_children_declaration', '1', true);
      UPDATE public.providers SET max_children_per_booking = v_max WHERE id = v_provider.id;
    ELSIF v_provider.max_children_per_booking IS NULL THEN
      RAISE EXCEPTION 'Maximum children per booking is required for babysitting.' USING ERRCODE = '23514';
    END IF;

    IF p_payload ? 'age_group_capabilities' THEN
      IF jsonb_typeof(p_payload->'age_group_capabilities') <> 'array' THEN
        RAISE EXCEPTION 'age_group_capabilities must be an array.' USING ERRCODE = '23514';
      END IF;
      PERFORM 1 FROM public.provider_age_group_capabilities
      WHERE provider_id = v_provider.id FOR UPDATE;
      FOR v_cap IN SELECT jsonb_array_elements(p_payload->'age_group_capabilities') LOOP
        v_code := btrim(v_cap->>'age_group_code');
        IF v_code IS NULL OR v_code = '' THEN
          RAISE EXCEPTION 'age_group_code is required.' USING ERRCODE = '23514';
        END IF;
        SELECT * INTO v_existing FROM public.provider_age_group_capabilities
        WHERE provider_id = v_provider.id AND age_group_code = v_code;
        IF NOT FOUND THEN
          INSERT INTO public.provider_age_group_capabilities (
            provider_id, age_group_code, years_experience, note
          ) VALUES (
            v_provider.id, v_code,
            NULLIF(v_cap->>'years_experience', '')::int,
            NULLIF(btrim(v_cap->>'note'), '')
          );
        END IF;
      END LOOP;
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.provider_age_group_capabilities WHERE provider_id = v_provider.id
    ) THEN
      RAISE EXCEPTION 'At least one age group is required for babysitting.' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF p_payload ? 'requirement_fulfillments' AND jsonb_typeof(p_payload->'requirement_fulfillments') = 'array' THEN
    FOR v_req IN SELECT jsonb_array_elements(p_payload->'requirement_fulfillments') LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.service_requirements sr
        WHERE sr.id = (v_req->>'requirement_id')::uuid
          AND sr.service_id = p_service_id
          AND sr.is_active
          AND sr.required_for_provider_approval
      ) THEN
        CONTINUE;
      END IF;
      INSERT INTO public.provider_requirement_fulfillments (
        provider_id, requirement_id, notes, evidence_storage_path
      ) VALUES (
        v_provider.id,
        (v_req->>'requirement_id')::uuid,
        NULLIF(btrim(v_req->>'notes'), ''),
        NULLIF(btrim(v_req->>'evidence_storage_path'), '')
      )
      ON CONFLICT (provider_id, requirement_id) DO UPDATE SET
        notes = COALESCE(EXCLUDED.notes, provider_requirement_fulfillments.notes),
        evidence_storage_path = COALESCE(
          EXCLUDED.evidence_storage_path,
          provider_requirement_fulfillments.evidence_storage_path
        );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'provider_service_id', v_ps.id, 'idempotent_replay', false);
END;
$$;


