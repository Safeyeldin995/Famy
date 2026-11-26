-- Student learning profile, PR 1 of issue #536: database + shared logic.
--
-- PO decisions:
--   * each child (family_members) and the student themself (customer_education_profiles)
--     keeps an education system + grade; there is no subjects list in the profile;
--   * the student picks a subject and sees ONLY tutors who teach that subject for that
--     system and grade (strict match, match_tutors_for_student);
--   * Quran / music match on subject + a skill level picked at booking time;
--   * the grade moves up automatically on 1 September and the parent confirms it;
--   * no match => «بلغني لما يبقى فيه مدرس» records the demand (tutor_demand_requests).
--
-- Everything here is additive. Existing profiles keep their system and grade.

-- ---------------------------------------------------------------------------
-- 1. Catalog: Azhar system + how each system writes its grades
-- ---------------------------------------------------------------------------
ALTER TABLE public.teaching_curricula
  ADD COLUMN IF NOT EXISTS level_label_style text NOT NULL DEFAULT 'plain';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'teaching_curricula_level_label_style_check'
       AND conrelid = 'public.teaching_curricula'::regclass
  ) THEN
    ALTER TABLE public.teaching_curricula
      ADD CONSTRAINT teaching_curricula_level_label_style_check
      CHECK (level_label_style IN ('eg', 'british_year', 'american_grade', 'ib_programme', 'plain'));
  END IF;
END
$$;

INSERT INTO public.teaching_curricula (code, name_en, name_ar, sort_order, level_label_style)
VALUES ('eg_azhar', 'Egyptian Azhar', 'المنهج الأزهري', 3, 'eg')
ON CONFLICT (code) DO UPDATE SET level_label_style = EXCLUDED.level_label_style;

UPDATE public.teaching_curricula SET
  level_label_style = CASE code
    WHEN 'eg_national_ar' THEN 'eg'
    WHEN 'eg_national_lang' THEN 'eg'
    WHEN 'eg_azhar' THEN 'eg'
    WHEN 'british' THEN 'british_year'
    WHEN 'american' THEN 'american_grade'
    WHEN 'ib' THEN 'ib_programme'
    ELSE 'plain'
  END,
  sort_order = CASE code
    WHEN 'eg_national_ar' THEN 1
    WHEN 'eg_national_lang' THEN 2
    WHEN 'eg_azhar' THEN 3
    WHEN 'british' THEN 4
    WHEN 'american' THEN 5
    WHEN 'ib' THEN 6
    WHEN 'french' THEN 7
    WHEN 'german' THEN 8
    ELSE sort_order
  END;

