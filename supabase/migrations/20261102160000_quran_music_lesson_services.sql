-- Issue #268: Quran memorization/tajweed and music lesson services (catalog seed).
-- Draft only — do not apply to Production until PO confirms prices.
--
-- Data model:
--   teaching_subject_services (existing) scopes subjects per service.
--   service_teaching_levels (new) scopes grade/skill levels per service.
--   services.requires_teaching_curriculum — false for quran/music (NA curriculum row).
-- School tutoring behaviour is unchanged; this migration is additive.

-- ---------------------------------------------------------------------------
-- 1. Durations: allow 45-minute lesson sessions
-- ---------------------------------------------------------------------------

ALTER TABLE public.teaching_subjects
  DROP CONSTRAINT IF EXISTS teaching_subjects_max_session_duration_min_check;

ALTER TABLE public.teaching_subjects
  ADD CONSTRAINT teaching_subjects_max_session_duration_min_check
  CHECK (max_session_duration_min IN (45, 60, 90, 120, 180));

ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_allowed_session_durations_valid;

ALTER TABLE public.services
  ADD CONSTRAINT services_allowed_session_durations_valid
  CHECK (
    allowed_session_durations IS NULL
    OR allowed_session_durations <@ ARRAY[45, 60, 90, 120, 180]::int[]
  );

-- ---------------------------------------------------------------------------
-- 2. Level scoping + curriculum requirement flag
-- ---------------------------------------------------------------------------

ALTER TABLE public.teaching_levels
  ADD COLUMN IF NOT EXISTS level_kind text NOT NULL DEFAULT 'school_grade'
  CHECK (level_kind IN ('school_grade', 'skill'));

CREATE TABLE IF NOT EXISTS public.service_teaching_levels (
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  level_id uuid NOT NULL REFERENCES public.teaching_levels(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, level_id)
);

ALTER TABLE public.service_teaching_levels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_teaching_levels_read ON public.service_teaching_levels;
CREATE POLICY service_teaching_levels_read ON public.service_teaching_levels
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS service_teaching_levels_admin ON public.service_teaching_levels;
CREATE POLICY service_teaching_levels_admin ON public.service_teaching_levels
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

REVOKE ALL PRIVILEGES ON TABLE public.service_teaching_levels FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.service_teaching_levels TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.service_teaching_levels TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.service_teaching_levels TO service_role;

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS requires_teaching_curriculum boolean NOT NULL DEFAULT true;

UPDATE public.services
SET requires_teaching_curriculum = true
WHERE requires_teaching_curriculum IS DISTINCT FROM true;

-- ---------------------------------------------------------------------------
-- 3. Taxonomy seed: NA curriculum, skill levels, lesson subjects
-- ---------------------------------------------------------------------------

INSERT INTO public.teaching_curricula (code, name_en, name_ar, sort_order) VALUES
  ('na', 'Not applicable', 'بدون منهج دراسي', 99)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.teaching_levels (code, name_en, name_ar, sort_order, level_kind) VALUES
  ('skill_beginner', 'Beginner', 'مبتدئ', 101, 'skill'),
  ('skill_intermediate', 'Intermediate', 'متوسط', 102, 'skill'),
  ('skill_advanced', 'Advanced', 'متقدم', 103, 'skill')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.teaching_subjects (code, name_en, name_ar, max_session_duration_min, sort_order) VALUES
  ('quran_memorization', 'Quran memorization', 'حفظ', 90, 101),
  ('quran_tajweed', 'Tajweed', 'تجويد', 90, 102),
  ('quran_recitation_review', 'Recitation & review', 'تلاوة ومراجعة', 90, 103),
  ('music_piano_keyboard', 'Piano / keyboard', 'بيانو / أورج', 90, 104),
  ('music_guitar', 'Guitar', 'جيتار', 90, 105),
  ('music_oud', 'Oud', 'عود', 90, 106),
  ('music_violin', 'Violin', 'كمان', 90, 107)
ON CONFLICT (code) DO NOTHING;

-- Placeholder min/max — PO must confirm before activating services in Production.
DO $$
DECLARE
  r record;
  v_category_id uuid;
