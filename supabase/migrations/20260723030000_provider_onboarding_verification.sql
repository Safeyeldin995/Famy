-- PATCH 5: Provider onboarding state machine, references, audit events, secure documents.

CREATE TYPE public.provider_onboarding_status AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_CHANGES',
  'APPROVED',
  'REJECTED',
  'SUSPENDED'
);

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS onboarding_status public.provider_onboarding_status NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_review_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_reason_code text,
  ADD COLUMN IF NOT EXISTS review_reason_public text,
  ADD COLUMN IF NOT EXISTS review_notes_internal text,
  ADD COLUMN IF NOT EXISTS resubmitted_at timestamptz;

UPDATE public.providers
SET onboarding_status = CASE
  WHEN is_verified AND NOT is_active THEN 'SUSPENDED'::public.provider_onboarding_status
  WHEN is_verified THEN 'APPROVED'::public.provider_onboarding_status
  ELSE 'DRAFT'::public.provider_onboarding_status
END
WHERE onboarding_status = 'DRAFT';

ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'id_card_front';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'id_card_back';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'profile_photo';

CREATE TABLE IF NOT EXISTS public.provider_onboarding_details (
  provider_id uuid PRIMARY KEY REFERENCES public.providers(id) ON DELETE CASCADE,
  date_of_birth date,
  gender text,
  governorate text,
  area text,
  full_address text,
  previous_work text,
  child_age_groups text[] NOT NULL DEFAULT '{}',
  newborn_experience boolean NOT NULL DEFAULT false,
  first_aid_training boolean NOT NULL DEFAULT false,
  accuracy_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.provider_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  relationship text NOT NULL,
  phone text NOT NULL,
  notes text,
  sort_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_references_phone_not_blank CHECK (length(trim(phone)) > 0),
  CONSTRAINT provider_references_name_not_blank CHECK (length(trim(full_name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_provider_references_provider ON public.provider_references(provider_id);

CREATE TABLE IF NOT EXISTS public.provider_onboarding_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  actor_id uuid,
  actor_role text NOT NULL,
  action text NOT NULL,
  previous_status public.provider_onboarding_status,
  new_status public.provider_onboarding_status,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_onboarding_events_provider ON public.provider_onboarding_events(provider_id, created_at DESC);

ALTER TABLE public.provider_onboarding_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_onboarding_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.provider_onboarding_details TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_references TO authenticated;
GRANT SELECT ON public.provider_onboarding_events TO authenticated;
GRANT ALL ON public.provider_onboarding_details TO service_role;
GRANT ALL ON public.provider_references TO service_role;
GRANT ALL ON public.provider_onboarding_events TO service_role;

CREATE POLICY "provider_onboarding_details_own" ON public.provider_onboarding_details
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()));

CREATE POLICY "provider_onboarding_details_admin" ON public.provider_onboarding_details
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "provider_references_own" ON public.provider_references
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()));

CREATE POLICY "provider_references_admin" ON public.provider_references
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "provider_onboarding_events_provider_read" ON public.provider_onboarding_events
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid())
  );

CREATE POLICY "provider_onboarding_events_admin_insert" ON public.provider_onboarding_events
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR actor_id = auth.uid());

