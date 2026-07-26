-- PATCH 5 security remediation: remove legacy bypasses, lock internal functions, tighten RLS.

-- ---------------------------------------------------------------------------
-- Backfill decision (item 12):
-- The original PATCH 5 backfill only touched rows still at default DRAFT.
-- Legacy verified providers mapped to APPROVED; suspended to SUSPENDED; others DRAFT.
-- No pre-PATCH-5 SUBMITTED/UNDER_REVIEW semantics existed in production schema.
-- ---------------------------------------------------------------------------

-- Internal execution marker used by trusted SECURITY DEFINER wrappers only.
CREATE OR REPLACE FUNCTION public.assert_onboarding_internal_call()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.onboarding_internal_call', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Direct onboarding internal call is not permitted.' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_onboarding_internal_call() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_provider_onboarding_event(
  p_provider_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_action text,
  p_previous_status public.provider_onboarding_status,
  p_new_status public.provider_onboarding_status,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
BEGIN
  PERFORM public.assert_onboarding_internal_call();

  IF v_actor_id IS NULL THEN
    v_actor_id := p_actor_id;
    v_actor_role := COALESCE(NULLIF(btrim(p_actor_role), ''), 'system');
  ELSIF public.has_role(v_actor_id, 'admin') THEN
    v_actor_role := 'admin';
  ELSIF EXISTS (SELECT 1 FROM public.providers p WHERE p.id = p_provider_id AND p.profile_id = v_actor_id) THEN
    v_actor_role := 'provider';
  ELSE
    v_actor_role := 'system';
  END IF;

  INSERT INTO public.provider_onboarding_events (
    provider_id, actor_id, actor_role, action, previous_status, new_status, metadata
  ) VALUES (
    p_provider_id, COALESCE(v_actor_id, p_actor_id), v_actor_role, p_action,
    p_previous_status, p_new_status, COALESCE(p_metadata, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_provider_onboarding_event(uuid, uuid, text, text, public.provider_onboarding_status, public.provider_onboarding_status, jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_provider_onboarding_status(
  p_provider_id uuid,
  p_new_status public.provider_onboarding_status,
  p_actor_id uuid,
  p_actor_role text,
  p_action text,
  p_reason_code text DEFAULT NULL,
  p_reason_public text DEFAULT NULL,
  p_notes_internal text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old public.provider_onboarding_status;
  v_actor_id uuid := auth.uid();
  v_actor_role text;
BEGIN
  PERFORM public.assert_onboarding_internal_call();

  IF v_actor_id IS NULL THEN
    v_actor_id := p_actor_id;
    v_actor_role := COALESCE(NULLIF(btrim(p_actor_role), ''), 'system');
  ELSIF public.has_role(v_actor_id, 'admin') THEN
    v_actor_role := 'admin';
  ELSIF EXISTS (SELECT 1 FROM public.providers p WHERE p.id = p_provider_id AND p.profile_id = v_actor_id) THEN
    v_actor_role := 'provider';
  ELSE
    RAISE EXCEPTION 'Unauthorized onboarding status transition.' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.onboarding_status_transition', '1', true);

  SELECT onboarding_status INTO v_old FROM public.providers WHERE id = p_provider_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider not found.' USING ERRCODE = '42501'; END IF;

  UPDATE public.providers
  SET onboarding_status = p_new_status,
      is_verified = (p_new_status = 'APPROVED'),
      is_active = CASE
        WHEN p_new_status = 'APPROVED' THEN true
        WHEN p_new_status = 'SUSPENDED' THEN false
        WHEN p_new_status = 'REJECTED' THEN false
        ELSE is_active
      END,
      last_review_at = CASE WHEN p_new_status IN ('UNDER_REVIEW','NEEDS_CHANGES','APPROVED','REJECTED','SUSPENDED') THEN now() ELSE last_review_at END,
      review_reason_code = CASE WHEN p_new_status IN ('NEEDS_CHANGES','REJECTED','SUSPENDED') THEN p_reason_code ELSE NULL END,
      review_reason_public = CASE WHEN p_new_status IN ('NEEDS_CHANGES','REJECTED','SUSPENDED') THEN p_reason_public ELSE NULL END,
      review_notes_internal = CASE WHEN p_new_status IN ('NEEDS_CHANGES','REJECTED','SUSPENDED') THEN p_notes_internal ELSE review_notes_internal END,
      submitted_at = CASE WHEN p_new_status = 'SUBMITTED' AND submitted_at IS NULL THEN now() ELSE submitted_at END,
      resubmitted_at = CASE WHEN p_new_status = 'SUBMITTED' AND v_old IN ('NEEDS_CHANGES','REJECTED') THEN now() ELSE resubmitted_at END
  WHERE id = p_provider_id;

  PERFORM set_config('app.onboarding_internal_call', '1', true);
  PERFORM public.log_provider_onboarding_event(
    p_provider_id, v_actor_id, v_actor_role, p_action, v_old, p_new_status, p_metadata
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_provider_onboarding_status(uuid, public.provider_onboarding_status, uuid, text, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;

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
  IF v_ref_count < 2 THEN v_errors := v_errors || jsonb_build_object('references', 'two_references_required'); v_complete := false; END IF;
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
    IF v_i < 2 THEN
      RAISE EXCEPTION 'Two distinct references are required.' USING ERRCODE = '23514';
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

CREATE OR REPLACE FUNCTION public.provider_start_onboarding()
RETURNS public.providers LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.providers;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') OR public.has_role(v_uid, 'customer') THEN
    RAISE EXCEPTION 'Provider identity required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.providers WHERE profile_id = v_uid;
  IF FOUND THEN RETURN v_row; END IF;

  PERFORM set_config('app.onboarding_status_transition', '1', true);
  INSERT INTO public.providers (
    profile_id, bio_en, bio_ar, years_experience, hourly_rate, city,
    country, languages, is_active, is_verified, onboarding_status
  ) VALUES (
    v_uid, '', '', 0, 1, 'Cairo', 'EG', ARRAY[]::text[], true, false, 'DRAFT'
  ) RETURNING * INTO v_row;

  INSERT INTO public.provider_onboarding_details (provider_id) VALUES (v_row.id)
  ON CONFLICT (provider_id) DO NOTHING;

  PERFORM set_config('app.onboarding_internal_call', '1', true);
  PERFORM public.log_provider_onboarding_event(
    v_row.id, v_uid, 'provider', 'onboarding_started', NULL, 'DRAFT', '{}'::jsonb
  );
  RETURN v_row;
END;
$$;

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

  v_completion := public.provider_onboarding_completion(v_provider.id);
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

CREATE OR REPLACE FUNCTION public.admin_provider_onboarding_action(
  p_provider_id uuid,
  p_action text,
  p_reason_code text DEFAULT NULL,
  p_reason_public text DEFAULT NULL,
  p_notes_internal text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_new_status public.provider_onboarding_status;
  v_completion jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE id = p_provider_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider not found.' USING ERRCODE = '42501'; END IF;

  IF p_action = 'start_review' THEN
    IF v_provider.onboarding_status <> 'SUBMITTED' THEN
      RAISE EXCEPTION 'Only submitted applications can enter review.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'UNDER_REVIEW';
  ELSIF p_action = 'approve' THEN
    IF v_provider.onboarding_status NOT IN ('SUBMITTED', 'UNDER_REVIEW') THEN
      RAISE EXCEPTION 'Only submitted or in-review applications can be approved.' USING ERRCODE = '23514';
    END IF;
    v_completion := public.provider_onboarding_completion(p_provider_id);
    IF NOT COALESCE((v_completion->>'complete')::boolean, false) THEN
      RAISE EXCEPTION 'Application is incomplete and cannot be approved.' USING ERRCODE = '23514';
    END IF;
    IF NOT public.provider_required_documents_approved(p_provider_id) THEN
      RAISE EXCEPTION 'Required identity documents must be approved before provider approval.' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.provider_documents d
      WHERE d.provider_id = p_provider_id AND d.type IN ('id_card_front', 'id_card_back') AND d.status = 'rejected'
    ) THEN
      RAISE EXCEPTION 'Rejected required documents must be replaced and approved.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'APPROVED';
  ELSIF p_action = 'request_changes' THEN
    IF v_provider.onboarding_status NOT IN ('SUBMITTED', 'UNDER_REVIEW') THEN
      RAISE EXCEPTION 'Invalid status for requesting changes.' USING ERRCODE = '23514';
    END IF;
    IF p_reason_code IS NULL OR btrim(p_reason_code) = '' OR p_reason_public IS NULL OR btrim(p_reason_public) = '' THEN
      RAISE EXCEPTION 'A reason is required to request changes.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'NEEDS_CHANGES';
  ELSIF p_action = 'reject' THEN
    IF v_provider.onboarding_status NOT IN ('SUBMITTED', 'UNDER_REVIEW', 'NEEDS_CHANGES') THEN
      RAISE EXCEPTION 'Invalid status for rejection.' USING ERRCODE = '23514';
    END IF;
    IF p_reason_code IS NULL OR btrim(p_reason_code) = '' OR p_reason_public IS NULL OR btrim(p_reason_public) = '' THEN
      RAISE EXCEPTION 'A reason is required to reject an application.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'REJECTED';
  ELSIF p_action = 'suspend' THEN
    IF v_provider.onboarding_status <> 'APPROVED' THEN
      RAISE EXCEPTION 'Only approved providers can be suspended.' USING ERRCODE = '23514';
    END IF;
    IF p_reason_code IS NULL OR btrim(p_reason_code) = '' OR p_reason_public IS NULL OR btrim(p_reason_public) = '' THEN
      RAISE EXCEPTION 'A reason is required to suspend a provider.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'SUSPENDED';
  ELSIF p_action = 'unsuspend' THEN
    IF v_provider.onboarding_status <> 'SUSPENDED' THEN
      RAISE EXCEPTION 'Only suspended providers can be unsuspended.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'APPROVED';
  ELSE
    RAISE EXCEPTION 'Unknown onboarding action.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.audit_reason', COALESCE(btrim(p_reason_public), ''), true);
  PERFORM set_config('app.onboarding_internal_call', '1', true);
  PERFORM public.apply_provider_onboarding_status(
    p_provider_id, v_new_status, v_uid, 'admin', p_action,
    p_reason_code, p_reason_public, p_notes_internal, '{}'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_provider_verification(
  p_provider_id uuid, p_verified boolean, p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider public.providers;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF NOT p_verified AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'A reason is required to reject a provider application.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE id = p_provider_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider not found.' USING ERRCODE = '42501'; END IF;

  IF p_verified THEN
    IF v_provider.onboarding_status NOT IN ('SUBMITTED', 'UNDER_REVIEW') THEN
      RAISE EXCEPTION 'Only submitted or in-review applications can be approved.' USING ERRCODE = '23514';
    END IF;
    PERFORM public.admin_provider_onboarding_action(p_provider_id, 'approve', NULL, NULL, NULL);
  ELSE
    IF v_provider.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW', 'NEEDS_CHANGES') THEN
      PERFORM public.admin_provider_onboarding_action(
        p_provider_id, 'reject', 'legacy_reject', btrim(p_reason), NULL
      );
    ELSIF v_provider.onboarding_status = 'APPROVED' THEN
      PERFORM public.admin_provider_onboarding_action(
        p_provider_id, 'suspend', 'legacy_suspend', btrim(p_reason), NULL
      );
    ELSE
      RAISE EXCEPTION 'Provider cannot be rejected or suspended in the current status.' USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_guard_provider_document_review_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
       OR NEW.rejected_reason IS DISTINCT FROM OLD.rejected_reason THEN
      RAISE EXCEPTION 'Document review fields cannot be modified directly.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_provider_document_review_fields ON public.provider_documents;
CREATE TRIGGER trg_guard_provider_document_review_fields
  BEFORE UPDATE ON public.provider_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_provider_document_review_fields();

DROP POLICY IF EXISTS "docs_self" ON public.provider_documents;
CREATE POLICY "docs_self_select" ON public.provider_documents
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()));
CREATE POLICY "docs_self_insert" ON public.provider_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.profile_id = auth.uid()
        AND public.provider_onboarding_editable(p.onboarding_status)
    )
  );
CREATE POLICY "docs_self_delete" ON public.provider_documents
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.profile_id = auth.uid()
        AND public.provider_onboarding_editable(p.onboarding_status)
    )
  );

DROP POLICY IF EXISTS "provider_onboarding_details_own" ON public.provider_onboarding_details;
CREATE POLICY "provider_onboarding_details_own" ON public.provider_onboarding_details
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.profile_id = auth.uid()
        AND public.provider_onboarding_editable(p.onboarding_status)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.profile_id = auth.uid()
        AND public.provider_onboarding_editable(p.onboarding_status)
    )
  );

