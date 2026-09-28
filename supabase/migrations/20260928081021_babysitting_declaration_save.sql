-- Phase B: provider declaration save/hydration + reschedule recheck.
-- Copies the latest function bodies from this branch:
--   provider_onboarding_completion / provider_save_onboarding_section
--     (20260910120000_provider_optional_second_reference.sql)
--   provider_onboarding_snapshot / admin_provider_onboarding_review
--     / tg_guard_provider_onboarding_fields
--     (20260723030000_provider_onboarding_verification.sql)
-- Additive only. Does not rewrite 20260912090000.

-- ---------------------------------------------------------------------------
-- max_children_per_booking is RPC-only. No authenticated/anon/admin table write.
-- ---------------------------------------------------------------------------
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

  IF OLD.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Provider application is read-only while under review.' USING ERRCODE = '42501';
  END IF;

  IF OLD.onboarding_status = 'APPROVED' AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.bio_en IS DISTINCT FROM OLD.bio_en
       OR NEW.bio_ar IS DISTINCT FROM OLD.bio_ar
       OR NEW.city IS DISTINCT FROM OLD.city
       OR NEW.years_experience IS DISTINCT FROM OLD.years_experience THEN
      RAISE EXCEPTION 'Verified identity data cannot be changed without review.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_provider_onboarding_fields ON public.providers;
CREATE TRIGGER trg_guard_provider_onboarding_fields
  BEFORE UPDATE ON public.providers
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_provider_onboarding_fields();

REVOKE UPDATE (max_children_per_booking) ON public.providers FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Completion: preserve Issue 69 reference/services/coverage/document rules;
-- restore babysitting_details_required from capability rows + declared max.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provider_onboarding_completion(p_provider_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider public.providers;
  v_profile public.profiles;
  v_details public.provider_onboarding_details;
  v_service_count int;
  v_zone_count int;
  v_ref_count int;
  v_babysitting boolean;
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

  SELECT EXISTS (
    SELECT 1 FROM public.provider_services ps
    JOIN public.services s ON s.id = ps.service_id
    JOIN public.categories c ON c.id = s.category_id
    WHERE ps.provider_id = p_provider_id AND c.slug = 'babysitting'
  ) INTO v_babysitting;

  IF v_babysitting AND (
    v_provider.max_children_per_booking IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.provider_age_group_capabilities c
      WHERE c.provider_id = p_provider_id
    )
  ) THEN
    v_errors := v_errors || jsonb_build_object('experience', 'babysitting_details_required');
    v_complete := false;
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

-- ---------------------------------------------------------------------------
-- Save: auth.uid() + own provider + editable. No admin declaration bypass.
-- Capability sync serializes against verification and keeps verified rows.
-- Legacy child_age_groups is rebuilt from the effective persisted set.
-- ---------------------------------------------------------------------------
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
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid FOR UPDATE;
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

  PERFORM set_config('app.onboarding_internal_call', '1', true);
  PERFORM public.log_provider_onboarding_event(
    v_provider.id, v_uid, 'provider', 'section_updated', v_provider.onboarding_status, v_provider.onboarding_status,
    jsonb_build_object('section', p_section)
  );

  RETURN public.provider_onboarding_completion(v_provider.id);
END;
$$;

