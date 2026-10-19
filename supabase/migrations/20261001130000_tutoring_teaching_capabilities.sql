-- Tutoring teaching capabilities: approved subject/curriculum/level sessions
-- with a fixed duration and a fixed whole-EGP price.
--
-- Draft only. Do not apply to QA or Production.
-- Babysitting pricing is unchanged.
-- This file sorts after 20261001121000, so tg_validate_booking_service is the
-- #95 commission-snapshot body plus the tutoring price branch only.
-- For tutoring, commission base = session_price + provider extras.
--
-- See docs/design/tutoring-capability-pricing.md.

-- ---------------------------------------------------------------------------
-- 1. Teaching taxonomy
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.teaching_curricula (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name_en     text NOT NULL,
  name_ar     text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.teaching_levels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name_en     text NOT NULL,
  name_ar     text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.teaching_subjects (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                     text NOT NULL UNIQUE,
  name_en                  text NOT NULL,
  name_ar                  text NOT NULL,
  max_session_duration_min int NOT NULL DEFAULT 120
    CHECK (max_session_duration_min IN (60, 90, 120, 180)),
  is_active                boolean NOT NULL DEFAULT true,
  sort_order               int NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.teaching_subject_services (
  subject_id uuid NOT NULL REFERENCES public.teaching_subjects(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  PRIMARY KEY (subject_id, service_id)
);

DROP TRIGGER IF EXISTS trg_teaching_curricula_updated ON public.teaching_curricula;
CREATE TRIGGER trg_teaching_curricula_updated
  BEFORE UPDATE ON public.teaching_curricula
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_teaching_levels_updated ON public.teaching_levels;
CREATE TRIGGER trg_teaching_levels_updated
  BEFORE UPDATE ON public.teaching_levels
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_teaching_subjects_updated ON public.teaching_subjects;
CREATE TRIGGER trg_teaching_subjects_updated
  BEFORE UPDATE ON public.teaching_subjects
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.teaching_curricula (code, name_en, name_ar, sort_order) VALUES
  ('eg_national_ar',   'Egyptian National (Arabic)',                    'المنهج المصري (عربي)',           1),
  ('eg_national_lang', 'Egyptian National (Languages / Experimental)',  'المنهج المصري (لغات / تجريبي)',  2),
  ('british',          'British (IGCSE / A Level)',                     'البريطاني (IGCSE / A Level)',     3),
  ('american',         'American (Diploma)',                            'الأمريكي (دبلومة)',               4),
  ('ib',               'International Baccalaureate (IB)',              'البكالوريا الدولية (IB)',         5),
  ('french',           'French',                                        'الفرنسي',                         6),
  ('german',           'German',                                        'الألماني',                        7)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.teaching_levels (code, name_en, name_ar, sort_order) VALUES
  ('kg',  'Kindergarten (KG1–KG2)',        'رياض الأطفال (KG1–KG2)',                 1),
  ('g1',  'Grade 1',                       'الصف الأول',                              2),
  ('g2',  'Grade 2',                       'الصف الثاني',                             3),
  ('g3',  'Grade 3',                       'الصف الثالث',                             4),
  ('g4',  'Grade 4',                       'الصف الرابع',                             5),
  ('g5',  'Grade 5',                       'الصف الخامس',                             6),
  ('g6',  'Grade 6',                       'الصف السادس',                             7),
  ('g7',  'Grade 7 (Prep 1)',              'الصف السابع (أولى إعدادي)',              8),
  ('g8',  'Grade 8 (Prep 2)',              'الصف الثامن (تانية إعدادي)',             9),
  ('g9',  'Grade 9 (Prep 3)',              'الصف التاسع (تالتة إعدادي)',             10),
  ('g10', 'Grade 10 (Secondary 1)',        'الصف العاشر (أولى ثانوي)',               11),
  ('g11', 'Grade 11 (Secondary 2)',        'الصف الحادي عشر (تانية ثانوي)',          12),
  ('g12', 'Grade 12 (Secondary 3)',        'الصف الثاني عشر (تالتة ثانوي)',          13)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.teaching_subjects (code, name_en, name_ar, max_session_duration_min, sort_order) VALUES
  ('homework_all',    'Homework support (all subjects)', 'متابعة الواجبات (كل المواد)', 120, 1),
  ('math',            'Mathematics',                     'الرياضيات',                   180, 2),
  ('physics',         'Physics',                         'الفيزياء',                    180, 3),
  ('chemistry',       'Chemistry',                       'الكيمياء',                    180, 4),
  ('biology',         'Biology',                         'الأحياء',                     180, 5),
  ('science',         'Science',                         'العلوم',                      120, 6),
  ('arabic',          'Arabic',                          'اللغة العربية',               120, 7),
  ('english',         'English',                         'اللغة الإنجليزية',            120, 8),
  ('french',          'French',                          'اللغة الفرنسية',              120, 9),
  ('german',          'German',                          'اللغة الألمانية',             120, 10),
  ('social_studies',  'Social Studies',                  'الدراسات الاجتماعية',         120, 11),
  ('history',         'History',                         'التاريخ',                     120, 12),
  ('geography',       'Geography',                       'الجغرافيا',                   120, 13),
  ('computer',        'Computer Science / ICT',          'الحاسب الآلي / ICT',          120, 14),
  ('philosophy',      'Philosophy & Logic',              'الفلسفة والمنطق',             120, 15),
  ('psychology',      'Psychology & Sociology',          'علم النفس والاجتماع',         120, 16)
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('homework_all',   'homework-support'),
      ('math',           'school-subject-tutoring'),
      ('physics',        'school-subject-tutoring'),
      ('chemistry',      'school-subject-tutoring'),
      ('biology',        'school-subject-tutoring'),
      ('science',        'school-subject-tutoring'),
      ('arabic',         'school-subject-tutoring'),
      ('arabic',         'language-tutoring'),
      ('english',        'school-subject-tutoring'),
      ('english',        'language-tutoring'),
      ('french',         'school-subject-tutoring'),
      ('french',         'language-tutoring'),
      ('german',         'school-subject-tutoring'),
      ('german',         'language-tutoring'),
      ('social_studies', 'school-subject-tutoring'),
      ('history',        'school-subject-tutoring'),
      ('geography',      'school-subject-tutoring'),
      ('computer',       'school-subject-tutoring'),
      ('philosophy',     'school-subject-tutoring'),
      ('psychology',     'school-subject-tutoring')
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

ALTER TABLE public.teaching_curricula ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_subject_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS teaching_curricula_read ON public.teaching_curricula;
CREATE POLICY teaching_curricula_read ON public.teaching_curricula
  FOR SELECT TO anon, authenticated
  USING (is_active OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS teaching_curricula_admin ON public.teaching_curricula;
CREATE POLICY teaching_curricula_admin ON public.teaching_curricula
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS teaching_levels_read ON public.teaching_levels;
CREATE POLICY teaching_levels_read ON public.teaching_levels
  FOR SELECT TO anon, authenticated
  USING (is_active OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS teaching_levels_admin ON public.teaching_levels;
CREATE POLICY teaching_levels_admin ON public.teaching_levels
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS teaching_subjects_read ON public.teaching_subjects;
CREATE POLICY teaching_subjects_read ON public.teaching_subjects
  FOR SELECT TO anon, authenticated
  USING (is_active OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS teaching_subjects_admin ON public.teaching_subjects;
CREATE POLICY teaching_subjects_admin ON public.teaching_subjects
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS teaching_subject_services_read ON public.teaching_subject_services;
CREATE POLICY teaching_subject_services_read ON public.teaching_subject_services
  FOR SELECT TO anon, authenticated
  USING (true);
DROP POLICY IF EXISTS teaching_subject_services_admin ON public.teaching_subject_services;
CREATE POLICY teaching_subject_services_admin ON public.teaching_subject_services
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

REVOKE ALL PRIVILEGES ON TABLE public.teaching_curricula FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.teaching_levels FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.teaching_subjects FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.teaching_subject_services FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.teaching_curricula TO authenticated;
GRANT SELECT ON TABLE public.teaching_curricula TO anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.teaching_levels TO authenticated;
GRANT SELECT ON TABLE public.teaching_levels TO anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.teaching_subjects TO authenticated;
GRANT SELECT ON TABLE public.teaching_subjects TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.teaching_subject_services TO authenticated;
GRANT SELECT ON TABLE public.teaching_subject_services TO anon;
GRANT ALL PRIVILEGES ON TABLE public.teaching_curricula TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.teaching_levels TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.teaching_subjects TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.teaching_subject_services TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Service duration set + tutoring price band
-- ---------------------------------------------------------------------------

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS allowed_session_durations int[];

ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_allowed_session_durations_valid;
ALTER TABLE public.services
  ADD CONSTRAINT services_allowed_session_durations_valid
  CHECK (
    allowed_session_durations IS NULL
    OR allowed_session_durations <@ ARRAY[60, 90, 120, 180]
  );

UPDATE public.services
SET allowed_session_durations = ARRAY[60, 90, 120, 180]::int[]
WHERE slug IN ('homework-support', 'school-subject-tutoring', 'language-tutoring')
  AND (allowed_session_durations IS DISTINCT FROM ARRAY[60, 90, 120, 180]::int[]);

-- Idempotent launch band for the three tutoring services only.
UPDATE public.services
SET minimum_price = 300,
    maximum_price = 1500
WHERE slug IN ('homework-support', 'school-subject-tutoring', 'language-tutoring');

-- ---------------------------------------------------------------------------
-- 3. Provider teaching capabilities
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.provider_teaching_capabilities (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id           uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  service_id            uuid NOT NULL REFERENCES public.services(id),
  subject_id            uuid NOT NULL REFERENCES public.teaching_subjects(id),
  curriculum_id         uuid NOT NULL REFERENCES public.teaching_curricula(id),
  level_id              uuid NOT NULL REFERENCES public.teaching_levels(id),
  session_duration_min  int NOT NULL CHECK (session_duration_min IN (60, 90, 120, 180)),
  session_price         integer NOT NULL CHECK (session_price > 0),
  status                text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  submitted_at          timestamptz NOT NULL DEFAULT now(),
  reviewed_by           uuid REFERENCES public.profiles(id),
  reviewed_at           timestamptz,
  review_note           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_teaching_capability_unique
    UNIQUE (provider_id, service_id, subject_id, curriculum_id, level_id),
  CONSTRAINT provider_teaching_review_note_len
    CHECK (review_note IS NULL OR length(review_note) <= 500)
);

COMMENT ON COLUMN public.provider_teaching_capabilities.review_note IS
  'Admin-only; never returned to customers.';

CREATE INDEX IF NOT EXISTS idx_provider_teaching_cap_provider
  ON public.provider_teaching_capabilities (provider_id, status);
CREATE INDEX IF NOT EXISTS idx_provider_teaching_cap_service
  ON public.provider_teaching_capabilities (service_id, status)
  WHERE status = 'approved';

DROP TRIGGER IF EXISTS trg_provider_teaching_cap_updated ON public.provider_teaching_capabilities;
CREATE TRIGGER trg_provider_teaching_cap_updated
  BEFORE UPDATE ON public.provider_teaching_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.provider_teaching_capabilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS teaching_cap_public_approved ON public.provider_teaching_capabilities;
CREATE POLICY teaching_cap_public_approved ON public.provider_teaching_capabilities
  FOR SELECT TO anon, authenticated
  USING (status = 'approved');

DROP POLICY IF EXISTS teaching_cap_owner_read ON public.provider_teaching_capabilities;
CREATE POLICY teaching_cap_owner_read ON public.provider_teaching_capabilities
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS teaching_cap_admin_read ON public.provider_teaching_capabilities;
CREATE POLICY teaching_cap_admin_read ON public.provider_teaching_capabilities
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

REVOKE ALL PRIVILEGES ON TABLE public.provider_teaching_capabilities FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, provider_id, service_id, subject_id, curriculum_id, level_id,
  session_duration_min, session_price, status, submitted_at, created_at, updated_at
) ON public.provider_teaching_capabilities TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.provider_teaching_capabilities TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Booking snapshot columns + immutability
-- ---------------------------------------------------------------------------

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS teaching_capability_id uuid REFERENCES public.provider_teaching_capabilities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS teaching_subject_code text,
  ADD COLUMN IF NOT EXISTS teaching_subject_name_en text,
  ADD COLUMN IF NOT EXISTS teaching_subject_name_ar text,
  ADD COLUMN IF NOT EXISTS teaching_curriculum_code text,
  ADD COLUMN IF NOT EXISTS teaching_curriculum_name_en text,
  ADD COLUMN IF NOT EXISTS teaching_curriculum_name_ar text,
  ADD COLUMN IF NOT EXISTS teaching_level_code text,
  ADD COLUMN IF NOT EXISTS teaching_level_name_en text,
  ADD COLUMN IF NOT EXISTS teaching_level_name_ar text,
  ADD COLUMN IF NOT EXISTS session_duration_min int;

CREATE OR REPLACE FUNCTION public.tg_bookings_immutable_teaching_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.teaching_capability_id IS DISTINCT FROM OLD.teaching_capability_id
     OR NEW.teaching_subject_code IS DISTINCT FROM OLD.teaching_subject_code
     OR NEW.teaching_subject_name_en IS DISTINCT FROM OLD.teaching_subject_name_en
     OR NEW.teaching_subject_name_ar IS DISTINCT FROM OLD.teaching_subject_name_ar
     OR NEW.teaching_curriculum_code IS DISTINCT FROM OLD.teaching_curriculum_code
     OR NEW.teaching_curriculum_name_en IS DISTINCT FROM OLD.teaching_curriculum_name_en
     OR NEW.teaching_curriculum_name_ar IS DISTINCT FROM OLD.teaching_curriculum_name_ar
     OR NEW.teaching_level_code IS DISTINCT FROM OLD.teaching_level_code
     OR NEW.teaching_level_name_en IS DISTINCT FROM OLD.teaching_level_name_en
     OR NEW.teaching_level_name_ar IS DISTINCT FROM OLD.teaching_level_name_ar
     OR NEW.session_duration_min IS DISTINCT FROM OLD.session_duration_min
     OR NEW.price_subtotal IS DISTINCT FROM OLD.price_subtotal
  THEN
    RAISE EXCEPTION 'Booking teaching snapshot and price cannot be changed after creation.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_immutable_teaching_snapshot ON public.bookings;
CREATE TRIGGER trg_bookings_immutable_teaching_snapshot
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_bookings_immutable_teaching_snapshot();

-- ---------------------------------------------------------------------------
-- 5. SECURITY DEFINER RPCs
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
  IF NOT EXISTS (
    SELECT 1 FROM public.teaching_curricula WHERE id = p_curriculum_id
  ) THEN
    RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Curriculum was not found.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.teaching_curricula WHERE id = p_curriculum_id AND is_active
  ) THEN
    RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Curriculum is not active.' USING ERRCODE = '23514';
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
    SELECT 1 FROM public.teaching_subject_services
    WHERE subject_id = p_subject_id AND service_id = p_service_id
  ) THEN
    RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Subject is not linked to this service.' USING ERRCODE = '23514';
  END IF;

  IF p_session_duration_min IS NULL
     OR p_session_duration_min NOT IN (60, 90, 120, 180)
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

CREATE OR REPLACE FUNCTION public.provider_remove_teaching_capability(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider_id uuid;
  v_deleted int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_provider_id FROM public.providers WHERE profile_id = v_uid;
  IF v_provider_id IS NULL THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Provider profile required.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.provider_teaching_capabilities
  WHERE id = p_id AND provider_id = v_provider_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Capability does not belong to this provider.' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_teaching_capability(
  p_id uuid,
  p_status text,
  p_review_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cap RECORD;
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Admin role required.' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('approved', 'rejected', 'suspended') THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Review status must be approved, rejected, or suspended.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_cap FROM public.provider_teaching_capabilities WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Capability was not found.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.providers p
    WHERE p.id = v_cap.provider_id AND p.profile_id = v_uid
  ) THEN
    RAISE EXCEPTION 'TEACHING_SELF_REVIEW: You cannot review your own teaching capability.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.provider_teaching_capabilities
  SET status = p_status,
      reviewed_by = v_uid,
      reviewed_at = now(),
      review_note = NULLIF(btrim(p_review_note), '')
  WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_provider_teaching_capabilities(p_provider_id uuid)
RETURNS TABLE (
  id uuid,
  provider_id uuid,
  service_id uuid,
  subject_id uuid,
  curriculum_id uuid,
  level_id uuid,
  session_duration_min int,
  session_price integer,
  status text,
  submitted_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
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
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Admin role required.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    cap.id, cap.provider_id, cap.service_id, cap.subject_id, cap.curriculum_id, cap.level_id,
    cap.session_duration_min, cap.session_price, cap.status, cap.submitted_at,
    cap.reviewed_by, cap.reviewed_at, cap.review_note,
    sub.code, sub.name_en, sub.name_ar,
    cur.code, cur.name_en, cur.name_ar,
    lvl.code, lvl.name_en, lvl.name_ar
  FROM public.provider_teaching_capabilities cap
  JOIN public.teaching_subjects sub ON sub.id = cap.subject_id
  JOIN public.teaching_curricula cur ON cur.id = cap.curriculum_id
  JOIN public.teaching_levels lvl ON lvl.id = cap.level_id
  WHERE cap.provider_id = p_provider_id
  ORDER BY cap.submitted_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_upsert_teaching_capability(uuid, uuid, uuid, uuid, int, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_upsert_teaching_capability(uuid, uuid, uuid, uuid, int, integer, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.provider_remove_teaching_capability(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_remove_teaching_capability(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_review_teaching_capability(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_teaching_capability(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_list_provider_teaching_capabilities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_provider_teaching_capabilities(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Tutoring eligibility (called from tg_validate_booking_service)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_tutoring_capability(
  p_provider_id uuid,
  p_service_id uuid,
  p_capability_id uuid,
  p_subject_code text,
  p_curriculum_code text,
  p_level_code text,
  p_start_at timestamptz,
  p_end_at timestamptz
) RETURNS TABLE (
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
     OR v_cap.curriculum_active IS NOT TRUE
     OR v_cap.level_active IS NOT TRUE
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

-- ---------------------------------------------------------------------------
-- 7. tg_validate_booking_service — #95 commission body + tutoring price branch
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_validate_booking_service()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_addr RECORD;
  v_zone RECORD;
  v_service RECORD;
  v_ps RECORD;
  v_provider_hourly_rate numeric(10,2);
  v_rate numeric(10,2);
  v_hours numeric;
  v_expected_subtotal numeric(10,2);
  v_req RECORD;
  v_selection jsonb;
  v_extras_total numeric(10,2) := 0;
  v_promo RECORD;
  v_discount numeric(10,2);
  v_used_by_customer int;
  v_billing jsonb;
  v_platform_fee numeric(10,2);
  v_vat_percent numeric;
  v_vat numeric(10,2);
  v_travel_fee numeric(10,2);
  v_expected_total numeric(10,2);
  v_fm RECORD;
  v_rpc_insert boolean := current_setting('app.create_booking_in_progress', true) = 'on';
  v_commission_percent numeric(5,2);
  v_commission_base numeric(10,2);
  v_category_slug text;
  v_tut RECORD;
BEGIN
  SELECT * INTO v_service FROM public.services WHERE id = NEW.service_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_SERVICE_UNAVAILABLE: Selected service is not currently available.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_ps FROM public.provider_services
    WHERE provider_id = NEW.provider_id AND service_id = NEW.service_id AND status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: This provider is not approved to offer the selected service.' USING ERRCODE = '23514';
  END IF;

  IF NEW.address_id IS NULL THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: A saved address with a valid location is required to book.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_addr FROM public.addresses WHERE id = NEW.address_id;
  IF NOT FOUND OR v_addr.lat IS NULL OR v_addr.lng IS NULL THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Selected address has no valid location coordinates.' USING ERRCODE = '23514';
  END IF;

  IF v_addr.user_id IS DISTINCT FROM NEW.customer_id THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Address does not belong to this customer.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.zones z
    WHERE z.is_active AND (
      (z.boundary_type = 'polygon' AND public.point_in_polygon(v_addr.lat, v_addr.lng, z.polygon))
      OR (z.boundary_type = 'circle' AND 6371 * acos(LEAST(1, GREATEST(-1,
        cos(radians(v_addr.lat)) * cos(radians(z.center_lat)) * cos(radians(z.center_lng) - radians(v_addr.lng))
        + sin(radians(v_addr.lat)) * sin(radians(z.center_lat))))) <= z.radius_km)
    )
  ) THEN
    RAISE EXCEPTION 'BOOKING_ADDRESS_OUTSIDE_ZONE: This area is not currently served.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.zones z
    JOIN public.zone_services zs ON zs.zone_id = z.id AND zs.service_id = NEW.service_id
    JOIN public.zone_providers zp ON zp.zone_id = z.id AND zp.provider_id = NEW.provider_id
    WHERE z.is_active AND (
      (z.boundary_type = 'polygon' AND public.point_in_polygon(v_addr.lat, v_addr.lng, z.polygon))
      OR (z.boundary_type = 'circle' AND 6371 * acos(LEAST(1, GREATEST(-1,
        cos(radians(v_addr.lat)) * cos(radians(z.center_lat)) * cos(radians(z.center_lng) - radians(v_addr.lng))
        + sin(radians(v_addr.lat)) * sin(radians(z.center_lat))))) <= z.radius_km)
    )
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.zones z
      JOIN public.zone_services zs ON zs.zone_id = z.id AND zs.service_id = NEW.service_id
      WHERE z.is_active AND (
        (z.boundary_type = 'polygon' AND public.point_in_polygon(v_addr.lat, v_addr.lng, z.polygon))
        OR (z.boundary_type = 'circle' AND 6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(v_addr.lat)) * cos(radians(z.center_lat)) * cos(radians(z.center_lng) - radians(v_addr.lng))
          + sin(radians(v_addr.lat)) * sin(radians(z.center_lat))))) <= z.radius_km)
      )
    ) THEN
      RAISE EXCEPTION 'BOOKING_ADDRESS_OUTSIDE_ZONE: The selected service is not offered in this area.' USING ERRCODE = '23514';
    END IF;
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: This provider does not serve the selected area.' USING ERRCODE = '23514';
  END IF;

  IF NEW.family_member_id IS NOT NULL THEN
    SELECT * INTO v_fm FROM public.family_members WHERE id = NEW.family_member_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Selected family member was not found.' USING ERRCODE = '23514';
    END IF;
    IF v_fm.customer_id IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Selected family member does not belong to this customer.' USING ERRCODE = '42501';
    END IF;
    IF NOT v_fm.is_active THEN
      RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Selected family member is no longer active.' USING ERRCODE = '23514';
    END IF;
  END IF;

  PERFORM public.assert_babysitting_booking_eligible(
    NEW.provider_id,
    NEW.service_id,
    NEW.customer_id,
    NEW.family_member_id,
    NEW.start_at
  );

  SELECT c.slug INTO v_category_slug
  FROM public.categories c
  WHERE c.id = v_service.category_id;

  IF v_category_slug = 'tutoring' THEN
    SELECT * INTO v_tut
    FROM public.assert_tutoring_capability(
      NEW.provider_id,
      NEW.service_id,
      NEW.teaching_capability_id,
      NEW.teaching_subject_code,
      NEW.teaching_curriculum_code,
      NEW.teaching_level_code,
      NEW.start_at,
      NEW.end_at
    );
    v_expected_subtotal := v_tut.session_price;
    NEW.teaching_capability_id := v_tut.capability_id;
    NEW.teaching_subject_code := v_tut.subject_code;
    NEW.teaching_subject_name_en := v_tut.subject_name_en;
    NEW.teaching_subject_name_ar := v_tut.subject_name_ar;
    NEW.teaching_curriculum_code := v_tut.curriculum_code;
    NEW.teaching_curriculum_name_en := v_tut.curriculum_name_en;
    NEW.teaching_curriculum_name_ar := v_tut.curriculum_name_ar;
    NEW.teaching_level_code := v_tut.level_code;
    NEW.teaching_level_name_en := v_tut.level_name_en;
    NEW.teaching_level_name_ar := v_tut.level_name_ar;
    NEW.session_duration_min := v_tut.session_duration_min;
  ELSE
    -- S6 effective-rate check from 20261001110000 / 20261001121000.
    -- provider_pricing_allowed gates only an explicit price_override;
    -- min/max apply to COALESCE(price_override, hourly_rate).
    SELECT hourly_rate INTO v_provider_hourly_rate FROM public.providers WHERE id = NEW.provider_id;
    v_rate := COALESCE(v_ps.price_override, v_provider_hourly_rate);
    IF v_ps.price_override IS NOT NULL AND NOT v_service.provider_pricing_allowed THEN
      RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Provider price no longer meets pricing rules.' USING ERRCODE = '23514';
    END IF;
    IF (v_service.minimum_price IS NOT NULL AND v_rate < v_service.minimum_price)
       OR (v_service.maximum_price IS NOT NULL AND v_rate > v_service.maximum_price)
    THEN
      RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Provider price no longer meets pricing rules.' USING ERRCODE = '23514';
    END IF;

    IF v_service.pricing_model = 'hourly' THEN
      v_hours := EXTRACT(EPOCH FROM (NEW.end_at - NEW.start_at)) / 3600.0;
      v_expected_subtotal := ROUND(v_rate * v_hours, 2);
    ELSE
      v_expected_subtotal := v_rate;
    END IF;
  END IF;

  IF NOT v_rpc_insert AND ABS(NEW.price_subtotal - v_expected_subtotal) > 0.01 THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Booking price does not match the current service price.' USING ERRCODE = '23514';
  END IF;

  FOR v_req IN
    SELECT * FROM public.service_requirements WHERE service_id = NEW.service_id AND is_active AND required_during_booking
  LOOP
    IF v_req.fulfillment_mode = 'provider' THEN
      v_extras_total := v_extras_total + v_req.provider_extra_fee;
    ELSIF v_req.fulfillment_mode = 'either' THEN
      SELECT elem INTO v_selection FROM jsonb_array_elements(COALESCE(NEW.requirement_selections, '[]'::jsonb)) elem
        WHERE (elem->>'requirement_id')::uuid = v_req.id LIMIT 1;
      IF v_selection IS NULL OR (v_selection->>'chosen_by') NOT IN ('customer', 'provider') THEN
        RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: A choice is required for: %', v_req.name_en USING ERRCODE = '23514';
      END IF;
      IF v_selection->>'chosen_by' = 'provider' THEN
        v_extras_total := v_extras_total + v_req.provider_extra_fee;
      END IF;
    END IF;
  END LOOP;

  IF v_service.maximum_extras_total IS NOT NULL AND v_extras_total > v_service.maximum_extras_total THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Selected extras exceed the maximum allowed.' USING ERRCODE = '23514';
  END IF;

  SELECT value INTO v_billing FROM public.settings WHERE key = 'billing';
  v_platform_fee := COALESCE((v_billing->>'platform_fee')::numeric, 25);
  v_vat_percent := COALESCE((v_billing->>'vat_percent')::numeric, 14);
  v_vat := ROUND(v_expected_subtotal * v_vat_percent / 100.0);

  SELECT * INTO v_zone FROM public.resolve_zone(v_addr.lat, v_addr.lng);
  v_travel_fee := COALESCE(v_zone.travel_fee, 0);

  IF NEW.promo_code_id IS NULL THEN
    v_discount := 0;
    IF NOT v_rpc_insert AND NEW.price_discount IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'BOOKING_INVALID_PROMO: A discount requires a valid promo code.' USING ERRCODE = '23514';
    END IF;
    NEW.promo_code := NULL;
    NEW.promo_discount_type := NULL;
    NEW.promo_discount_value := NULL;
    NEW.promo_description_en := NULL;
    NEW.promo_description_ar := NULL;
  ELSE
    SELECT * INTO v_promo FROM public.promo_codes WHERE id = NEW.promo_code_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BOOKING_INVALID_PROMO: Selected promo code no longer exists.' USING ERRCODE = '23514';
    END IF;
    IF NOT v_promo.is_active THEN
      RAISE EXCEPTION 'BOOKING_INVALID_PROMO: This promo code is no longer active.' USING ERRCODE = '23514';
    END IF;
    IF v_promo.starts_at IS NOT NULL AND now() < v_promo.starts_at THEN
      RAISE EXCEPTION 'BOOKING_INVALID_PROMO: This promo code is not active yet.' USING ERRCODE = '23514';
    END IF;
    IF v_promo.expires_at IS NOT NULL AND now() > v_promo.expires_at THEN
      RAISE EXCEPTION 'BOOKING_INVALID_PROMO: This promo code has expired.' USING ERRCODE = '23514';
    END IF;
    IF v_promo.total_usage_limit IS NOT NULL AND v_promo.usage_count >= v_promo.total_usage_limit THEN
      RAISE EXCEPTION 'BOOKING_INVALID_PROMO: This promo code has reached its usage limit.' USING ERRCODE = '23514';
    END IF;
    IF v_expected_subtotal < v_promo.minimum_booking_amount THEN
      RAISE EXCEPTION 'BOOKING_INVALID_PROMO: Booking does not meet promo minimum amount.' USING ERRCODE = '23514';
    END IF;
    IF v_promo.usage_limit_per_customer IS NOT NULL THEN
      SELECT count(*) INTO v_used_by_customer FROM public.promo_code_redemptions
        WHERE promo_code_id = v_promo.id AND customer_id = NEW.customer_id;
      IF v_used_by_customer >= v_promo.usage_limit_per_customer THEN
        RAISE EXCEPTION 'BOOKING_INVALID_PROMO: Promo customer usage limit reached.' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF v_promo.first_booking_only AND EXISTS (SELECT 1 FROM public.bookings WHERE customer_id = NEW.customer_id) THEN
      RAISE EXCEPTION 'BOOKING_INVALID_PROMO: Promo is first-booking only.' USING ERRCODE = '23514';
    END IF;
    IF v_promo.applicable_scope = 'services' THEN
      IF NOT EXISTS (SELECT 1 FROM public.promo_code_services WHERE promo_code_id = v_promo.id AND service_id = NEW.service_id) THEN
        RAISE EXCEPTION 'BOOKING_INVALID_PROMO: Promo does not apply to this service.' USING ERRCODE = '23514';
      END IF;
    ELSIF v_promo.applicable_scope = 'categories' THEN
      IF NOT EXISTS (SELECT 1 FROM public.promo_code_categories WHERE promo_code_id = v_promo.id AND category_id = v_service.category_id) THEN
        RAISE EXCEPTION 'BOOKING_INVALID_PROMO: Promo does not apply to this service.' USING ERRCODE = '23514';
      END IF;
    END IF;
    v_discount := CASE v_promo.discount_type
      WHEN 'fixed' THEN v_promo.discount_value
      ELSE ROUND(v_expected_subtotal * v_promo.discount_value / 100.0, 2)
    END;
    IF v_promo.maximum_discount IS NOT NULL THEN
      v_discount := LEAST(v_discount, v_promo.maximum_discount);
    END IF;
    v_discount := GREATEST(LEAST(v_discount, v_expected_subtotal), 0);
    IF NOT v_rpc_insert AND ABS(NEW.price_discount - v_discount) > 0.01 THEN
      RAISE EXCEPTION 'BOOKING_INVALID_PROMO: Promo discount does not match current terms.' USING ERRCODE = '23514';
    END IF;
    UPDATE public.promo_codes SET usage_count = usage_count + 1 WHERE id = v_promo.id;
    NEW.promo_code := v_promo.code;
    NEW.promo_discount_type := v_promo.discount_type;
    NEW.promo_discount_value := v_promo.discount_value;
    NEW.promo_description_en := v_promo.description_en;
    NEW.promo_description_ar := v_promo.description_ar;
  END IF;

  v_expected_total := GREATEST(
    v_expected_subtotal + v_platform_fee + v_vat + v_extras_total + v_travel_fee - v_discount,
    0
  );

  IF v_rpc_insert THEN
    NEW.price_subtotal := v_expected_subtotal;
    NEW.price_discount := v_discount;
    NEW.price_total := v_expected_total;
  ELSIF ABS(NEW.price_total - v_expected_total) > 0.01 THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Booking total does not match current price components.' USING ERRCODE = '23514';
  END IF;

  NEW.price_platform_fee := v_platform_fee;
  NEW.price_vat := v_vat;
  NEW.price_extras_total := v_extras_total;
  NEW.price_travel_fee := v_travel_fee;

  -- Famy commission snapshot (Issue #91), preserved from 20261001121000.
  -- For tutoring, v_expected_subtotal is the capability session_price.
  -- Commission base = provider service price: subtotal + provider-fulfilled extras.
  -- Platform fee, VAT and discount are never part of the provider base.
  -- Travel fee goes to the provider in full and is not commissioned.
  -- When settings.billing.commission_percent is null, all three snapshot columns stay NULL.
  v_commission_percent := (v_billing->>'commission_percent')::numeric;
  IF v_commission_percent IS NULL THEN
    NEW.price_commission_percent := NULL;
    NEW.price_commission_amount := NULL;
    NEW.price_provider_net := NULL;
  ELSE
    v_commission_base := v_expected_subtotal + v_extras_total;
    NEW.price_commission_percent := v_commission_percent;
    NEW.price_commission_amount := ROUND(v_commission_base * v_commission_percent / 100.0, 2);
    NEW.price_provider_net := v_commission_base + v_travel_fee - NEW.price_commission_amount;
  END IF;

  BEGIN
    PERFORM public.check_booking_slot(NEW.provider_id, NEW.start_at, NEW.end_at, NULL);
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'BOOKING_SLOT_UNAVAILABLE: That time slot is no longer available.' USING ERRCODE = '23514';
  END;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_validate_booking_service() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. create_booking — current main body + tutoring snapshot args
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.booking_request_fingerprint(uuid, uuid, uuid, timestamptz, timestamptz, uuid, text, uuid, jsonb);

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
  p_teaching_level_code text DEFAULT NULL
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|', p_provider_id::text, p_service_id::text, p_address_id::text,
    p_start_at::text, p_end_at::text, coalesce(p_family_member_id::text, ''),
    coalesce(p_notes, ''), coalesce(p_promo_code_id::text, ''),
    coalesce(p_requirement_selections::text, '[]'),
    coalesce(p_teaching_capability_id::text, ''),
    coalesce(p_teaching_subject_code, ''),
    coalesce(p_teaching_curriculum_code, ''),
    coalesce(p_teaching_level_code, ''));
$$;
REVOKE ALL ON FUNCTION public.booking_request_fingerprint(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, text, uuid, jsonb, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.create_booking(uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb);

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
  p_teaching_level_code text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_fingerprint text;
  v_existing RECORD;
  v_booking_id uuid;
  v_created boolean := false;
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

  v_fingerprint := public.booking_request_fingerprint(
    p_provider_id, p_service_id, p_address_id, p_start_at, p_end_at,
    p_family_member_id, p_notes, p_promo_code_id, coalesce(p_requirement_selections, '[]'::jsonb),
    p_teaching_capability_id, p_teaching_subject_code, p_teaching_curriculum_code, p_teaching_level_code
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
      teaching_capability_id, teaching_subject_code, teaching_curriculum_code, teaching_level_code
    ) VALUES (
      v_uid, p_provider_id, p_service_id, p_address_id,
      p_start_at, p_end_at, 'pending', NULLIF(btrim(p_notes), ''), p_family_member_id,
      coalesce(p_requirement_selections, '[]'::jsonb), p_promo_code_id,
      0, 0, 0, 0, 0, 0, 0,
      p_idempotency_key, v_fingerprint, 'EGP',
      p_teaching_capability_id, NULLIF(btrim(p_teaching_subject_code), ''),
      NULLIF(btrim(p_teaching_curriculum_code), ''), NULLIF(btrim(p_teaching_level_code), '')
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
REVOKE ALL ON FUNCTION public.create_booking(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,text,uuid,jsonb,uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,text,uuid,jsonb,uuid,text,text,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