-- Phase 1 category slugs
CREATE OR REPLACE FUNCTION public.is_phase1_category_slug(p_slug text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_slug IN ('home-cleaning', 'babysitting');
$$;

CREATE OR REPLACE FUNCTION public.normalize_reference_phone(p_phone text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_digits text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
BEGIN
  IF v_digits = '' THEN RETURN NULL; END IF;
  IF v_digits ~ '^20' THEN RETURN '+' || v_digits; END IF;
  IF v_digits ~ '^0' THEN RETURN '+20' || substring(v_digits from 2); END IF;
  RETURN '+20' || v_digits;
END;
$$;

CREATE OR REPLACE FUNCTION public.provider_onboarding_editable(p_status public.provider_onboarding_status)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_status IN ('DRAFT', 'NEEDS_CHANGES');
$$;

CREATE OR REPLACE FUNCTION public.log_provider_onboarding_event(
  p_provider_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_action text,
  p_previous_status public.provider_onboarding_status,
  p_new_status public.provider_onboarding_status,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.provider_onboarding_events (
    provider_id, actor_id, actor_role, action, previous_status, new_status, metadata
  ) VALUES (
    p_provider_id, p_actor_id, p_actor_role, p_action, p_previous_status, p_new_status, COALESCE(p_metadata, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.provider_onboarding_completion(p_provider_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider public.providers;
  v_profile public.profiles;
  v_details public.provider_onboarding_details;
  v_service_count int;
  v_zone_count int;
  v_ref_count int;
  v_has_id_front boolean;
  v_has_id_back boolean;
  v_has_profile_photo boolean;
  v_babysitting boolean;
  v_errors jsonb := '{}'::jsonb;
  v_complete boolean := true;
BEGIN
  SELECT * INTO v_provider FROM public.providers WHERE id = p_provider_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_provider.profile_id;
  SELECT * INTO v_details FROM public.provider_onboarding_details WHERE provider_id = p_provider_id;

  IF v_profile.full_name IS NULL OR btrim(v_profile.full_name) = '' THEN
    v_errors := v_errors || jsonb_build_object('personal', 'legal_name_required');
    v_complete := false;
  END IF;
  IF v_profile.phone IS NULL OR btrim(v_profile.phone) = '' THEN
    v_errors := v_errors || jsonb_build_object('personal', 'phone_required');
    v_complete := false;
  END IF;
  IF v_details.provider_id IS NULL OR v_details.date_of_birth IS NULL OR v_details.governorate IS NULL OR btrim(v_details.governorate) = ''
     OR v_details.area IS NULL OR btrim(v_details.area) = '' OR v_details.full_address IS NULL OR btrim(v_details.full_address) = '' THEN
    v_errors := v_errors || jsonb_build_object('personal', 'personal_details_incomplete');
    v_complete := false;
  END IF;
  IF v_profile.avatar_url IS NULL OR btrim(v_profile.avatar_url) = '' THEN
    v_errors := v_errors || jsonb_build_object('personal', 'profile_photo_required');
    v_complete := false;
  END IF;

  SELECT count(*) INTO v_service_count
  FROM public.provider_services ps
  JOIN public.services s ON s.id = ps.service_id
  JOIN public.categories c ON c.id = s.category_id
  WHERE ps.provider_id = p_provider_id AND s.is_active AND c.is_active
    AND public.is_phase1_category_slug(c.slug);

  IF v_service_count < 1 THEN
    v_errors := v_errors || jsonb_build_object('services', 'service_required');
    v_complete := false;
  END IF;

  IF COALESCE(v_provider.years_experience, 0) < 0
     OR (COALESCE(v_provider.bio_en, '') = '' AND COALESCE(v_provider.bio_ar, '') = '') THEN
    v_errors := v_errors || jsonb_build_object('experience', 'experience_incomplete');
    v_complete := false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.provider_services ps
    JOIN public.services s ON s.id = ps.service_id
    JOIN public.categories c ON c.id = s.category_id
    WHERE ps.provider_id = p_provider_id AND c.slug = 'babysitting'
  ) INTO v_babysitting;

  IF v_babysitting AND (
    v_details.provider_id IS NULL
    OR COALESCE(array_length(v_details.child_age_groups, 1), 0) = 0
  ) THEN
    v_errors := v_errors || jsonb_build_object('experience', 'babysitting_details_required');
    v_complete := false;
  END IF;

  SELECT count(*) INTO v_zone_count
  FROM public.zone_providers zp
  JOIN public.zones z ON z.id = zp.zone_id
  WHERE zp.provider_id = p_provider_id AND z.is_active;

  IF v_zone_count < 1 THEN
    v_errors := v_errors || jsonb_build_object('coverage', 'zone_required');
    v_complete := false;
  END IF;

  SELECT count(*) INTO v_ref_count FROM public.provider_references WHERE provider_id = p_provider_id;
  IF v_ref_count < 2 THEN
    v_errors := v_errors || jsonb_build_object('references', 'two_references_required');
    v_complete := false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.provider_documents d
    WHERE d.provider_id = p_provider_id AND d.type = 'id_card_front'
  ) INTO v_has_id_front;
  SELECT EXISTS (
    SELECT 1 FROM public.provider_documents d
    WHERE d.provider_id = p_provider_id AND d.type = 'id_card_back'
  ) INTO v_has_id_back;
  SELECT EXISTS (
    SELECT 1 FROM public.provider_documents d
    WHERE d.provider_id = p_provider_id AND d.type IN ('profile_photo', 'id_card')
      OR (v_profile.avatar_url IS NOT NULL AND btrim(v_profile.avatar_url) <> '')
  ) INTO v_has_profile_photo;

  IF NOT v_has_id_front OR NOT v_has_id_back THEN
    v_errors := v_errors || jsonb_build_object('documents', 'national_id_required');
    v_complete := false;
  END IF;
  IF NOT v_has_profile_photo THEN
    v_errors := v_errors || jsonb_build_object('documents', 'profile_photo_required');
    v_complete := false;
  END IF;

  IF v_details.accuracy_confirmed_at IS NULL THEN
    v_errors := v_errors || jsonb_build_object('review', 'accuracy_confirmation_required');
    v_complete := false;
  END IF;

  RETURN jsonb_build_object('ok', true, 'complete', v_complete, 'errors', v_errors);
END;
$$;

REVOKE ALL ON FUNCTION public.provider_onboarding_completion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_onboarding_completion(uuid) TO authenticated;

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
BEGIN
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

  PERFORM public.log_provider_onboarding_event(
    p_provider_id, p_actor_id, p_actor_role, p_action, v_old, p_new_status, p_metadata
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_guard_provider_onboarding_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.onboarding_status_transition', true) = '1' THEN
    RETURN NEW;
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

CREATE OR REPLACE FUNCTION public.provider_start_onboarding()
RETURNS public.providers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  PERFORM public.log_provider_onboarding_event(
    v_row.id, v_uid, 'provider', 'onboarding_started', NULL, 'DRAFT', '{}'::jsonb
  );
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.provider_start_onboarding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_start_onboarding() TO authenticated;

CREATE OR REPLACE FUNCTION public.create_provider_profile(
  p_bio_en text,
  p_bio_ar text,
  p_years_experience integer,
  p_hourly_rate numeric,
  p_city text,
  p_languages text[]
)
RETURNS public.providers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.providers;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') OR public.has_role(v_uid, 'customer') THEN
    RAISE EXCEPTION 'Provider identity required' USING ERRCODE = '42501';
  END IF;
  IF p_years_experience < 0 OR p_hourly_rate <= 0 OR NULLIF(btrim(p_city), '') IS NULL THEN
    RAISE EXCEPTION 'Valid provider experience, price, and city are required' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.onboarding_status_transition', '1', true);

  INSERT INTO public.providers (
    profile_id, bio_en, bio_ar, years_experience, hourly_rate, city,
    country, languages, is_active, is_verified, onboarding_status
  ) VALUES (
    v_uid, COALESCE(p_bio_en, ''), COALESCE(p_bio_ar, ''), p_years_experience,
    p_hourly_rate, btrim(p_city), 'EG', COALESCE(p_languages, ARRAY[]::text[]), true, false, 'DRAFT'
  ) RETURNING * INTO v_row;

  INSERT INTO public.provider_onboarding_details (provider_id) VALUES (v_row.id)
  ON CONFLICT (provider_id) DO NOTHING;

  PERFORM public.log_provider_onboarding_event(
    v_row.id, v_uid, 'provider', 'onboarding_started', NULL, 'DRAFT', '{}'::jsonb
  );

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.provider_save_onboarding_section(
  p_section text,
  p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_details public.provider_onboarding_details;
  v_service_id uuid;
  v_zone_id uuid;
  v_ref jsonb;
  v_i int := 0;
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
    UPDATE public.profiles SET
      full_name = COALESCE(p_payload->>'legal_name', full_name)
    WHERE id = v_uid AND (full_name IS NULL OR btrim(full_name) = '' OR v_provider.onboarding_status = 'NEEDS_CHANGES');

    UPDATE public.provider_onboarding_details SET
      date_of_birth = (p_payload->>'date_of_birth')::date,
      gender = NULLIF(btrim(p_payload->>'gender'), ''),
      governorate = NULLIF(btrim(p_payload->>'governorate'), ''),
      area = NULLIF(btrim(p_payload->>'area'), ''),
      full_address = NULLIF(btrim(p_payload->>'full_address'), ''),
      updated_at = now()
    WHERE provider_id = v_provider.id;

    UPDATE public.providers SET
      city = COALESCE(NULLIF(btrim(p_payload->>'area'), ''), city)
    WHERE id = v_provider.id;
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
    FOR v_service_id IN
      SELECT (value)::uuid FROM jsonb_array_elements_text(COALESCE(p_payload->'service_ids', '[]'::jsonb))
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.services s
        JOIN public.categories c ON c.id = s.category_id
        WHERE s.id = v_service_id AND s.is_active AND c.is_active AND public.is_phase1_category_slug(c.slug)
      ) THEN
        RAISE EXCEPTION 'Invalid or inactive service selection.' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.provider_services (provider_id, service_id, status)
      VALUES (v_provider.id, v_service_id, 'pending')
      ON CONFLICT (provider_id, service_id) DO NOTHING;
    END LOOP;
  ELSIF p_section = 'coverage' THEN
    DELETE FROM public.zone_providers WHERE provider_id = v_provider.id;
    FOR v_zone_id IN
      SELECT (value)::uuid FROM jsonb_array_elements_text(COALESCE(p_payload->'zone_ids', '[]'::jsonb))
    LOOP
      IF NOT EXISTS (SELECT 1 FROM public.zones z WHERE z.id = v_zone_id AND z.is_active) THEN
        RAISE EXCEPTION 'Invalid or inactive zone.' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.zone_providers (provider_id, zone_id) VALUES (v_provider.id, v_zone_id);
    END LOOP;
  ELSIF p_section = 'references' THEN
    DELETE FROM public.provider_references WHERE provider_id = v_provider.id;
    FOR v_ref IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'references', '[]'::jsonb))
    LOOP
      v_i := v_i + 1;
      INSERT INTO public.provider_references (provider_id, full_name, relationship, phone, notes, sort_order)
      VALUES (
        v_provider.id,
        btrim(v_ref->>'full_name'),
        btrim(v_ref->>'relationship'),
        public.normalize_reference_phone(v_ref->>'phone'),
        NULLIF(btrim(v_ref->>'notes'), ''),
        v_i
      );
    END LOOP;
  ELSIF p_section = 'review' THEN
    UPDATE public.provider_onboarding_details SET
      accuracy_confirmed_at = CASE WHEN COALESCE((p_payload->>'confirmed')::boolean, false) THEN now() ELSE NULL END,
      updated_at = now()
    WHERE provider_id = v_provider.id;
  ELSE
    RAISE EXCEPTION 'Unknown onboarding section.' USING ERRCODE = '23514';
  END IF;

  PERFORM public.log_provider_onboarding_event(
    v_provider.id, v_uid, 'provider', 'section_updated', v_provider.onboarding_status, v_provider.onboarding_status,
    jsonb_build_object('section', p_section)
  );

  RETURN public.provider_onboarding_completion(v_provider.id);
END;
$$;
REVOKE ALL ON FUNCTION public.provider_save_onboarding_section(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_save_onboarding_section(text, jsonb) TO authenticated;

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
  IF NOT public.provider_onboarding_editable(v_provider.onboarding_status) THEN
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
REVOKE ALL ON FUNCTION public.provider_prepare_document_upload(public.document_type, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_prepare_document_upload(public.document_type, text, bigint) TO authenticated;

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

  PERFORM public.log_provider_onboarding_event(
    v_provider.id, v_uid, 'provider', 'document_uploaded', v_provider.onboarding_status, v_provider.onboarding_status,
    jsonb_build_object('document_type', p_type::text, 'document_id', v_doc_id)
  );

  RETURN v_doc_id;
END;
$$;
REVOKE ALL ON FUNCTION public.provider_finalize_document_upload(text, public.document_type) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_finalize_document_upload(text, public.document_type) TO authenticated;

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

  PERFORM public.apply_provider_onboarding_status(
    v_provider.id, 'SUBMITTED', v_uid, 'provider', 'submitted', NULL, NULL, NULL, '{}'::jsonb
  );

  RETURN jsonb_build_object('ok', true, 'status', 'SUBMITTED');
END;
$$;
REVOKE ALL ON FUNCTION public.provider_submit_onboarding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_submit_onboarding() TO authenticated;

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
      RAISE EXCEPTION 'Provider is not suspended.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'APPROVED';
  ELSE
    RAISE EXCEPTION 'Unknown admin action.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.audit_reason', COALESCE(btrim(p_reason_public), ''), true);
  PERFORM public.apply_provider_onboarding_status(
    p_provider_id, v_new_status, v_uid, 'admin', p_action,
    p_reason_code, p_reason_public, p_notes_internal, '{}'::jsonb
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_provider_onboarding_action(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_provider_onboarding_action(uuid, text, text, text, text) TO authenticated;

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
    IF v_provider.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') THEN
      PERFORM public.admin_provider_onboarding_action(p_provider_id, 'approve', NULL, NULL, NULL);
    ELSE
      PERFORM set_config('app.onboarding_status_transition', '1', true);
      PERFORM set_config('app.audit_reason', COALESCE(btrim(p_reason), 'legacy approve'), true);
      UPDATE public.providers SET is_verified = true, is_active = true, onboarding_status = 'APPROVED' WHERE id = p_provider_id;
    END IF;
  ELSE
    IF v_provider.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW', 'NEEDS_CHANGES') THEN
      PERFORM public.admin_provider_onboarding_action(
        p_provider_id, 'reject', 'legacy_reject', btrim(p_reason), NULL
      );
    ELSE
      PERFORM set_config('app.onboarding_status_transition', '1', true);
      PERFORM set_config('app.audit_reason', btrim(p_reason), true);
      UPDATE public.providers
      SET is_verified = false, is_active = false, onboarding_status = 'REJECTED',
          review_reason_code = 'legacy_reject', review_reason_public = btrim(p_reason), last_review_at = now()
      WHERE id = p_provider_id;
    END IF;
  END IF;
END;
$$;

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
      'city', v_provider.city
    ),
    'profile', jsonb_build_object(
      'full_name', v_profile.full_name,
      'phone', v_profile.phone,
      'avatar_url', v_profile.avatar_url
    ),
    'details', CASE WHEN v_details.provider_id IS NULL THEN NULL ELSE to_jsonb(v_details) END,
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

-- Providers cannot read internal admin notes via direct column access when not admin.
CREATE OR REPLACE FUNCTION public.providers_safe_for_owner(p_provider_id uuid)
RETURNS TABLE (
  id uuid,
  profile_id uuid,
  onboarding_status public.provider_onboarding_status,
  submitted_at timestamptz,
  review_reason_public text,
  review_reason_code text,
  bio_en text,
  bio_ar text,
  years_experience integer,
  languages text[],
  city text,
  is_verified boolean,
  is_active boolean
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.profile_id, p.onboarding_status, p.submitted_at, p.review_reason_public, p.review_reason_code,
         p.bio_en, p.bio_ar, p.years_experience, p.languages, p.city, p.is_verified, p.is_active
  FROM public.providers p
  WHERE p.id = p_provider_id
    AND (p.profile_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
$$;
REVOKE ALL ON FUNCTION public.providers_safe_for_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.providers_safe_for_owner(uuid) TO authenticated;
