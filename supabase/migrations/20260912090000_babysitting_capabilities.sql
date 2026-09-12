-- Babysitting capabilities: provider-declared age groups with per-group experience,
-- a maximum child count, and server-side eligibility checks.
--
-- Extends what already exists rather than replacing it:
--   provider_onboarding_details.child_age_groups is a free-text array with no constraint,
--   currently holding 'newborn', 'toddler', 'school'. It is backfilled into the new table
--   and left in place so nothing that still reads it breaks.
--
-- Provider-declared capability is kept strictly separate from anything Famy verified.
-- Providers can write their own claims; only admins can write verification fields.

-- ---------------------------------------------------------------------------
-- 1. Canonical age-group catalogue
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.child_age_groups (
  code          text PRIMARY KEY,
  name_en       text NOT NULL,
  name_ar       text NOT NULL,
  min_months    int  NOT NULL,
  max_months    int  NOT NULL,
  sort_order    int  NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT child_age_groups_bounds_ordered CHECK (max_months >= min_months)
);

COMMENT ON TABLE public.child_age_groups IS
  'Stable identifiers for child age bands. Bounds are inclusive months and must not overlap.';

INSERT INTO public.child_age_groups (code, name_en, name_ar, min_months, max_months, sort_order) VALUES
  ('newborn',    'Newborns',              'حديثو الولادة',   0,   2,   1),
  ('infant',     'Infants',               'الرضع',            3,   11,  2),
  ('toddler',    'Toddlers',              'الأطفال الصغار',   12,  35,  3),
  ('preschool',  'Preschool children',    'أطفال ما قبل المدرسة', 36, 71, 4),
  ('school_age', 'School-age children',   'أطفال المدارس',    72,  155, 5),
  ('teenager',   'Teenagers',             'المراهقون',        156, 215, 6)
ON CONFLICT (code) DO NOTHING;

-- Bounds must tile without gaps or overlaps. Fail the migration rather than ship a
-- catalogue where a child of some age matches two groups or none.
DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM (
    SELECT max_months, lead(min_months) OVER (ORDER BY sort_order) AS next_min
    FROM public.child_age_groups WHERE is_active
  ) t WHERE next_min IS NOT NULL AND next_min <> max_months + 1;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'child_age_groups bounds overlap or leave a gap';
  END IF;
END $$;

ALTER TABLE public.child_age_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS child_age_groups_read ON public.child_age_groups;
CREATE POLICY child_age_groups_read ON public.child_age_groups
  FOR SELECT USING (true);

DROP POLICY IF EXISTS child_age_groups_admin ON public.child_age_groups;
CREATE POLICY child_age_groups_admin ON public.child_age_groups
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- 2. Provider-declared capability, one row per supported age group
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.provider_age_group_capabilities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id       uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  age_group_code    text NOT NULL REFERENCES public.child_age_groups(code),
  years_experience  int,
  note              text,
  -- Admin-only. Never writable by the provider; see the guard trigger below.
  verified_at       timestamptz,
  verified_by       uuid REFERENCES public.profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_age_group_unique UNIQUE (provider_id, age_group_code),
  CONSTRAINT provider_age_group_years_sane CHECK (years_experience IS NULL OR (years_experience >= 0 AND years_experience <= 60)),
  CONSTRAINT provider_age_group_note_len CHECK (note IS NULL OR length(note) <= 300)
);

COMMENT ON COLUMN public.provider_age_group_capabilities.verified_at IS
  'Set only by an admin. A provider declaring experience must never produce a verified badge.';

CREATE INDEX IF NOT EXISTS idx_provider_age_group_provider
  ON public.provider_age_group_capabilities(provider_id);

DROP TRIGGER IF EXISTS trg_provider_age_group_updated ON public.provider_age_group_capabilities;
CREATE TRIGGER trg_provider_age_group_updated
  BEFORE UPDATE ON public.provider_age_group_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Guard: a non-admin can never set or change the verification columns, whether through
-- the app, PostgREST, or a hand-rolled request.
CREATE OR REPLACE FUNCTION public.tg_guard_age_group_verification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.verified_at IS NOT NULL OR NEW.verified_by IS NOT NULL THEN
      RAISE EXCEPTION 'Verification fields are admin-only.' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.verified_at IS DISTINCT FROM OLD.verified_at
       OR NEW.verified_by IS DISTINCT FROM OLD.verified_by THEN
      RAISE EXCEPTION 'Verification fields are admin-only.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_age_group_verification ON public.provider_age_group_capabilities;
CREATE TRIGGER trg_guard_age_group_verification
  BEFORE INSERT OR UPDATE ON public.provider_age_group_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_age_group_verification();

ALTER TABLE public.provider_age_group_capabilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_age_group_select ON public.provider_age_group_capabilities;
CREATE POLICY provider_age_group_select ON public.provider_age_group_capabilities
  FOR SELECT USING (true);

