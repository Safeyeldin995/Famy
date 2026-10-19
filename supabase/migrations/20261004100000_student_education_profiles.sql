-- Student education profiles (Issue #109): saved curriculum/grade for the
-- customer and family members. Draft only — never apply to QA or Production.

-- ---------------------------------------------------------------------------
-- 1. Storage: family member columns + dedicated customer self row table.
-- customer_education_profiles mirrors family_members RLS (owner + admin) and
-- keeps education off public.profiles, which providers also use for identity.
-- ---------------------------------------------------------------------------

ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS education_curriculum_id uuid
    REFERENCES public.teaching_curricula(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS education_level_id uuid
    REFERENCES public.teaching_levels(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.customer_education_profiles (
  customer_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  education_curriculum_id uuid REFERENCES public.teaching_curricula(id) ON DELETE SET NULL,
  education_level_id uuid REFERENCES public.teaching_levels(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.tg_validate_education_profile_fields()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.education_curriculum_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.teaching_curricula c
    WHERE c.id = NEW.education_curriculum_id AND c.is_active
  ) THEN
    RAISE EXCEPTION 'Invalid or inactive curriculum.' USING ERRCODE = '23514';
  END IF;

  IF NEW.education_level_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.teaching_levels l
    WHERE l.id = NEW.education_level_id AND l.is_active
  ) THEN
    RAISE EXCEPTION 'Invalid or inactive level.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_family_member_education ON public.family_members;
CREATE TRIGGER trg_validate_family_member_education
  BEFORE INSERT OR UPDATE OF education_curriculum_id, education_level_id ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_education_profile_fields();

DROP TRIGGER IF EXISTS trg_validate_customer_education ON public.customer_education_profiles;
CREATE TRIGGER trg_validate_customer_education
  BEFORE INSERT OR UPDATE OF education_curriculum_id, education_level_id ON public.customer_education_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_education_profile_fields();

DROP TRIGGER IF EXISTS trg_customer_education_profiles_updated ON public.customer_education_profiles;
CREATE TRIGGER trg_customer_education_profiles_updated
  BEFORE UPDATE ON public.customer_education_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.customer_education_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_education_profiles_owner_all ON public.customer_education_profiles;
CREATE POLICY customer_education_profiles_owner_all ON public.customer_education_profiles
  FOR ALL TO authenticated
  USING (customer_id = auth.uid())
  WITH CHECK (customer_id = auth.uid());

DROP POLICY IF EXISTS customer_education_profiles_admin_all ON public.customer_education_profiles;
CREATE POLICY customer_education_profiles_admin_all ON public.customer_education_profiles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, INSERT, UPDATE ON public.customer_education_profiles TO authenticated;
GRANT ALL ON public.customer_education_profiles TO service_role;

REVOKE ALL ON TABLE public.customer_education_profiles FROM anon;
REVOKE ALL ON FUNCTION public.tg_validate_education_profile_fields() FROM PUBLIC, anon, authenticated;