DROP POLICY IF EXISTS "provider_references_own" ON public.provider_references;
CREATE POLICY "provider_references_own" ON public.provider_references
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.profile_id = auth.uid()
        AND public.provider_onboarding_editable(p.onboarding_status)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.profile_id = auth.uid()
        AND public.provider_onboarding_editable(p.onboarding_status)
    )
  );

DROP POLICY IF EXISTS "provider_onboarding_events_admin_insert" ON public.provider_onboarding_events;
REVOKE INSERT ON public.provider_onboarding_events FROM authenticated;

REVOKE SELECT (review_notes_internal) ON public.providers FROM authenticated;
GRANT SELECT (review_notes_internal) ON public.providers TO service_role;

CREATE OR REPLACE FUNCTION public.admin_review_provider_document(
  p_document_id uuid,
  p_status public.verification_status,
  p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_doc public.provider_documents;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid document review status.' USING ERRCODE = '23514';
  END IF;
  IF p_status = 'rejected' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'A reason is required to reject a document.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_doc FROM public.provider_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found.' USING ERRCODE = '42501'; END IF;

  UPDATE public.provider_documents
  SET status = p_status,
      rejected_reason = CASE WHEN p_status = 'rejected' THEN btrim(p_reason) ELSE NULL END,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = p_document_id;

  PERFORM set_config('app.onboarding_internal_call', '1', true);
  PERFORM public.log_provider_onboarding_event(
    v_doc.provider_id, auth.uid(), 'admin',
    CASE WHEN p_status = 'approved' THEN 'document_approved' ELSE 'document_rejected' END,
    NULL, NULL,
    jsonb_build_object('document_id', p_document_id, 'document_type', v_doc.type::text)
  );
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
  IF NOT public.provider_onboarding_editable(v_provider.onboarding_status) THEN
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