DROP POLICY IF EXISTS provider_age_group_write ON public.provider_age_group_capabilities;
CREATE POLICY provider_age_group_write ON public.provider_age_group_capabilities
  FOR ALL
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_age_group_capabilities.provider_id
        AND p.profile_id = auth.uid()
        AND public.provider_onboarding_editable(p.onboarding_status)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_age_group_capabilities.provider_id
        AND p.profile_id = auth.uid()
        AND public.provider_onboarding_editable(p.onboarding_status)
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Maximum children accepted in one booking
-- ---------------------------------------------------------------------------

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS max_children_per_booking int;

ALTER TABLE public.providers
  DROP CONSTRAINT IF EXISTS providers_max_children_sane;
ALTER TABLE public.providers
  ADD CONSTRAINT providers_max_children_sane
  CHECK (max_children_per_booking IS NULL OR (max_children_per_booking >= 1 AND max_children_per_booking <= 20));

COMMENT ON COLUMN public.providers.max_children_per_booking IS
  'Provider-declared. NULL means not yet declared, which blocks new babysitting bookings.';

-- ---------------------------------------------------------------------------
-- 4. Backfill from the legacy free-text array
-- ---------------------------------------------------------------------------
-- Legacy values seen in Production: 'newborn', 'toddler', 'school'.
-- Anything unrecognised is deliberately dropped rather than guessed: a legacy provider
-- must not be marked capable of a group they never declared.

-- The legacy column is free text with no constraint, so it can hold anything. Unknown
-- values are skipped by the join rather than inserted and cleaned up afterwards: the
-- foreign key would abort the whole migration before any cleanup could run.

WITH legacy AS (
  SELECT d.provider_id,
         CASE lower(btrim(g))
           WHEN 'school'     THEN 'school_age'
           WHEN 'schoolage'  THEN 'school_age'
           WHEN 'school-age' THEN 'school_age'
           WHEN 'teen'       THEN 'teenager'
           WHEN 'teens'      THEN 'teenager'
           WHEN 'baby'       THEN 'infant'
           WHEN 'infants'    THEN 'infant'
           ELSE lower(btrim(g))
         END AS code
  FROM public.provider_onboarding_details d
  CROSS JOIN LATERAL unnest(coalesce(d.child_age_groups, '{}')) AS g
  WHERE btrim(g) <> ''
)
INSERT INTO public.provider_age_group_capabilities (provider_id, age_group_code)
SELECT l.provider_id, l.code
FROM legacy l
JOIN public.child_age_groups g ON g.code = l.code
ON CONFLICT (provider_id, age_group_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Server-side eligibility
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.child_age_group_for_months(p_age_months int)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT code FROM public.child_age_groups
  WHERE is_active AND p_age_months BETWEEN min_months AND max_months
  ORDER BY sort_order LIMIT 1;
$$;

COMMENT ON FUNCTION public.child_age_group_for_months(int) IS
  'Maps an age in whole months to its group. Returns NULL above the oldest band.';

CREATE OR REPLACE FUNCTION public.provider_supports_children(
  p_provider_id uuid,
  p_age_groups  text[],
  p_child_count int
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_max        int;
  v_missing    text[];
  v_reasons    text[] := ARRAY[]::text[];
BEGIN
  SELECT max_children_per_booking INTO v_max FROM public.providers WHERE id = p_provider_id;

  IF v_max IS NULL THEN
    v_reasons := array_append(v_reasons, 'max_children_not_declared');
  ELSIF p_child_count IS NULL OR p_child_count < 1 THEN
    v_reasons := array_append(v_reasons, 'invalid_child_count');
  ELSIF p_child_count > v_max THEN
    v_reasons := array_append(v_reasons, 'child_count_exceeds_provider_maximum');
  END IF;

  SELECT array_agg(g) INTO v_missing
  FROM unnest(coalesce(p_age_groups, '{}')) g
  WHERE NOT EXISTS (
    SELECT 1 FROM public.provider_age_group_capabilities c
    WHERE c.provider_id = p_provider_id AND c.age_group_code = g
  );

  IF v_missing IS NOT NULL AND cardinality(v_missing) > 0 THEN
    v_reasons := array_append(v_reasons, 'age_group_not_supported');
  END IF;

  IF p_age_groups IS NULL OR cardinality(p_age_groups) = 0 THEN
    v_reasons := array_append(v_reasons, 'no_age_group_supplied');
  END IF;

  RETURN jsonb_build_object(
    'eligible', cardinality(v_reasons) = 0,
    'reasons', to_jsonb(v_reasons),
    'unsupported_age_groups', to_jsonb(coalesce(v_missing, ARRAY[]::text[])),
    'max_children', v_max
  );
END;
$$;

REVOKE ALL ON FUNCTION public.provider_supports_children(uuid, text[], int) FROM public;
GRANT EXECUTE ON FUNCTION public.provider_supports_children(uuid, text[], int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.child_age_group_for_months(int) TO authenticated;
