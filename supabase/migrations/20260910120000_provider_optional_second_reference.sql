-- Allow a single reference during provider onboarding. Reference 2 stays optional.
-- Empty reference objects in the save payload are skipped so the UI can omit ref 2.

CREATE OR REPLACE FUNCTION public.provider_onboarding_completion(p_provider_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider public.providers;
  v_profile public.profiles;
  v_details public.provider_onboarding_details;
  v_service_count int;
  v_zone_count int;
  v_ref_count int;
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
  IF v_details.provider_id IS NULL OR v_details.date_of_birth IS NULL OR v_details.governorate IS NULL OR btrim(v_details.governorate) = ''
     OR v_details.area IS NULL OR btrim(v_details.area) = '' OR v_details.full_address IS NULL OR btrim(v_details.full_address) = '' THEN
    v_errors := v_errors || jsonb_build_object('personal', 'personal_details_incomplete'); v_complete := false;
  END IF;
  IF v_profile.avatar_url IS NULL OR btrim(v_profile.avatar_url) = '' THEN
    v_errors := v_errors || jsonb_build_object('personal', 'profile_photo_required'); v_complete := false;
  END IF;

  SELECT count(*) INTO v_service_count
  FROM public.provider_services ps
  JOIN public.services s ON s.id = ps.service_id
  JOIN public.categories c ON c.id = s.category_id
  WHERE ps.provider_id = p_provider_id AND s.is_active AND c.is_active AND public.is_phase1_category_slug(c.slug);
  IF v_service_count < 1 THEN v_errors := v_errors || jsonb_build_object('services', 'service_required'); v_complete := false; END IF;

  IF COALESCE(v_provider.years_experience, 0) < 0 OR (COALESCE(v_provider.bio_en, '') = '' AND COALESCE(v_provider.bio_ar, '') = '') THEN
    v_errors := v_errors || jsonb_build_object('experience', 'experience_incomplete'); v_complete := false;
  END IF;

  SELECT count(*) INTO v_zone_count FROM public.zone_providers zp JOIN public.zones z ON z.id = zp.zone_id
  WHERE zp.provider_id = p_provider_id AND z.is_active;
  IF v_zone_count < 1 THEN v_errors := v_errors || jsonb_build_object('coverage', 'zone_required'); v_complete := false; END IF;

  SELECT count(*) INTO v_ref_count FROM public.provider_references WHERE provider_id = p_provider_id;
  IF v_ref_count < 1 THEN v_errors := v_errors || jsonb_build_object('references', 'reference_required'); v_complete := false; END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT public.normalize_reference_phone(phone) AS norm_phone, count(*) AS c
      FROM public.provider_references
      WHERE provider_id = p_provider_id
      GROUP BY 1
      HAVING count(*) > 1
    ) dup
  ) THEN
    v_errors := v_errors || jsonb_build_object('references', 'duplicate_reference_phones'); v_complete := false;
  END IF;

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
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501'; END IF;
  IF NOT public.provider_onboarding_editable(v_provider.onboarding_status) THEN
    RAISE EXCEPTION 'Application is not editable in the current status.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.provider_onboarding_details (provider_id) VALUES (v_provider.id)
  ON CONFLICT (provider_id) DO NOTHING;

  IF p_section = 'personal' THEN
    UPDATE public.profiles SET full_name = COALESCE(p_payload->>'legal_name', full_name)
    WHERE id = v_uid AND (full_name IS NULL OR btrim(full_name) = '' OR v_provider.onboarding_status = 'NEEDS_CHANGES');
    UPDATE public.provider_onboarding_details SET
      date_of_birth = (p_payload->>'date_of_birth')::date,
      gender = NULLIF(btrim(p_payload->>'gender'), ''),
      governorate = NULLIF(btrim(p_payload->>'governorate'), ''),
      area = NULLIF(btrim(p_payload->>'area'), ''),
      full_address = NULLIF(btrim(p_payload->>'full_address'), ''),
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
      child_age_groups = COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'child_age_groups')), child_age_groups),
      newborn_experience = COALESCE((p_payload->>'newborn_experience')::boolean, newborn_experience),
      first_aid_training = COALESCE((p_payload->>'first_aid_training')::boolean, first_aid_training),
      updated_at = now()
    WHERE provider_id = v_provider.id;
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

  PERFORM set_config('app.onboarding_internal_call', '1', true);
  PERFORM public.log_provider_onboarding_event(
    v_provider.id, v_uid, 'provider', 'section_updated', v_provider.onboarding_status, v_provider.onboarding_status,
    jsonb_build_object('section', p_section)
  );

  RETURN public.provider_onboarding_completion(v_provider.id);
END;
$$;