BEGIN
  SELECT id INTO v_category_id FROM public.categories WHERE slug = 'tutoring';
  IF v_category_id IS NULL THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT * FROM (VALUES
      ('quran-lessons', 'Quran memorization & tajweed', 'تحفيظ قرآن وتجويد', 150, 500),
      ('music-lessons', 'Music lessons', 'دروس موسيقى', 300, 1000)
    ) AS t(slug, name_en, name_ar, minimum_price, maximum_price)
  LOOP
    INSERT INTO public.services (
      id, category_id, slug, name_en, name_ar, pricing_model,
      minimum_price, maximum_price, allowed_session_durations,
      requires_teaching_curriculum, is_active
    )
    SELECT
      gen_random_uuid(), v_category_id, r.slug, r.name_en, r.name_ar, 'hourly',
      r.minimum_price, r.maximum_price, ARRAY[45, 60, 90]::int[], false, false
    WHERE NOT EXISTS (SELECT 1 FROM public.services WHERE slug = r.slug);
  END LOOP;
END $$;

-- Subject ↔ service links
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('quran_memorization', 'quran-lessons'),
      ('quran_tajweed', 'quran-lessons'),
      ('quran_recitation_review', 'quran-lessons'),
      ('music_piano_keyboard', 'music-lessons'),
      ('music_guitar', 'music-lessons'),
      ('music_oud', 'music-lessons'),
      ('music_violin', 'music-lessons')
    ) AS t(subject_code, service_slug)
  LOOP
    INSERT INTO public.teaching_subject_services (subject_id, service_id)
    SELECT sub.id, svc.id
    FROM public.teaching_subjects sub
    JOIN public.services svc ON svc.slug = r.service_slug
    WHERE sub.code = r.subject_code
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- School grade levels ↔ existing tutoring services (unchanged set of grades)
INSERT INTO public.service_teaching_levels (service_id, level_id)
SELECT svc.id, lvl.id
FROM public.services svc
JOIN public.teaching_levels lvl ON lvl.level_kind = 'school_grade'
WHERE svc.slug IN ('homework-support', 'school-subject-tutoring', 'language-tutoring')
ON CONFLICT DO NOTHING;

