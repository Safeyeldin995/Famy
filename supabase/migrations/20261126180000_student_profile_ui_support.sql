-- Student learning profile, PR 2 (issue #536)
--
-- 1. Egyptian systems: the KG grade reads «كي جي» in Arabic (was "KG").
-- 2. Guests can read the teaching catalog. The read policies call has_role(),
--    which anon cannot execute, so every anon read of teaching_curricula,
--    teaching_levels and teaching_subjects failed with "permission denied".
--    Split each read policy: anon sees active rows only; signed-in users keep
--    the existing rule (active rows, or every row for admins).

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
    IF v_n = 0 THEN RETURN CASE WHEN v_ar THEN 'كي جي' ELSE 'KG' END; END IF;
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

DROP POLICY IF EXISTS teaching_curricula_read ON public.teaching_curricula;
DROP POLICY IF EXISTS teaching_curricula_read_anon ON public.teaching_curricula;
DROP POLICY IF EXISTS teaching_curricula_read_auth ON public.teaching_curricula;
CREATE POLICY teaching_curricula_read_anon ON public.teaching_curricula
  FOR SELECT TO anon USING (is_active);
CREATE POLICY teaching_curricula_read_auth ON public.teaching_curricula
  FOR SELECT TO authenticated
  USING (is_active OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS teaching_levels_read ON public.teaching_levels;
DROP POLICY IF EXISTS teaching_levels_read_anon ON public.teaching_levels;
DROP POLICY IF EXISTS teaching_levels_read_auth ON public.teaching_levels;
CREATE POLICY teaching_levels_read_anon ON public.teaching_levels
  FOR SELECT TO anon USING (is_active);
CREATE POLICY teaching_levels_read_auth ON public.teaching_levels
  FOR SELECT TO authenticated
  USING (is_active OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS teaching_subjects_read ON public.teaching_subjects;
DROP POLICY IF EXISTS teaching_subjects_read_anon ON public.teaching_subjects;
DROP POLICY IF EXISTS teaching_subjects_read_auth ON public.teaching_subjects;
CREATE POLICY teaching_subjects_read_anon ON public.teaching_subjects
  FOR SELECT TO anon USING (is_active);
CREATE POLICY teaching_subjects_read_auth ON public.teaching_subjects
  FOR SELECT TO authenticated
  USING (is_active OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
