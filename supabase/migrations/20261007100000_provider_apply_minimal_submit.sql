-- #136: minimal application submission; full approval and marketplace gates unchanged.
-- Source bodies: completion/save 20260928081021; submit/finalize 20260723050000;
-- prepare 20260723030000; provider guard 20261001150500.
-- No existing rows or approval functions are changed.

CREATE OR REPLACE FUNCTION public.provider_onboarding_submittable(p_provider_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider public.providers;
  v_profile public.profiles;
  v_details public.provider_onboarding_details;
  v_service_count int;
  v_zone_count int;
  v_errors jsonb := '{}'::jsonb;
  v_complete boolean := true;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = p_provider_id AND p.profile_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Access denied.' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE id = p_provider_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_provider.profile_id;
  SELECT * INTO v_details FROM public.provider_onboarding_details WHERE provider_id = p_provider_id;

  IF v_profile.full_name IS NULL OR btrim(v_profile.full_name) = '' THEN
    v_errors := v_errors || jsonb_build_object('personal', 'legal_name_required'); v_complete := false;
  END IF;
  IF v_profile.phone IS NULL OR btrim(v_profile.phone) = '' THEN
    v_errors := v_errors || jsonb_build_object('personal', 'phone_required'); v_complete := false;
  END IF;
  SELECT count(*) INTO v_service_count
  FROM public.provider_services ps
  JOIN public.services s ON s.id = ps.service_id
  JOIN public.categories c ON c.id = s.category_id
  WHERE ps.provider_id = p_provider_id AND s.is_active AND c.is_active AND public.is_phase1_category_slug(c.slug);
  IF v_service_count < 1 THEN v_errors := v_errors || jsonb_build_object('services', 'service_required'); v_complete := false; END IF;

  IF EXISTS (
    SELECT 1 FROM public.provider_services ps
    JOIN public.services s ON s.id = ps.service_id
    JOIN public.categories c ON c.id = s.category_id
    WHERE ps.provider_id = p_provider_id AND s.is_active AND c.is_active
      AND public.is_phase1_category_slug(c.slug)
      AND c.slug <> 'tutoring' AND s.provider_pricing_allowed
      AND (COALESCE(ps.price_override, v_provider.hourly_rate) IS NULL
        OR COALESCE(ps.price_override, v_provider.hourly_rate) <= 0
        OR (s.minimum_price IS NOT NULL AND COALESCE(ps.price_override, v_provider.hourly_rate) < s.minimum_price)
        OR (s.maximum_price IS NOT NULL AND COALESCE(ps.price_override, v_provider.hourly_rate) > s.maximum_price))
  ) THEN
    v_errors := v_errors || jsonb_build_object('services', 'provider_price_invalid'); v_complete := false;
  END IF;

  SELECT count(*) INTO v_zone_count FROM public.zone_providers zp JOIN public.zones z ON z.id = zp.zone_id
  WHERE zp.provider_id = p_provider_id AND z.is_active;
  IF v_zone_count < 1 THEN v_errors := v_errors || jsonb_build_object('coverage', 'zone_required'); v_complete := false; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.provider_documents d WHERE d.provider_id = p_provider_id AND d.type = 'id_card_front') THEN
    v_errors := v_errors || jsonb_build_object('documents', 'national_id_required'); v_complete := false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.provider_documents d WHERE d.provider_id = p_provider_id AND d.type = 'id_card_back') THEN
    v_errors := v_errors || jsonb_build_object('documents', 'national_id_required'); v_complete := false;
  END IF;

  IF v_details.accuracy_confirmed_at IS NULL THEN
    v_errors := v_errors || jsonb_build_object('review', 'accuracy_confirmation_required'); v_complete := false;
  END IF;

  RETURN jsonb_build_object('ok', true, 'complete', v_complete, 'errors', v_errors);