-- Skill levels ↔ lesson services
INSERT INTO public.service_teaching_levels (service_id, level_id)
SELECT svc.id, lvl.id
FROM public.services svc
JOIN public.teaching_levels lvl ON lvl.level_kind = 'skill'
WHERE svc.slug IN ('quran-lessons', 'music-lessons')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Teaching capability RPC — curriculum rules + level scoping + 45 min
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.provider_upsert_teaching_capability(
  p_service_id uuid,
  p_subject_id uuid,
  p_curriculum_id uuid,
  p_level_id uuid,
  p_session_duration_min int,
  p_session_price integer,
  p_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider_id uuid;
  v_service RECORD;
  v_subject RECORD;
  v_curriculum_code text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_provider_id FROM public.providers WHERE profile_id = v_uid;
  IF v_provider_id IS NULL THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Provider profile required.' USING ERRCODE = '42501';
  END IF;

  SELECT s.*, c.slug AS category_slug
  INTO v_service
  FROM public.services s
  JOIN public.categories c ON c.id = s.category_id
  WHERE s.id = p_service_id;
  IF NOT FOUND OR v_service.category_slug IS DISTINCT FROM 'tutoring' THEN
    RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Service is not a tutoring service.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_subject FROM public.teaching_subjects WHERE id = p_subject_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Subject was not found.' USING ERRCODE = '23514';
  END IF;
  IF v_subject.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Subject is not active.' USING ERRCODE = '23514';
  END IF;

  SELECT code INTO v_curriculum_code FROM public.teaching_curricula WHERE id = p_curriculum_id;
  IF v_curriculum_code IS NULL THEN
    RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Curriculum was not found.' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(v_service.requires_teaching_curriculum, true) THEN
    IF v_curriculum_code = 'na' THEN
      RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: School curriculum is required for this service.' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.teaching_curricula WHERE id = p_curriculum_id AND is_active
    ) THEN
      RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Curriculum is not active.' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF v_curriculum_code IS DISTINCT FROM 'na' THEN
      RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: This service does not use a school curriculum.' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.teaching_levels WHERE id = p_level_id
  ) THEN
    RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Level was not found.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.teaching_levels WHERE id = p_level_id AND is_active
  ) THEN
    RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Level is not active.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.service_teaching_levels
    WHERE service_id = p_service_id AND level_id = p_level_id
  ) THEN
    RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Level is not linked to this service.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.teaching_subject_services
    WHERE subject_id = p_subject_id AND service_id = p_service_id
  ) THEN
    RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Subject is not linked to this service.' USING ERRCODE = '23514';
  END IF;

  IF p_session_duration_min IS NULL
     OR p_session_duration_min NOT IN (45, 60, 90, 120, 180)
     OR v_service.allowed_session_durations IS NULL
     OR NOT (p_session_duration_min = ANY (v_service.allowed_session_durations))
     OR p_session_duration_min > v_subject.max_session_duration_min
  THEN
    RAISE EXCEPTION 'TEACHING_INVALID_DURATION: Session duration is not allowed for this subject.' USING ERRCODE = '23514';
  END IF;

  IF p_session_price IS NULL
     OR p_session_price <= 0
     OR (v_service.minimum_price IS NOT NULL AND p_session_price < v_service.minimum_price)
     OR (v_service.maximum_price IS NOT NULL AND p_session_price > v_service.maximum_price)
  THEN
    RAISE EXCEPTION 'TEACHING_INVALID_PRICE: Session price must be whole EGP within the service limits.' USING ERRCODE = '23514';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.provider_teaching_capabilities
    SET service_id = p_service_id,
        subject_id = p_subject_id,
        curriculum_id = p_curriculum_id,
        level_id = p_level_id,
        session_duration_min = p_session_duration_min,
        session_price = p_session_price,
        status = 'pending',
        submitted_at = now(),
        reviewed_by = NULL,
        reviewed_at = NULL,
        review_note = NULL
    WHERE id = p_id AND provider_id = v_provider_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Capability does not belong to this provider.' USING ERRCODE = '42501';
    END IF;
    RETURN v_id;
  END IF;

  INSERT INTO public.provider_teaching_capabilities (
    provider_id, service_id, subject_id, curriculum_id, level_id,
    session_duration_min, session_price, status, submitted_at,
    reviewed_by, reviewed_at, review_note
  ) VALUES (
    v_provider_id, p_service_id, p_subject_id, p_curriculum_id, p_level_id,
    p_session_duration_min, p_session_price, 'pending', now(),
    NULL, NULL, NULL
  )
  ON CONFLICT (provider_id, service_id, subject_id, curriculum_id, level_id)
  DO UPDATE SET
    session_duration_min = EXCLUDED.session_duration_min,
    session_price = EXCLUDED.session_price,
    status = 'pending',
    submitted_at = now(),
    reviewed_by = NULL,
    reviewed_at = NULL,
    review_note = NULL
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_upsert_teaching_capability(uuid, uuid, uuid, uuid, int, integer, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_upsert_teaching_capability(uuid, uuid, uuid, uuid, int, integer, uuid)
  TO authenticated;

-- Booking eligibility: enforce service ↔ level link
CREATE OR REPLACE FUNCTION public.assert_tutoring_capability(
  p_provider_id uuid,
  p_service_id uuid,
  p_capability_id uuid,
  p_subject_code text,
  p_curriculum_code text,
  p_level_code text,
  p_start_at timestamptz,
  p_end_at timestamptz
)
RETURNS TABLE (
  capability_id uuid,
  session_price integer,
  session_duration_min int,
  subject_code text,
  subject_name_en text,
  subject_name_ar text,
  curriculum_code text,
  curriculum_name_en text,
  curriculum_name_ar text,
  level_code text,
  level_name_en text,
  level_name_ar text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_service RECORD;
  v_cap RECORD;
  v_duration_min int;
BEGIN
  SELECT s.*, c.slug AS category_slug
  INTO v_service
  FROM public.services s
  JOIN public.categories c ON c.id = s.category_id
  WHERE s.id = p_service_id;

  IF v_service.category_slug IS DISTINCT FROM 'tutoring' THEN
    RETURN;
  END IF;

  IF p_capability_id IS NULL THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: An approved teaching capability is required to book tutoring.' USING ERRCODE = '23514';
  END IF;

  SELECT
    cap.id, cap.provider_id, cap.service_id, cap.subject_id, cap.status,
    cap.session_duration_min, cap.session_price,
    sub.code AS subject_code, sub.name_en AS subject_name_en, sub.name_ar AS subject_name_ar,
    sub.max_session_duration_min AS subject_max_duration,
    sub.is_active AS subject_active,
    cur.code AS curriculum_code, cur.name_en AS curriculum_name_en, cur.name_ar AS curriculum_name_ar,
    cur.is_active AS curriculum_active,
    lvl.code AS level_code, lvl.name_en AS level_name_en, lvl.name_ar AS level_name_ar,
    lvl.is_active AS level_active
  INTO v_cap
  FROM public.provider_teaching_capabilities cap
  JOIN public.teaching_subjects sub ON sub.id = cap.subject_id
  JOIN public.teaching_curricula cur ON cur.id = cap.curriculum_id
  JOIN public.teaching_levels lvl ON lvl.id = cap.level_id
  WHERE cap.id = p_capability_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Teaching capability was not found.' USING ERRCODE = '23514';
  END IF;
  IF v_cap.subject_active IS NOT TRUE
     OR v_cap.level_active IS NOT TRUE
     OR (COALESCE(v_service.requires_teaching_curriculum, true) AND v_cap.curriculum_active IS NOT TRUE)
  THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Subject, curriculum, or level is no longer active.' USING ERRCODE = '23514';
  END IF;
  IF v_cap.provider_id IS DISTINCT FROM p_provider_id THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Teaching capability does not belong to this provider.' USING ERRCODE = '23514';
  END IF;
  IF v_cap.service_id IS DISTINCT FROM p_service_id THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Teaching capability does not match the selected service.' USING ERRCODE = '23514';
  END IF;
  IF v_cap.status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Teaching capability is not approved.' USING ERRCODE = '23514';
  END IF;
  IF p_subject_code IS DISTINCT FROM v_cap.subject_code
     OR p_curriculum_code IS DISTINCT FROM v_cap.curriculum_code
     OR p_level_code IS DISTINCT FROM v_cap.level_code
  THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Subject, curriculum, or level does not match the selected capability.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.teaching_subject_services tss
    WHERE tss.subject_id = v_cap.subject_id AND tss.service_id = p_service_id
  ) THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Subject is not linked to this service.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.service_teaching_levels stl
    WHERE stl.service_id = p_service_id AND stl.level_id = (
      SELECT level_id FROM public.provider_teaching_capabilities WHERE id = p_capability_id
    )
  ) THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Level is not linked to this service.' USING ERRCODE = '23514';
  END IF;

  v_duration_min := ROUND(EXTRACT(EPOCH FROM (p_end_at - p_start_at)) / 60.0)::int;
  IF v_duration_min IS DISTINCT FROM v_cap.session_duration_min THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Booking duration does not match the capability session length.' USING ERRCODE = '23514';
  END IF;
  IF v_service.allowed_session_durations IS NULL
     OR NOT (v_cap.session_duration_min = ANY (v_service.allowed_session_durations))
     OR v_cap.session_duration_min > v_cap.subject_max_duration
  THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Session duration is not allowed for this subject.' USING ERRCODE = '23514';
  END IF;
  IF (v_service.minimum_price IS NOT NULL AND v_cap.session_price < v_service.minimum_price)
     OR (v_service.maximum_price IS NOT NULL AND v_cap.session_price > v_service.maximum_price)
  THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Capability price no longer meets pricing rules.' USING ERRCODE = '23514';
  END IF;

  capability_id := v_cap.id;
  session_price := v_cap.session_price;
  session_duration_min := v_cap.session_duration_min;
  subject_code := v_cap.subject_code;
  subject_name_en := v_cap.subject_name_en;
  subject_name_ar := v_cap.subject_name_ar;
  curriculum_code := v_cap.curriculum_code;
  curriculum_name_en := v_cap.curriculum_name_en;
  curriculum_name_ar := v_cap.curriculum_name_ar;
  level_code := v_cap.level_code;
  level_name_en := v_cap.level_name_en;
  level_name_ar := v_cap.level_name_ar;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_tutoring_capability(uuid, uuid, uuid, text, text, text, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