REVOKE ALL ON FUNCTION public.provider_save_onboarding_section(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_save_onboarding_section(text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.provider_onboarding_completion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_onboarding_completion(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Snapshot: additive capability fields. Does not carry services/zones/references
-- (Issue 69 still hydrates those from their own queries).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provider_onboarding_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_details public.provider_onboarding_details;
  v_profile public.profiles;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid;
  IF NOT FOUND THEN RETURN jsonb_build_object('exists', false); END IF;
  SELECT * INTO v_details FROM public.provider_onboarding_details WHERE provider_id = v_provider.id;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid;

  RETURN jsonb_build_object(
    'exists', true,
    'provider', jsonb_build_object(
      'id', v_provider.id,
      'onboarding_status', v_provider.onboarding_status,
      'submitted_at', v_provider.submitted_at,
      'review_reason_public', v_provider.review_reason_public,
      'review_reason_code', v_provider.review_reason_code,
      'bio_en', v_provider.bio_en,
      'bio_ar', v_provider.bio_ar,
      'years_experience', v_provider.years_experience,
      'languages', v_provider.languages,
      'city', v_provider.city,
      'max_children_per_booking', v_provider.max_children_per_booking
    ),
    'profile', jsonb_build_object(
      'full_name', v_profile.full_name,
      'phone', v_profile.phone,
      'avatar_url', v_profile.avatar_url
    ),
    'details', CASE WHEN v_details.provider_id IS NULL THEN NULL ELSE to_jsonb(v_details) END,
    'age_group_capabilities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', c.age_group_code,
        'years_experience', c.years_experience,
        'note', c.note,
        'verified_at', c.verified_at
      ) ORDER BY g.sort_order)
      FROM public.provider_age_group_capabilities c
      JOIN public.child_age_groups g ON g.code = c.age_group_code
      WHERE c.provider_id = v_provider.id
    ), '[]'::jsonb),
    'completion', public.provider_onboarding_completion(v_provider.id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.provider_onboarding_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_onboarding_snapshot() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_provider_onboarding_review(p_provider_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider public.providers;
  v_profile public.profiles;
  v_details public.provider_onboarding_details;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_provider FROM public.providers WHERE id = p_provider_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider not found.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_provider.profile_id;
  SELECT * INTO v_details FROM public.provider_onboarding_details WHERE provider_id = p_provider_id;

  RETURN jsonb_build_object(
    'provider', to_jsonb(v_provider),
    'profile', to_jsonb(v_profile),
    'details', CASE WHEN v_details.provider_id IS NULL THEN NULL ELSE to_jsonb(v_details) END,
    'age_group_capabilities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', c.age_group_code,
        'years_experience', c.years_experience,
        'note', c.note,
        'verified_at', c.verified_at
      ) ORDER BY g.sort_order)
      FROM public.provider_age_group_capabilities c
      JOIN public.child_age_groups g ON g.code = c.age_group_code
      WHERE c.provider_id = p_provider_id
    ), '[]'::jsonb),
    'references', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.sort_order)
      FROM public.provider_references r WHERE r.provider_id = p_provider_id
    ), '[]'::jsonb),
    'documents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'type', d.type, 'status', d.status, 'created_at', d.created_at, 'reviewed_at', d.reviewed_at
      ) ORDER BY d.created_at DESC)
      FROM public.provider_documents d WHERE d.provider_id = p_provider_id
    ), '[]'::jsonb),
    'services', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ps.id, 'status', ps.status, 'service_id', s.id, 'name_en', s.name_en, 'name_ar', s.name_ar, 'category_slug', c.slug
      ))
      FROM public.provider_services ps
      JOIN public.services s ON s.id = ps.service_id
      JOIN public.categories c ON c.id = s.category_id
      WHERE ps.provider_id = p_provider_id
    ), '[]'::jsonb),
    'zones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', z.id, 'name_en', z.name_en, 'name_ar', z.name_ar))
      FROM public.zone_providers zp
      JOIN public.zones z ON z.id = zp.zone_id
      WHERE zp.provider_id = p_provider_id
    ), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'action', e.action, 'previous_status', e.previous_status, 'new_status', e.new_status,
        'actor_role', e.actor_role, 'created_at', e.created_at, 'metadata', e.metadata
      ) ORDER BY e.created_at DESC)
      FROM public.provider_onboarding_events e
      WHERE e.provider_id = p_provider_id
    ), '[]'::jsonb),
    'completion', public.provider_onboarding_completion(p_provider_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_provider_onboarding_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_provider_onboarding_review(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Reschedule: re-assert babysitting eligibility only when start_at changes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_assert_babysitting_booking_start_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.start_at IS NOT DISTINCT FROM OLD.start_at THEN
    RETURN NEW;
  END IF;
  PERFORM public.assert_babysitting_booking_eligible(
    NEW.provider_id,
    NEW.service_id,
    NEW.customer_id,
    NEW.family_member_id,
    NEW.start_at
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_assert_babysitting_booking_start_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_assert_babysitting_booking_start_change ON public.bookings;
CREATE TRIGGER trg_assert_babysitting_booking_start_change
  BEFORE UPDATE OF start_at ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_assert_babysitting_booking_start_change();