-- Mirrors src/lib/tutoring/teachingLevelLabels.ts (teachingLevelLabel).
CREATE OR REPLACE FUNCTION public.teaching_level_label(
  p_level_code text,
  p_style text,
  p_lang text,
  p_fallback text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_n int;
  v_ar boolean := COALESCE(p_lang, 'ar') <> 'en';
  v_grade text;
BEGIN
  IF p_level_code = 'kg' THEN
    v_n := 0;
  ELSIF p_level_code ~ '^g([1-9]|1[0-2])$' THEN
    v_n := substr(p_level_code, 2)::int;
  ELSE
    RETURN COALESCE(p_fallback, p_level_code, '');
  END IF;

  IF p_style = 'eg' THEN
    IF v_n = 0 THEN RETURN 'KG'; END IF;
    IF v_n <= 6 THEN RETURN CASE WHEN v_ar THEN v_n || ' ابتدائي' ELSE 'Primary ' || v_n END; END IF;
    IF v_n <= 9 THEN RETURN CASE WHEN v_ar THEN (v_n - 6) || ' إعدادي' ELSE 'Prep ' || (v_n - 6) END; END IF;
    RETURN CASE WHEN v_ar THEN (v_n - 9) || ' ثانوي' ELSE 'Secondary ' || (v_n - 9) END;
  ELSIF p_style = 'british_year' THEN
    -- Year 1 = KG, Year 2 = grade 1 (the usual mapping in Egyptian British schools).
    RETURN 'Year ' || (v_n + 1);
  ELSIF p_style = 'american_grade' THEN
    RETURN CASE WHEN v_n = 0 THEN 'KG' ELSE 'Grade ' || v_n END;
  ELSIF p_style = 'ib_programme' THEN
    v_grade := CASE WHEN v_n = 0 THEN 'KG' ELSE 'Grade ' || v_n END;
    IF v_n <= 5 THEN RETURN 'PYP · ' || v_grade; END IF;
    IF v_n <= 10 THEN RETURN 'MYP · ' || v_grade; END IF;
    RETURN 'DP · ' || v_grade;
  END IF;
  RETURN COALESCE(p_fallback, p_level_code, '');
END;
$$;

GRANT EXECUTE ON FUNCTION public.teaching_level_label(text, text, text, text) TO anon, authenticated, service_role;

-- School year that starts on 1 September, in Cairo time (Nov 2026 -> 2026, May 2027 -> 2026).
CREATE OR REPLACE FUNCTION public.current_school_year(p_at timestamptz DEFAULT now())
RETURNS int
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN extract(month FROM (p_at AT TIME ZONE 'Africa/Cairo')) >= 9
      THEN extract(year FROM (p_at AT TIME ZONE 'Africa/Cairo'))::int
    ELSE extract(year FROM (p_at AT TIME ZONE 'Africa/Cairo'))::int - 1
  END;
$$;

GRANT EXECUTE ON FUNCTION public.current_school_year(timestamptz) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Grade confirmation per school year
-- ---------------------------------------------------------------------------
ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS grade_confirmed_for_year int;
ALTER TABLE public.customer_education_profiles
  ADD COLUMN IF NOT EXISTS grade_confirmed_for_year int;

-- Existing grades count as confirmed for the current school year, so the first
-- 1 September run does not send «صح؟» about grades parents set this year.
UPDATE public.family_members
   SET grade_confirmed_for_year = public.current_school_year()
 WHERE education_level_id IS NOT NULL
   AND grade_confirmed_for_year IS NULL;
UPDATE public.customer_education_profiles
   SET grade_confirmed_for_year = public.current_school_year()
 WHERE education_level_id IS NOT NULL
   AND grade_confirmed_for_year IS NULL;

-- Any grade or system the owner sets counts as confirmed for the current school year.
-- The yearly advance sets app.grade_advance = 'on' so its own update stays unconfirmed.
CREATE OR REPLACE FUNCTION public.tg_education_grade_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('app.grade_advance', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.education_level_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT'
     OR NEW.education_level_id IS DISTINCT FROM OLD.education_level_id
     OR NEW.education_curriculum_id IS DISTINCT FROM OLD.education_curriculum_id THEN
    NEW.grade_confirmed_for_year := public.current_school_year();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_education_grade_confirmed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_family_member_grade_confirmed ON public.family_members;
CREATE TRIGGER trg_family_member_grade_confirmed
  BEFORE INSERT OR UPDATE OF education_level_id, education_curriculum_id ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_education_grade_confirmed();

DROP TRIGGER IF EXISTS trg_customer_education_grade_confirmed ON public.customer_education_profiles;
CREATE TRIGGER trg_customer_education_grade_confirmed
  BEFORE INSERT OR UPDATE OF education_level_id, education_curriculum_id ON public.customer_education_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_education_grade_confirmed();

-- The owner answers «صح؟» with «تمام»: the grade is confirmed for this school year.
-- p_family_member_id NULL = the signed-in student's own profile.
CREATE OR REPLACE FUNCTION public.confirm_student_grade(p_family_member_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required.' USING ERRCODE = '42501';
  END IF;

  IF p_family_member_id IS NOT NULL THEN
    UPDATE public.family_members
       SET grade_confirmed_for_year = public.current_school_year()
     WHERE id = p_family_member_id
       AND customer_id = v_uid
       AND education_level_id IS NOT NULL;
  ELSE
    UPDATE public.customer_education_profiles
       SET grade_confirmed_for_year = public.current_school_year()
     WHERE customer_id = v_uid
       AND education_level_id IS NOT NULL;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STUDENT_PROFILE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_student_grade(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_student_grade(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Yearly grade advance (1 September, 03:00 Cairo)
-- ---------------------------------------------------------------------------
-- The year the advance last ran. Seeded with the current school year so a manual run
-- now does nothing; the first real advance is on 1 September of the next school year.
INSERT INTO public.settings (key, value)
VALUES (
  'student_grade_advance',
  jsonb_build_object('last_advanced_year', public.current_school_year(), 'ran_at', NULL)
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.advance_student_grades()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year int := public.current_school_year();
  v_last int;
  v_members int := 0;
  v_self int := 0;
  r record;
  v_next_code text;
  v_next_id uuid;
  v_label_ar text;
  v_label_en text;
  v_name text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('famy.advance_student_grades'));

  SELECT NULLIF(value ->> 'last_advanced_year', '')::int INTO v_last
    FROM public.settings WHERE key = 'student_grade_advance';
  IF v_last IS NOT NULL AND v_last >= v_year THEN
    RETURN jsonb_build_object('status', 'already_done', 'school_year', v_year, 'last_advanced_year', v_last);
  END IF;

  PERFORM set_config('app.grade_advance', 'on', true);

  -- Children
  FOR r IN
    SELECT fm.id, fm.customer_id, fm.full_name, l.code AS level_code, c.level_label_style AS style
      FROM public.family_members fm
      JOIN public.teaching_levels l ON l.id = fm.education_level_id
      LEFT JOIN public.teaching_curricula c ON c.id = fm.education_curriculum_id
     WHERE fm.is_active
       AND l.code IN ('kg', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9', 'g10', 'g11')
       AND COALESCE(fm.grade_confirmed_for_year, 0) < v_year
     FOR UPDATE OF fm
  LOOP
    v_next_code := CASE r.level_code WHEN 'kg' THEN 'g1' ELSE 'g' || (substr(r.level_code, 2)::int + 1) END;
    SELECT id INTO v_next_id FROM public.teaching_levels WHERE code = v_next_code AND is_active;
    CONTINUE WHEN v_next_id IS NULL;

    UPDATE public.family_members SET education_level_id = v_next_id WHERE id = r.id;

    v_label_ar := public.teaching_level_label(v_next_code, r.style, 'ar');
    v_label_en := public.teaching_level_label(v_next_code, r.style, 'en');
    v_name := COALESCE(NULLIF(btrim(r.full_name), ''), 'ابنك');
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      r.customer_id, 'student_grade_advanced', 'system',
      'New school year',
      COALESCE(NULLIF(btrim(r.full_name), ''), 'Your child') || ' is now in ' || v_label_en || '. Is that right?',
      'New school year', 'سنة دراسية جديدة',
      COALESCE(NULLIF(btrim(r.full_name), ''), 'Your child') || ' is now in ' || v_label_en || '. Is that right?',
      v_name || ' بقى في ' || v_label_ar || '، صح؟',
      jsonb_build_object('family_member_id', r.id, 'level_code', v_next_code, 'school_year', v_year),
      '/account/students?confirm=' || r.id
    );
    v_members := v_members + 1;
  END LOOP;

  -- Students who signed up for themselves
  FOR r IN
    SELECT cep.customer_id, pr.full_name, l.code AS level_code, c.level_label_style AS style
      FROM public.customer_education_profiles cep
      JOIN public.teaching_levels l ON l.id = cep.education_level_id
      LEFT JOIN public.teaching_curricula c ON c.id = cep.education_curriculum_id
      LEFT JOIN public.profiles pr ON pr.id = cep.customer_id
     WHERE l.code IN ('kg', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9', 'g10', 'g11')
       AND COALESCE(cep.grade_confirmed_for_year, 0) < v_year
     FOR UPDATE OF cep
  LOOP
    v_next_code := CASE r.level_code WHEN 'kg' THEN 'g1' ELSE 'g' || (substr(r.level_code, 2)::int + 1) END;
    SELECT id INTO v_next_id FROM public.teaching_levels WHERE code = v_next_code AND is_active;
    CONTINUE WHEN v_next_id IS NULL;

    UPDATE public.customer_education_profiles SET education_level_id = v_next_id WHERE customer_id = r.customer_id;

    v_label_ar := public.teaching_level_label(v_next_code, r.style, 'ar');
    v_label_en := public.teaching_level_label(v_next_code, r.style, 'en');
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      r.customer_id, 'student_grade_advanced', 'system',
      'New school year',
      'You are now in ' || v_label_en || '. Is that right?',
      'New school year', 'سنة دراسية جديدة',
      'You are now in ' || v_label_en || '. Is that right?',
      'بقيت في ' || v_label_ar || '، صح؟',
      jsonb_build_object('family_member_id', NULL, 'level_code', v_next_code, 'school_year', v_year),
      '/account/students?confirm=self'
    );
    v_self := v_self + 1;
  END LOOP;

  PERFORM set_config('app.grade_advance', 'off', true);

  INSERT INTO public.settings (key, value, updated_at)
  VALUES (
    'student_grade_advance',
    jsonb_build_object('last_advanced_year', v_year, 'ran_at', now(), 'children', v_members, 'students', v_self),
    now()
  )
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

  INSERT INTO public.audit_logs (actor_id, actor_role, action, entity, diff, reason)
  VALUES (
    auth.uid(), 'system', 'student_grades_advanced', 'settings',
    jsonb_build_object('school_year', v_year, 'children', v_members, 'students', v_self),
    'Yearly school grade advance'
  );

  RETURN jsonb_build_object('status', 'advanced', 'school_year', v_year, 'children', v_members, 'students', v_self);
END;
$$;

REVOKE ALL ON FUNCTION public.advance_student_grades() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_student_grades() TO service_role;

-- Admin can run the advance by hand (same once-per-school-year guard).
CREATE OR REPLACE FUNCTION public.admin_run_student_grade_advance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  RETURN public.advance_student_grades();
END;
$$;

REVOKE ALL ON FUNCTION public.admin_run_student_grade_advance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_run_student_grade_advance() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. «بلغني لما يبقى فيه مدرس»: demand for tutors that don't exist yet
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tutor_demand_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  family_member_id uuid REFERENCES public.family_members(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES public.teaching_subjects(id) ON DELETE CASCADE,
  curriculum_id uuid REFERENCES public.teaching_curricula(id) ON DELETE CASCADE,
  level_id uuid REFERENCES public.teaching_levels(id) ON DELETE CASCADE,
  service_mode text NOT NULL DEFAULT 'online' CHECK (service_mode IN ('online', 'in_person')),
  governorate_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz
);

CREATE INDEX IF NOT EXISTS tutor_demand_requests_customer_idx
  ON public.tutor_demand_requests (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tutor_demand_requests_family_member_idx
  ON public.tutor_demand_requests (family_member_id);
CREATE INDEX IF NOT EXISTS tutor_demand_requests_subject_idx
  ON public.tutor_demand_requests (subject_id);
CREATE INDEX IF NOT EXISTS tutor_demand_requests_curriculum_idx
  ON public.tutor_demand_requests (curriculum_id);
CREATE INDEX IF NOT EXISTS tutor_demand_requests_level_idx
  ON public.tutor_demand_requests (level_id);
CREATE INDEX IF NOT EXISTS tutor_demand_requests_open_match_idx
  ON public.tutor_demand_requests (service_id, subject_id, curriculum_id, level_id)
  WHERE notified_at IS NULL;

ALTER TABLE public.tutor_demand_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tutor_demand_requests_owner_read ON public.tutor_demand_requests;
CREATE POLICY tutor_demand_requests_owner_read ON public.tutor_demand_requests
  FOR SELECT TO authenticated
  USING (customer_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tutor_demand_requests_admin_read ON public.tutor_demand_requests;
CREATE POLICY tutor_demand_requests_admin_read ON public.tutor_demand_requests
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));

-- Writes go through request_tutor_availability only.
REVOKE ALL ON public.tutor_demand_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tutor_demand_requests TO authenticated;

-- Records «بلغني». At most 10 a day per customer; the same open request is not stored twice.
CREATE OR REPLACE FUNCTION public.request_tutor_availability(
  p_service_id uuid,
  p_subject_id uuid DEFAULT NULL,
  p_curriculum_id uuid DEFAULT NULL,
  p_level_id uuid DEFAULT NULL,
  p_service_mode text DEFAULT 'online',
  p_family_member_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mode text := COALESCE(NULLIF(btrim(lower(p_service_mode)), ''), 'online');
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required.' USING ERRCODE = '42501';
  END IF;
  IF v_mode NOT IN ('online', 'in_person') THEN
    RAISE EXCEPTION 'DEMAND_INVALID_MODE' USING ERRCODE = '22023';
  END IF;
  IF p_service_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.services s WHERE s.id = p_service_id AND s.is_active) THEN
    RAISE EXCEPTION 'DEMAND_INVALID_SERVICE' USING ERRCODE = '22023';
  END IF;
  IF p_subject_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.teaching_subject_services tss
      JOIN public.teaching_subjects ts ON ts.id = tss.subject_id
     WHERE tss.subject_id = p_subject_id AND tss.service_id = p_service_id AND ts.is_active
  ) THEN
    RAISE EXCEPTION 'DEMAND_INVALID_SUBJECT' USING ERRCODE = '22023';
  END IF;
  IF p_curriculum_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.teaching_curricula c WHERE c.id = p_curriculum_id AND c.is_active
  ) THEN
    RAISE EXCEPTION 'DEMAND_INVALID_CURRICULUM' USING ERRCODE = '22023';
  END IF;
  IF p_level_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.teaching_levels l WHERE l.id = p_level_id AND l.is_active
  ) THEN
    RAISE EXCEPTION 'DEMAND_INVALID_LEVEL' USING ERRCODE = '22023';
  END IF;
  IF p_family_member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.family_members fm WHERE fm.id = p_family_member_id AND fm.customer_id = v_uid
  ) THEN
    RAISE EXCEPTION 'DEMAND_INVALID_STUDENT' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('famy.tutor_demand:' || v_uid::text));

  SELECT d.id INTO v_id
    FROM public.tutor_demand_requests d
   WHERE d.customer_id = v_uid
     AND d.notified_at IS NULL
     AND d.service_id = p_service_id
     AND d.subject_id IS NOT DISTINCT FROM p_subject_id
     AND d.curriculum_id IS NOT DISTINCT FROM p_curriculum_id
     AND d.level_id IS NOT DISTINCT FROM p_level_id
     AND d.service_mode = v_mode
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_requested', 'id', v_id);
  END IF;

  IF (
    SELECT count(*) FROM public.tutor_demand_requests d
     WHERE d.customer_id = v_uid AND d.created_at > now() - interval '24 hours'
  ) >= 10 THEN
    RAISE EXCEPTION 'DEMAND_RATE_LIMITED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.tutor_demand_requests (
    customer_id, family_member_id, service_id, subject_id, curriculum_id, level_id,
    service_mode, governorate_code
  )
  SELECT v_uid, p_family_member_id, p_service_id, p_subject_id, p_curriculum_id, p_level_id,
         v_mode, pr.governorate
    FROM (SELECT 1) one
    LEFT JOIN public.profiles pr ON pr.id = v_uid
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('status', 'recorded', 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.request_tutor_availability(uuid, uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_tutor_availability(uuid, uuid, uuid, uuid, text, uuid) TO authenticated;

-- What admin should recruit for: open demand grouped by service, subject, system, grade and mode.
CREATE OR REPLACE FUNCTION public.admin_tutor_demand_summary()
RETURNS TABLE (
  service_id uuid,
  service_name_ar text,
  service_name_en text,
  subject_id uuid,
  subject_name_ar text,
  subject_name_en text,
  curriculum_id uuid,
  curriculum_name_ar text,
  curriculum_name_en text,
  level_id uuid,
  level_code text,
  level_label_ar text,
  level_label_en text,
  service_mode text,
  open_requests bigint,
  customers bigint,
  last_requested_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT d.service_id, s.name_ar, s.name_en,
         d.subject_id, ts.name_ar, ts.name_en,
         d.curriculum_id, c.name_ar, c.name_en,
         d.level_id, l.code,
         public.teaching_level_label(l.code, c.level_label_style, 'ar', l.name_ar),
         public.teaching_level_label(l.code, c.level_label_style, 'en', l.name_en),
         d.service_mode,
         count(*)::bigint,
         count(DISTINCT d.customer_id)::bigint,
         max(d.created_at)
    FROM public.tutor_demand_requests d
    JOIN public.services s ON s.id = d.service_id
    LEFT JOIN public.teaching_subjects ts ON ts.id = d.subject_id
    LEFT JOIN public.teaching_curricula c ON c.id = d.curriculum_id
    LEFT JOIN public.teaching_levels l ON l.id = d.level_id
   WHERE d.notified_at IS NULL
   GROUP BY d.service_id, s.name_ar, s.name_en, d.subject_id, ts.name_ar, ts.name_en,
            d.curriculum_id, c.name_ar, c.name_en, c.level_label_style,
            d.level_id, l.code, l.name_ar, l.name_en, d.service_mode
   ORDER BY count(*) DESC, max(d.created_at) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_tutor_demand_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_tutor_demand_summary() TO authenticated;

-- When a tutor's capability is approved, waiting customers who asked for that exact
-- combination are told once.
CREATE OR REPLACE FUNCTION public.tg_notify_tutor_demand_on_capability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offering text;
  r record;
BEGIN
  IF NEW.status <> 'approved'
     OR (TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'approved') THEN
    RETURN NEW;
  END IF;

  SELECT p.offering_mode INTO v_offering
    FROM public.providers p
   WHERE p.id = NEW.provider_id AND p.onboarding_status = 'APPROVED';
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  FOR r IN
    UPDATE public.tutor_demand_requests d
       SET notified_at = now()
     WHERE d.notified_at IS NULL
       AND d.service_id = NEW.service_id
       AND (d.subject_id IS NULL OR d.subject_id = NEW.subject_id)
       AND (d.curriculum_id IS NULL OR d.curriculum_id = NEW.curriculum_id)
       AND (d.level_id IS NULL OR d.level_id = NEW.level_id)
       AND (
         (d.service_mode = 'online' AND COALESCE(v_offering, 'in_person') IN ('online', 'both'))
         OR (d.service_mode = 'in_person' AND COALESCE(v_offering, 'in_person') IN ('in_person', 'both'))
       )
    RETURNING d.id, d.customer_id, d.service_mode, d.subject_id
  LOOP
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      r.customer_id, 'tutor_demand_available', 'system',
      'A tutor is available',
      'A tutor who matches your request just joined. Book a lesson now.',
      'A tutor is available', 'فيه مدرس متاح دلوقتي',
      'A tutor who matches your request just joined. Book a lesson now.',
      'فيه مدرس مناسب لطلبك انضم دلوقتي، احجز درسك',
      jsonb_build_object(
        'demand_request_id', r.id,
        'service_id', NEW.service_id,
        'subject_id', r.subject_id,
        'provider_id', NEW.provider_id,
        'service_mode', r.service_mode
      ),
      CASE WHEN r.service_mode = 'online' THEN '/online/tutors' ELSE '/category/tutoring' END
    );
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_notify_tutor_demand_on_capability() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_tutor_demand_on_capability ON public.provider_teaching_capabilities;
CREATE TRIGGER trg_notify_tutor_demand_on_capability
  AFTER INSERT OR UPDATE OF status ON public.provider_teaching_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_tutor_demand_on_capability();

-- ---------------------------------------------------------------------------
-- 5. Strict tutor matching
-- ---------------------------------------------------------------------------
-- Tutors with an approved capability on exactly this service (+ subject / system / grade
-- when given) who can be booked in this mode. Callers pass, per service kind:
--   school: subject + system + grade; homework: system + grade (any subject);
--   Quran / music: subject + skill level (no system).
-- Public card data only (ids, price, duration), so guests can use it too.
CREATE OR REPLACE FUNCTION public.match_tutors_for_student(
  p_service_id uuid,
  p_subject_id uuid DEFAULT NULL,
  p_curriculum_id uuid DEFAULT NULL,
  p_level_id uuid DEFAULT NULL,
  p_service_mode text DEFAULT 'online',
  p_address_id uuid DEFAULT NULL
)
RETURNS TABLE (
  provider_id uuid,
  capability_id uuid,
  subject_id uuid,
  curriculum_id uuid,
  level_id uuid,
  session_duration_min int,
  session_price numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text := COALESCE(NULLIF(btrim(lower(p_service_mode)), ''), 'online');
BEGIN
  IF p_service_id IS NULL THEN
    RETURN;
  END IF;
  IF v_mode NOT IN ('online', 'in_person') THEN
    RAISE EXCEPTION 'MATCH_INVALID_MODE' USING ERRCODE = '22023';
  END IF;
  -- An address is only used for in-person coverage, and only the owner's own address.
  IF p_address_id IS NOT NULL AND (
    auth.uid() IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.addresses a WHERE a.id = p_address_id AND a.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'MATCH_INVALID_ADDRESS' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (c.provider_id)
         c.provider_id,
         c.id,
         c.subject_id,
         c.curriculum_id,
         c.level_id,
         c.session_duration_min,
         CASE WHEN v_mode = 'online'
           THEN COALESCE(c.online_session_price, c.session_price::numeric)
           ELSE c.session_price::numeric
         END AS session_price
    FROM public.provider_teaching_capabilities c
   WHERE c.service_id = p_service_id
     AND c.status = 'approved'
     AND (p_subject_id IS NULL OR c.subject_id = p_subject_id)
     AND (p_curriculum_id IS NULL OR c.curriculum_id = p_curriculum_id)
     AND (p_level_id IS NULL OR c.level_id = p_level_id)
     AND NOT public.provider_cash_debt_blocked_core(c.provider_id)
     AND EXISTS (
       SELECT 1
         FROM public.marketplace_eligibility_internal(c.provider_id, p_service_id, p_address_id, v_mode) e
        WHERE e.is_eligible
     )
   ORDER BY c.provider_id, session_price ASC, c.session_duration_min ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.match_tutors_for_student(uuid, uuid, uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_tutors_for_student(uuid, uuid, uuid, uuid, text, uuid)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Admin queue: «مدرسين بيانات ناقصة»
--    Approved tutors with an approved tutoring service but no approved
--    subject / system / grade for it, so students can't find them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_tutors_missing_teaching_data_ids()
RETURNS TABLE (provider_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT p.id
    FROM public.providers p
    JOIN public.provider_services ps ON ps.provider_id = p.id AND ps.status = 'approved'
   WHERE p.onboarding_status = 'APPROVED'
     AND EXISTS (
       SELECT 1 FROM public.teaching_subject_services tss WHERE tss.service_id = ps.service_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.provider_teaching_capabilities c
        WHERE c.provider_id = p.id AND c.service_id = ps.service_id AND c.status = 'approved'
     )
     AND p.id IN (SELECT identity.provider_id FROM public.admin_provider_identity_ids() identity);
$$;

REVOKE ALL ON FUNCTION public.admin_tutors_missing_teaching_data_ids() FROM PUBLIC, anon, authenticated;

-- Re-derived from 20261125190000_admin_audit_batch.sql (latest), plus tutors_missing_teaching_data.
CREATE OR REPLACE FUNCTION public.admin_work_queue_counts()
RETURNS TABLE(queue text, item_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutoff timestamptz;
  v_sla_hours integer;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT s.completion_auto_from INTO v_cutoff
  FROM public.booking_expiry_settings() s;
  v_sla_hours := public.provider_review_sla_hours();

  RETURN QUERY
  SELECT 'new_applications'::text, count(*) FROM public.providers p
    WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND p.resubmitted_at IS NULL
      AND p.id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'resubmitted_applications'::text, count(*) FROM public.providers p
    WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND p.resubmitted_at IS NOT NULL
      AND p.id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'applications_over_sla'::text, count(*) FROM public.providers p
    WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW')
      AND COALESCE(p.resubmitted_at, p.submitted_at, p.created_at) < now() - (v_sla_hours || ' hours')::interval
      AND p.id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'new_service_requests'::text, count(*) FROM public.provider_services ps
    JOIN public.providers p ON p.id = ps.provider_id
    WHERE ps.status = 'pending' AND p.onboarding_status = 'APPROVED'
      AND ps.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'price_change_requests'::text, count(*) FROM public.provider_services ps
    WHERE ps.status = 'approved'
      AND (
        ps.pending_price_override IS NOT NULL
        OR ps.pending_online_price_override IS NOT NULL
      )
      AND ps.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'pending_services'::text, count(*) FROM public.provider_services ps
    WHERE ps.status = 'pending'
      AND ps.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'pending_teaching_groups'::text, count(*) FROM (
    SELECT 1 FROM public.provider_teaching_capabilities c WHERE c.status = 'pending'
      AND c.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
    GROUP BY c.provider_id, c.service_id, c.subject_id, c.curriculum_id,
      c.session_duration_min, c.session_price
  ) groups_pending
  UNION ALL
  SELECT 'pending_documents'::text, count(*) FROM public.provider_documents d
    WHERE d.status = 'pending'
      AND d.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'documents_expiring_soon'::text, count(*) FROM public.provider_documents d
    WHERE d.status = 'approved'
      AND d.expires_at IS NOT NULL
      AND d.expires_at <= now() + interval '30 days'
      AND d.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'open_cases'::text,
    (SELECT count(*) FROM public.disputes d WHERE d.status IN ('open', 'info_requested'))
    + (SELECT count(*) FROM public.support_tickets s WHERE s.status IN ('open', 'pending'))
  UNION ALL
  SELECT 'bookings_needing_action'::text,
    (SELECT count(*) FROM public.bookings b WHERE b.status IN ('disputed', 'no_show'))
    + (SELECT count(*) FROM public.online_session_admin_reviews rc WHERE rc.status = 'open')
  UNION ALL
  SELECT 'online_lesson_issue_reports'::text,
    (SELECT count(*) FROM public.online_lesson_issue_reports r WHERE r.status = 'open')
  UNION ALL
  SELECT 'ugc_reports'::text,
    (SELECT count(*) FROM public.ugc_reports u WHERE u.status = 'open')
  UNION ALL
  SELECT 'payments_pending_review'::text, count(*) FROM public.payments pay
    WHERE pay.status = 'pending_review'
  UNION ALL
  SELECT 'bookings_lifecycle_attention'::text, count(*) FROM public.bookings b
    WHERE
      (b.status = 'confirmed' AND b.end_at < now())
      OR (b.status = 'arrived' AND b.status_changed_at < now() - interval '30 minutes')
      OR (b.status = 'completion_requested'
          AND b.completion_requested_at IS NOT NULL
          AND b.completion_requested_at < v_cutoff
          AND b.completion_requested_at < now() - interval '12 hours')
      OR (b.status = 'in_progress' AND now() > b.start_at + (b.end_at - b.start_at) + interval '2 hours')
  UNION ALL
  SELECT 'pending_settlements'::text,
    (SELECT count(*) FROM public.provider_settlements s WHERE s.status = 'pending')
  UNION ALL
  SELECT 'providers_at_cash_limit'::text,
    (
      SELECT count(*)
      FROM public.providers p
      WHERE p.onboarding_status = 'APPROVED'
        AND public.provider_cash_debt_blocked(p.id)
        AND p.id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
    )
  UNION ALL
  SELECT 'tutors_missing_teaching_data'::text,
    (SELECT count(*) FROM public.admin_tutors_missing_teaching_data_ids());
END;
$$;

REVOKE ALL ON FUNCTION public.admin_work_queue_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_work_queue_counts() TO authenticated;

-- Re-derived from 20261126100000_online_nationwide_waitlist.sql (latest), plus the
-- tutors_missing_teaching_data list so the badge and the list it opens agree.
CREATE OR REPLACE FUNCTION public.admin_work_queue_provider_ids(p_queue text)
RETURNS TABLE(provider_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_queue = 'new_applications' THEN
    RETURN QUERY SELECT p.id FROM public.providers p
      WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND p.resubmitted_at IS NULL
        AND p.id IN (SELECT identity.provider_id FROM public.admin_provider_identity_ids() identity);
  ELSIF p_queue = 'resubmitted_applications' THEN
    RETURN QUERY SELECT p.id FROM public.providers p
      WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND p.resubmitted_at IS NOT NULL
        AND p.id IN (SELECT identity.provider_id FROM public.admin_provider_identity_ids() identity);
  ELSIF p_queue = 'applications_over_sla' THEN
    RETURN QUERY SELECT p.id FROM public.providers p
      WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW')
        AND COALESCE(p.resubmitted_at, p.submitted_at, p.created_at)
          < now() - (public.provider_review_sla_hours() || ' hours')::interval
        AND p.id IN (SELECT identity.provider_id FROM public.admin_provider_identity_ids() identity);
  ELSIF p_queue = 'new_service_requests' THEN
    RETURN QUERY SELECT DISTINCT ps.provider_id FROM public.provider_services ps
      JOIN public.providers p ON p.id = ps.provider_id
      WHERE ps.status = 'pending' AND p.onboarding_status = 'APPROVED'
        AND ps.provider_id IN (SELECT identity.provider_id FROM public.admin_provider_identity_ids() identity);
  ELSIF p_queue = 'price_change_requests' THEN
    RETURN QUERY SELECT DISTINCT ps.provider_id FROM public.provider_services ps
      WHERE ps.status = 'approved'
        AND (ps.pending_price_override IS NOT NULL OR ps.pending_online_price_override IS NOT NULL)
        AND ps.provider_id IN (SELECT identity.provider_id FROM public.admin_provider_identity_ids() identity);
  ELSIF p_queue = 'pending_services' THEN
    RETURN QUERY SELECT DISTINCT ps.provider_id FROM public.provider_services ps
      WHERE ps.status = 'pending'
        AND ps.provider_id IN (SELECT identity.provider_id FROM public.admin_provider_identity_ids() identity);
  ELSIF p_queue = 'pending_teaching_groups' THEN
    RETURN QUERY SELECT DISTINCT c.provider_id FROM public.provider_teaching_capabilities c
      WHERE c.status = 'pending'
        AND c.provider_id IN (SELECT identity.provider_id FROM public.admin_provider_identity_ids() identity);
  ELSIF p_queue = 'pending_documents' THEN
    RETURN QUERY SELECT DISTINCT d.provider_id FROM public.provider_documents d
      WHERE d.status = 'pending'
        AND d.provider_id IN (SELECT identity.provider_id FROM public.admin_provider_identity_ids() identity);
  ELSIF p_queue = 'documents_expiring_soon' THEN
    RETURN QUERY SELECT DISTINCT d.provider_id FROM public.provider_documents d
      WHERE d.status = 'approved'
        AND d.expires_at IS NOT NULL
        AND d.expires_at <= now() + interval '30 days'
        AND d.provider_id IN (SELECT identity.provider_id FROM public.admin_provider_identity_ids() identity);
  ELSIF p_queue = 'tutors_missing_teaching_data' THEN
    RETURN QUERY SELECT m.provider_id FROM public.admin_tutors_missing_teaching_data_ids() m;
  ELSE
    RAISE EXCEPTION 'Unknown provider work queue.' USING ERRCODE = '23514';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_work_queue_provider_ids(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_work_queue_provider_ids(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Schedule: 1 September 00:00 UTC = 03:00 Cairo (summer time)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'famy-advance-student-grades') THEN
      PERFORM cron.unschedule('famy-advance-student-grades');
    END IF;
    PERFORM cron.schedule(
      'famy-advance-student-grades',
      '0 0 1 9 *',
      'SELECT public.advance_student_grades();'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE
      'pg_cron scheduling skipped (%); run advance_student_grades() on 1 September externally.',
      SQLERRM;
END
$$;

NOTIFY pgrst, 'reload schema';