END;
$$;
REVOKE ALL ON FUNCTION public.provider_onboarding_submittable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_onboarding_submittable(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.provider_submit_onboarding()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_completion jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501'; END IF;

  IF v_provider.onboarding_status NOT IN ('DRAFT', 'NEEDS_CHANGES') THEN
    IF v_provider.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') THEN
      RETURN jsonb_build_object('ok', true, 'already_submitted', true, 'status', v_provider.onboarding_status);
    END IF;
    RAISE EXCEPTION 'Application cannot be submitted in the current status.' USING ERRCODE = '42501';
  END IF;

  v_completion := public.provider_onboarding_submittable(v_provider.id);
  IF NOT COALESCE((v_completion->>'complete')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_completion->'errors');
  END IF;

  PERFORM set_config('app.onboarding_internal_call', '1', true);
  PERFORM public.apply_provider_onboarding_status(
    v_provider.id, 'SUBMITTED', v_uid, 'provider', 'submitted', NULL, NULL, NULL, '{}'::jsonb
  );

  RETURN jsonb_build_object('ok', true, 'status', 'SUBMITTED');
END;
$$;

CREATE OR REPLACE FUNCTION public.provider_save_onboarding_section(
  p_section text,
  p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_service_id uuid;
  v_zone_id uuid;
  v_ref jsonb;
  v_i int := 0;
  v_norm_phones text[] := ARRAY[]::text[];
  v_norm_phone text;
  v_cap jsonb;
  v_code text;
  v_codes text[] := ARRAY[]::text[];
  v_years int;
  v_note text;
  v_max int;
  v_existing public.provider_age_group_capabilities;
  v_babysitting boolean;
  v_deferred boolean;
  v_previous_marker text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501'; END IF;
  v_deferred := v_provider.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW')
    AND p_section IN ('personal', 'experience', 'references');
  IF NOT public.provider_onboarding_editable(v_provider.onboarding_status) AND NOT v_deferred THEN
    RAISE EXCEPTION 'Application is not editable in the current status.' USING ERRCODE = '42501';
  END IF;

  v_previous_marker := current_setting('app.provider_deferred_save', true);
  IF v_deferred THEN PERFORM set_config('app.provider_deferred_save', '1', true); END IF;

  INSERT INTO public.provider_onboarding_details (provider_id) VALUES (v_provider.id)
  ON CONFLICT (provider_id) DO NOTHING;

  IF p_section = 'personal' THEN
    UPDATE public.profiles SET full_name = COALESCE(p_payload->>'legal_name', full_name)
    WHERE id = v_uid AND public.provider_onboarding_editable(v_provider.onboarding_status);
    UPDATE public.provider_onboarding_details SET
      date_of_birth = CASE WHEN p_payload ? 'date_of_birth' THEN (p_payload->>'date_of_birth')::date ELSE date_of_birth END,
      gender = CASE WHEN p_payload ? 'gender' THEN NULLIF(btrim(p_payload->>'gender'), '') ELSE gender END,
      governorate = CASE WHEN p_payload ? 'governorate' THEN NULLIF(btrim(p_payload->>'governorate'), '') ELSE governorate END,
      area = CASE WHEN p_payload ? 'area' THEN NULLIF(btrim(p_payload->>'area'), '') ELSE area END,
      full_address = CASE WHEN p_payload ? 'full_address' THEN NULLIF(btrim(p_payload->>'full_address'), '') ELSE full_address END,
      updated_at = now()
    WHERE provider_id = v_provider.id;
    UPDATE public.providers SET city = COALESCE(NULLIF(btrim(p_payload->>'area'), ''), city) WHERE id = v_provider.id;
  ELSIF p_section = 'experience' THEN
    UPDATE public.providers SET
      years_experience = COALESCE((p_payload->>'years_experience')::int, years_experience),
      bio_en = COALESCE(p_payload->>'bio_en', bio_en),
      bio_ar = COALESCE(p_payload->>'bio_ar', bio_ar),
      languages = COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'languages')), languages)
    WHERE id = v_provider.id;
    UPDATE public.provider_onboarding_details SET
      previous_work = NULLIF(btrim(p_payload->>'previous_work'), ''),
      newborn_experience = COALESCE((p_payload->>'newborn_experience')::boolean, newborn_experience),
      first_aid_training = COALESCE((p_payload->>'first_aid_training')::boolean, first_aid_training),
      updated_at = now()
    WHERE provider_id = v_provider.id;

    SELECT EXISTS (
      SELECT 1 FROM public.provider_services ps
      JOIN public.services s ON s.id = ps.service_id
      JOIN public.categories c ON c.id = s.category_id
      WHERE ps.provider_id = v_provider.id AND c.slug = 'babysitting'
    ) INTO v_babysitting;

    IF p_payload ? 'max_children_per_booking' THEN
      IF p_payload->'max_children_per_booking' IS NULL
         OR jsonb_typeof(p_payload->'max_children_per_booking') = 'null'
         OR NULLIF(btrim(p_payload->>'max_children_per_booking'), '') IS NULL THEN
        v_max := NULL;
      ELSE
        BEGIN
          v_max := (p_payload->>'max_children_per_booking')::int;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'max_children_per_booking must be an integer between 1 and 20.' USING ERRCODE = '23514';
        END;
        IF v_max < 1 OR v_max > 20 THEN
          RAISE EXCEPTION 'max_children_per_booking must be an integer between 1 and 20.' USING ERRCODE = '23514';
        END IF;
      END IF;
      IF v_max IS NULL AND v_babysitting THEN
        RAISE EXCEPTION 'max_children_per_booking must be an integer between 1 and 20.' USING ERRCODE = '23514';
      END IF;
      PERFORM set_config('app.max_children_declaration', '1', true);
      UPDATE public.providers SET max_children_per_booking = v_max WHERE id = v_provider.id;
    END IF;

    IF p_payload ? 'age_group_capabilities' THEN
      IF jsonb_typeof(p_payload->'age_group_capabilities') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'age_group_capabilities must be an array.' USING ERRCODE = '23514';
      END IF;

      PERFORM pg_advisory_xact_lock(hashtext('age-cap:' || v_provider.id::text));
      PERFORM 1 FROM public.provider_age_group_capabilities
        WHERE provider_id = v_provider.id FOR UPDATE;

      FOR v_cap IN SELECT jsonb_array_elements(p_payload->'age_group_capabilities') LOOP
        IF jsonb_typeof(v_cap) IS DISTINCT FROM 'object' THEN
          RAISE EXCEPTION 'Each age group capability must be an object.' USING ERRCODE = '23514';
        END IF;
        v_code := NULLIF(btrim(v_cap->>'code'), '');
        IF v_code IS NULL THEN
          RAISE EXCEPTION 'Age group code is required.' USING ERRCODE = '23514';
        END IF;
        IF v_code = ANY (v_codes) THEN
          RAISE EXCEPTION 'Duplicate age group capability: %', v_code USING ERRCODE = '23514';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.child_age_groups g WHERE g.code = v_code AND g.is_active) THEN
          RAISE EXCEPTION 'Unknown or inactive age group: %', v_code USING ERRCODE = '23514';
        END IF;
        IF v_cap ? 'years_experience'
           AND v_cap->'years_experience' IS NOT NULL
           AND jsonb_typeof(v_cap->'years_experience') <> 'null'
           AND NULLIF(btrim(v_cap->>'years_experience'), '') IS NOT NULL THEN
          BEGIN
            v_years := (v_cap->>'years_experience')::int;
          EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'years_experience must be an integer between 0 and 60.' USING ERRCODE = '23514';
          END;
          IF v_years < 0 OR v_years > 60 THEN
            RAISE EXCEPTION 'years_experience must be an integer between 0 and 60.' USING ERRCODE = '23514';
          END IF;
        ELSE
          v_years := NULL;
        END IF;
        v_note := NULLIF(btrim(v_cap->>'note'), '');
        IF v_note IS NOT NULL AND length(v_note) > 300 THEN
          RAISE EXCEPTION 'Capability note must be 300 characters or fewer.' USING ERRCODE = '23514';
        END IF;
        v_codes := array_append(v_codes, v_code);

        SELECT * INTO v_existing
        FROM public.provider_age_group_capabilities
        WHERE provider_id = v_provider.id AND age_group_code = v_code;

        IF NOT FOUND THEN
          INSERT INTO public.provider_age_group_capabilities (
            provider_id, age_group_code, years_experience, note
          ) VALUES (v_provider.id, v_code, v_years, v_note);
        ELSIF v_existing.verified_at IS NOT NULL OR v_existing.verified_by IS NOT NULL THEN
          NULL;
        ELSE
          UPDATE public.provider_age_group_capabilities SET
            years_experience = v_years,
            note = v_note
          WHERE id = v_existing.id;
        END IF;
      END LOOP;

      DELETE FROM public.provider_age_group_capabilities
      WHERE provider_id = v_provider.id
        AND verified_at IS NULL
        AND verified_by IS NULL
        AND (cardinality(v_codes) = 0 OR age_group_code <> ALL (v_codes));

      UPDATE public.provider_onboarding_details SET
        child_age_groups = COALESCE((
          SELECT array_agg(c.age_group_code ORDER BY g.sort_order)
          FROM public.provider_age_group_capabilities c
          JOIN public.child_age_groups g ON g.code = c.age_group_code
          WHERE c.provider_id = v_provider.id
        ), ARRAY[]::text[]),
        updated_at = now()
      WHERE provider_id = v_provider.id;
    ELSIF p_payload ? 'child_age_groups' THEN
      UPDATE public.provider_onboarding_details SET
        child_age_groups = COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'child_age_groups')), child_age_groups),
        updated_at = now()
      WHERE provider_id = v_provider.id;
    END IF;
  ELSIF p_section = 'services' THEN
    FOR v_service_id IN SELECT (value)::uuid FROM jsonb_array_elements_text(COALESCE(p_payload->'service_ids', '[]'::jsonb)) LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.services s JOIN public.categories c ON c.id = s.category_id
        WHERE s.id = v_service_id AND s.is_active AND c.is_active AND public.is_phase1_category_slug(c.slug)
      ) THEN
        RAISE EXCEPTION 'Invalid or inactive service selection.' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.provider_services (provider_id, service_id, status)
      VALUES (v_provider.id, v_service_id, 'pending') ON CONFLICT (provider_id, service_id) DO NOTHING;
    END LOOP;
  ELSIF p_section = 'coverage' THEN
    DELETE FROM public.zone_providers WHERE provider_id = v_provider.id;
    FOR v_zone_id IN SELECT (value)::uuid FROM jsonb_array_elements_text(COALESCE(p_payload->'zone_ids', '[]'::jsonb)) LOOP
      IF NOT EXISTS (SELECT 1 FROM public.zones z WHERE z.id = v_zone_id AND z.is_active) THEN
        RAISE EXCEPTION 'Invalid or inactive zone.' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.zone_providers (provider_id, zone_id) VALUES (v_provider.id, v_zone_id);
    END LOOP;
  ELSIF p_section = 'references' THEN
    DELETE FROM public.provider_references WHERE provider_id = v_provider.id;
    FOR v_ref IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'references', '[]'::jsonb)) LOOP
      IF btrim(COALESCE(v_ref->>'full_name', '')) = ''
         AND btrim(COALESCE(v_ref->>'relationship', '')) = ''
         AND btrim(COALESCE(v_ref->>'phone', '')) = ''
         AND btrim(COALESCE(v_ref->>'notes', '')) = '' THEN
        CONTINUE;
      END IF;
      v_norm_phone := public.normalize_reference_phone(v_ref->>'phone');
      IF v_norm_phone IS NULL OR btrim(v_norm_phone) = '' THEN
        RAISE EXCEPTION 'Reference phone is required.' USING ERRCODE = '23514';
      END IF;
      IF v_norm_phone = ANY(v_norm_phones) THEN
        RAISE EXCEPTION 'Reference phone numbers must be distinct.' USING ERRCODE = '23514';
      END IF;
      v_norm_phones := array_append(v_norm_phones, v_norm_phone);
      v_i := v_i + 1;
      INSERT INTO public.provider_references (provider_id, full_name, relationship, phone, notes, sort_order)
      VALUES (
        v_provider.id, btrim(v_ref->>'full_name'), btrim(v_ref->>'relationship'),
        v_norm_phone, NULLIF(btrim(v_ref->>'notes'), ''), v_i
      );
    END LOOP;
    IF v_i < 1 THEN
      RAISE EXCEPTION 'At least one reference is required.' USING ERRCODE = '23514';
    END IF;
  ELSIF p_section = 'review' THEN
    UPDATE public.provider_onboarding_details SET
      accuracy_confirmed_at = CASE WHEN COALESCE((p_payload->>'confirmed')::boolean, false) THEN now() ELSE NULL END,
      updated_at = now()
    WHERE provider_id = v_provider.id;
  ELSE
    RAISE EXCEPTION 'Unknown onboarding section.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.provider_deferred_save', COALESCE(v_previous_marker, ''), true);
  PERFORM set_config('app.onboarding_internal_call', '1', true);
  PERFORM public.log_provider_onboarding_event(
    v_provider.id, v_uid, 'provider', 'section_updated', v_provider.onboarding_status, v_provider.onboarding_status,
    jsonb_build_object('section', p_section)
  );

  RETURN public.provider_onboarding_completion(v_provider.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_guard_provider_onboarding_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.onboarding_status_transition', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- JWT clients, including provider-admins, cannot write this column except
  -- through provider_save_onboarding_section (which sets the GUC). Seed and
  -- service_role paths have no uid and are not PostgREST clients.
  IF NEW.max_children_per_booking IS DISTINCT FROM OLD.max_children_per_booking
     AND current_setting('app.max_children_declaration', true) IS DISTINCT FROM '1'
     AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Maximum children per booking can only be changed through the onboarding save function.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.onboarding_status IS DISTINCT FROM OLD.onboarding_status THEN
    RAISE EXCEPTION 'Onboarding status changes must use authorized server functions.' USING ERRCODE = '42501';
  END IF;

  IF OLD.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND NOT public.has_role(auth.uid(), 'admin')
     AND (current_setting('app.provider_deferred_save', true) IS DISTINCT FROM '1'
       OR (to_jsonb(NEW) - ARRAY['city','years_experience','bio_en','bio_ar','languages','max_children_per_booking','updated_at'])
          IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['city','years_experience','bio_en','bio_ar','languages','max_children_per_booking','updated_at'])) THEN
    RAISE EXCEPTION 'Provider application is read-only while under review.' USING ERRCODE = '42501';
  END IF;

  IF OLD.onboarding_status = 'APPROVED' AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.city IS DISTINCT FROM OLD.city
       OR NEW.years_experience IS DISTINCT FROM OLD.years_experience THEN
      RAISE EXCEPTION 'Verified identity data cannot be changed without review.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF (NEW.is_verified IS DISTINCT FROM OLD.is_verified
      OR NEW.is_top_pro IS DISTINCT FROM OLD.is_top_pro
      OR NEW.is_active IS DISTINCT FROM OLD.is_active)
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Provider verification and activation can only be changed by an admin or authorized server function.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.provider_prepare_document_upload(
  p_type public.document_type,
  p_content_type text,
  p_size_bytes bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_ext text;
  v_path text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501'; END IF;
  IF NOT public.provider_onboarding_editable(v_provider.onboarding_status)
     AND NOT (v_provider.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND p_type = 'profile_photo') THEN
    RAISE EXCEPTION 'Application is not editable in the current status.' USING ERRCODE = '42501';
  END IF;
  IF p_size_bytes <= 0 OR p_size_bytes > 10485760 THEN
    RAISE EXCEPTION 'File size must be between 1 byte and 10 MB.' USING ERRCODE = '23514';
  END IF;
  IF p_content_type NOT IN ('image/jpeg','image/png','image/jpg','application/pdf') THEN
    RAISE EXCEPTION 'Unsupported file type.' USING ERRCODE = '23514';
  END IF;

  v_ext := CASE
    WHEN p_content_type = 'application/pdf' THEN 'pdf'
    WHEN p_content_type IN ('image/png') THEN 'png'
    ELSE 'jpg'
  END;
  v_path := v_provider.id::text || '/' || p_type::text || '-' || gen_random_uuid()::text || '.' || v_ext;

  RETURN jsonb_build_object('path', v_path, 'bucket', 'provider-documents');
END;
$$;

CREATE OR REPLACE FUNCTION public.provider_finalize_document_upload(
  p_path text,
  p_type public.document_type
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_doc_id uuid;
  v_old record;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501'; END IF;
  IF NOT public.provider_onboarding_editable(v_provider.onboarding_status)
     AND NOT (v_provider.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND p_type = 'profile_photo') THEN
    RAISE EXCEPTION 'Application is not editable in the current status.' USING ERRCODE = '42501';
  END IF;
  IF p_path IS NULL OR p_path ~ '\.\.' OR NOT p_path LIKE v_provider.id::text || '/%' THEN
    RAISE EXCEPTION 'Invalid document path.' USING ERRCODE = '23514';
  END IF;

  FOR v_old IN
    SELECT id, storage_path FROM public.provider_documents
    WHERE provider_id = v_provider.id AND type = p_type
  LOOP
    DELETE FROM public.provider_documents WHERE id = v_old.id;
  END LOOP;

  INSERT INTO public.provider_documents (provider_id, type, storage_path, status)
  VALUES (v_provider.id, p_type, p_path, 'pending')
  RETURNING id INTO v_doc_id;

  PERFORM set_config('app.onboarding_internal_call', '1', true);
  PERFORM public.log_provider_onboarding_event(
    v_provider.id, v_uid, 'provider', 'document_uploaded', v_provider.onboarding_status, v_provider.onboarding_status,
    jsonb_build_object('document_type', p_type::text, 'document_id', v_doc_id)
  );

  RETURN v_doc_id;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_submit_onboarding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_submit_onboarding() TO authenticated;
REVOKE ALL ON FUNCTION public.provider_save_onboarding_section(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_save_onboarding_section(text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.tg_guard_provider_onboarding_fields() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.provider_prepare_document_upload(public.document_type, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_prepare_document_upload(public.document_type, text, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.provider_finalize_document_upload(text, public.document_type) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_finalize_document_upload(text, public.document_type) TO authenticated;

-- Age-group guard from 20260912090000: only the authorized deferred-save path
-- gains editability; ownership and all verification protections remain intact.
CREATE OR REPLACE FUNCTION public.tg_guard_age_group_verification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := v_uid IS NOT NULL AND public.has_role(v_uid, 'admin');
  v_owns boolean := false;
  v_editable boolean := false;
  v_provider_id uuid;
  v_verification_changed boolean := false;
  v_claim_content_changed boolean := false;
BEGIN
  -- Client path is authenticated with a JWT. Migration/service_role have no uid
  -- and must still be able to backfill unverified claims.
  IF v_uid IS NULL THEN
    IF current_user = 'authenticated' THEN
      RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_provider_id := OLD.provider_id;
  ELSE
    v_provider_id := NEW.provider_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.providers p
    WHERE p.id = v_provider_id AND p.profile_id = v_uid
  ) INTO v_owns;

  SELECT (public.provider_onboarding_editable(p.onboarding_status)
    OR (p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW')
      AND current_setting('app.provider_deferred_save', true) = '1'))
    INTO v_editable
  FROM public.providers p
  WHERE p.id = v_provider_id;

  IF TG_OP = 'DELETE' THEN
    IF OLD.verified_at IS NOT NULL OR OLD.verified_by IS NOT NULL THEN
      RAISE EXCEPTION 'Verified capability claims cannot be deleted.' USING ERRCODE = '42501';
    END IF;
    IF NOT v_owns OR NOT COALESCE(v_editable, false) THEN
      RAISE EXCEPTION 'Only the owning provider may delete unverified claims while the application is editable.' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  v_verification_changed :=
    (TG_OP = 'INSERT' AND (NEW.verified_at IS NOT NULL OR NEW.verified_by IS NOT NULL))
    OR (TG_OP = 'UPDATE' AND (
      NEW.verified_at IS DISTINCT FROM OLD.verified_at
      OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
    ));

  v_claim_content_changed :=
    TG_OP = 'INSERT'
    OR (TG_OP = 'UPDATE' AND (
      NEW.id IS DISTINCT FROM OLD.id
      OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
      OR NEW.age_group_code IS DISTINCT FROM OLD.age_group_code
      OR NEW.years_experience IS DISTINCT FROM OLD.years_experience
      OR NEW.note IS DISTINCT FROM OLD.note
    ));

  IF v_verification_changed THEN
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Verification fields are admin-only.' USING ERRCODE = '42501';
    END IF;
    IF v_owns THEN
      RAISE EXCEPTION 'A provider cannot verify their own capabilities.' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Admins cannot insert capability claims.' USING ERRCODE = '42501';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
       OR NEW.age_group_code IS DISTINCT FROM OLD.age_group_code
       OR NEW.years_experience IS DISTINCT FROM OLD.years_experience
       OR NEW.note IS DISTINCT FROM OLD.note THEN
      RAISE EXCEPTION 'Admin verification cannot change claim content or identity.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT v_owns THEN
    RAISE EXCEPTION 'Only the owning provider may change capability claims.' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(v_editable, false) THEN
    RAISE EXCEPTION 'Application is not editable in the current status.' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' AND (NEW.verified_at IS NOT NULL OR NEW.verified_by IS NOT NULL) THEN
    RAISE EXCEPTION 'Verification fields are admin-only.' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN
      RAISE EXCEPTION 'Capability claim identity cannot be reassigned.' USING ERRCODE = '42501';
    END IF;
    IF (OLD.verified_at IS NOT NULL OR OLD.verified_by IS NOT NULL) AND v_claim_content_changed THEN
      RAISE EXCEPTION 'Verified capability claims cannot be edited. Ask an admin to clear verification first.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_guard_age_group_verification() FROM PUBLIC, anon, authenticated;
