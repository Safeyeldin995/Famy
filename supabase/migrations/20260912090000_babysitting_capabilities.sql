-- Babysitting capabilities: provider-declared age groups with per-group experience,
-- a maximum child count, and server-side eligibility checks.
--
-- Extends what already exists rather than replacing it:
--   provider_onboarding_details.child_age_groups is a free-text array with no constraint,
--   currently holding 'newborn', 'toddler', 'school'. It is backfilled into the new table
--   and left in place so nothing that still reads it breaks.
--
-- Provider-declared capability is kept strictly separate from Famy verification.
-- Claim content is owning-provider-only in DRAFT/NEEDS_CHANGES.
-- Admin authority grants verification of another provider, never claim-content writes,
-- and never self-verification for a provider-admin.
--
-- Phase A is database safety plus local disposable tests. Do not apply this to
-- Production until providers have a declaration path and the booking UI requires
-- one owned child family member.

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
  'Stable identifiers for child age bands. Bounds are inclusive months and must tile 0-215 with no overlap.';

INSERT INTO public.child_age_groups (code, name_en, name_ar, min_months, max_months, sort_order) VALUES
  ('newborn',    'Newborns',              'حديثو الولادة',   0,   2,   1),
  ('infant',     'Infants',               'الرضع',            3,   11,  2),
  ('toddler',    'Toddlers',              'الأطفال الصغار',   12,  35,  3),
  ('preschool',  'Preschool children',    'أطفال ما قبل المدرسة', 36, 71, 4),
  ('school_age', 'School-age children',   'أطفال المدارس',    72,  155, 5),
  ('teenager',   'Teenagers',             'المراهقون',        156, 215, 6)
ON CONFLICT (code) DO NOTHING;

-- Bounds must tile 0-215 with exactly six active bands and no gaps or overlaps.
-- Fail the migration rather than ship a catalogue where a child matches two groups or none.
-- Re-apply still fails if intervening edits shifted a contiguous but wrong range
-- (ON CONFLICT DO NOTHING does not reset mutated bounds).
DO $$
DECLARE
  v_n int;
  v_first int;
  v_last int;
  v_bad int;
BEGIN
  SELECT count(*), min(min_months), max(max_months)
    INTO v_n, v_first, v_last
  FROM public.child_age_groups
  WHERE is_active;

  IF v_n <> 6 OR v_first IS DISTINCT FROM 0 OR v_last IS DISTINCT FROM 215 THEN
    RAISE EXCEPTION 'child_age_groups must have exactly six active bands covering 0-215 months';
  END IF;

  SELECT count(*) INTO v_bad FROM (
    SELECT max_months, lead(min_months) OVER (ORDER BY min_months, sort_order) AS next_min
    FROM public.child_age_groups WHERE is_active
  ) t WHERE next_min IS NOT NULL AND next_min <> max_months + 1;

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'child_age_groups bounds overlap or leave a gap';
  END IF;
END $$;

ALTER TABLE public.child_age_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS child_age_groups_read ON public.child_age_groups;
CREATE POLICY child_age_groups_read ON public.child_age_groups
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS child_age_groups_admin ON public.child_age_groups;

REVOKE ALL PRIVILEGES ON TABLE public.child_age_groups FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.child_age_groups TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.child_age_groups TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Provider-declared capability, one row per supported age group
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.provider_age_group_capabilities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id       uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  age_group_code    text NOT NULL REFERENCES public.child_age_groups(code),
  years_experience  int,
  note              text,
  -- Admin-only verification of another provider. Never writable by the owner,
  -- including a provider who also has the admin role.
  verified_at       timestamptz,
  verified_by       uuid REFERENCES public.profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_age_group_unique UNIQUE (provider_id, age_group_code),
  CONSTRAINT provider_age_group_years_sane CHECK (years_experience IS NULL OR (years_experience >= 0 AND years_experience <= 60)),
  CONSTRAINT provider_age_group_note_len CHECK (note IS NULL OR length(note) <= 300)
);

COMMENT ON COLUMN public.provider_age_group_capabilities.verified_at IS
  'Set only by an admin who does not own this provider. A provider declaring experience must never produce a verified badge.';

CREATE INDEX IF NOT EXISTS idx_provider_age_group_provider
  ON public.provider_age_group_capabilities(provider_id);

DROP TRIGGER IF EXISTS trg_provider_age_group_updated ON public.provider_age_group_capabilities;
CREATE TRIGGER trg_provider_age_group_updated
  BEFORE UPDATE ON public.provider_age_group_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Guard: no admin early-return. Owner path and verification path are separate.
-- RLS is the row filter; this trigger is the column/identity backstop.
CREATE OR REPLACE FUNCTION public.tg_guard_age_group_verification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := v_uid IS NOT NULL AND public.has_role(v_uid, 'admin');
  v_owns boolean := false;
  v_editable boolean := false;
  v_provider_id uuid;
  v_verification_changed boolean := false;
  v_claim_content_changed boolean := false;
BEGIN
  -- Client path is authenticated with a JWT. Migration/service_role have no uid
  -- and must still be able to backfill unverified claims.
  IF v_uid IS NULL THEN
    IF current_user = 'authenticated' THEN
      RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_provider_id := OLD.provider_id;
  ELSE
    v_provider_id := NEW.provider_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.providers p
    WHERE p.id = v_provider_id AND p.profile_id = v_uid
  ) INTO v_owns;

  SELECT public.provider_onboarding_editable(p.onboarding_status)
    INTO v_editable
  FROM public.providers p
  WHERE p.id = v_provider_id;

  IF TG_OP = 'DELETE' THEN
    IF OLD.verified_at IS NOT NULL OR OLD.verified_by IS NOT NULL THEN
      RAISE EXCEPTION 'Verified capability claims cannot be deleted.' USING ERRCODE = '42501';
    END IF;
    IF NOT v_owns OR NOT COALESCE(v_editable, false) THEN
      RAISE EXCEPTION 'Only the owning provider may delete unverified claims while the application is editable.' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  v_verification_changed :=
    (TG_OP = 'INSERT' AND (NEW.verified_at IS NOT NULL OR NEW.verified_by IS NOT NULL))
    OR (TG_OP = 'UPDATE' AND (
      NEW.verified_at IS DISTINCT FROM OLD.verified_at
      OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
    ));

  v_claim_content_changed :=
    TG_OP = 'INSERT'
    OR (TG_OP = 'UPDATE' AND (
      NEW.id IS DISTINCT FROM OLD.id
      OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
      OR NEW.age_group_code IS DISTINCT FROM OLD.age_group_code
      OR NEW.years_experience IS DISTINCT FROM OLD.years_experience
      OR NEW.note IS DISTINCT FROM OLD.note
    ));

  IF v_verification_changed THEN
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Verification fields are admin-only.' USING ERRCODE = '42501';
    END IF;
    IF v_owns THEN
      RAISE EXCEPTION 'A provider cannot verify their own capabilities.' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Admins cannot insert capability claims.' USING ERRCODE = '42501';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
       OR NEW.age_group_code IS DISTINCT FROM OLD.age_group_code
       OR NEW.years_experience IS DISTINCT FROM OLD.years_experience
       OR NEW.note IS DISTINCT FROM OLD.note THEN
      RAISE EXCEPTION 'Admin verification cannot change claim content or identity.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT v_owns THEN
    RAISE EXCEPTION 'Only the owning provider may change capability claims.' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(v_editable, false) THEN
    RAISE EXCEPTION 'Application is not editable in the current status.' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' AND (NEW.verified_at IS NOT NULL OR NEW.verified_by IS NOT NULL) THEN
    RAISE EXCEPTION 'Verification fields are admin-only.' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN
      RAISE EXCEPTION 'Capability claim identity cannot be reassigned.' USING ERRCODE = '42501';
    END IF;
    IF (OLD.verified_at IS NOT NULL OR OLD.verified_by IS NOT NULL) AND v_claim_content_changed THEN
      RAISE EXCEPTION 'Verified capability claims cannot be edited. Ask an admin to clear verification first.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_age_group_verification ON public.provider_age_group_capabilities;
CREATE TRIGGER trg_guard_age_group_verification
  BEFORE INSERT OR UPDATE OR DELETE ON public.provider_age_group_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_age_group_verification();

REVOKE ALL ON FUNCTION public.tg_guard_age_group_verification() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.provider_age_group_capabilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_age_group_select ON public.provider_age_group_capabilities;
CREATE POLICY provider_age_group_select ON public.provider_age_group_capabilities
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_age_group_capabilities.provider_id
        AND p.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS provider_age_group_write ON public.provider_age_group_capabilities;

DROP POLICY IF EXISTS provider_age_group_insert ON public.provider_age_group_capabilities;
CREATE POLICY provider_age_group_insert ON public.provider_age_group_capabilities
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_age_group_capabilities.provider_id
        AND p.profile_id = auth.uid()
        AND public.provider_onboarding_editable(p.onboarding_status)
    )
  );

DROP POLICY IF EXISTS provider_age_group_update ON public.provider_age_group_capabilities;
CREATE POLICY provider_age_group_update ON public.provider_age_group_capabilities
  FOR UPDATE
  TO authenticated
  USING (
    (
      EXISTS (
        SELECT 1 FROM public.providers p
        WHERE p.id = provider_age_group_capabilities.provider_id
          AND p.profile_id = auth.uid()
          AND public.provider_onboarding_editable(p.onboarding_status)
      )
    )
    OR (
      public.has_role(auth.uid(), 'admin')
      AND NOT EXISTS (
        SELECT 1 FROM public.providers p
        WHERE p.id = provider_age_group_capabilities.provider_id
          AND p.profile_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    (
      EXISTS (
        SELECT 1 FROM public.providers p
        WHERE p.id = provider_age_group_capabilities.provider_id
          AND p.profile_id = auth.uid()
          AND public.provider_onboarding_editable(p.onboarding_status)
      )
    )
    OR (
      public.has_role(auth.uid(), 'admin')
      AND NOT EXISTS (
        SELECT 1 FROM public.providers p
        WHERE p.id = provider_age_group_capabilities.provider_id
          AND p.profile_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS provider_age_group_delete ON public.provider_age_group_capabilities;
CREATE POLICY provider_age_group_delete ON public.provider_age_group_capabilities
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_age_group_capabilities.provider_id
        AND p.profile_id = auth.uid()
        AND public.provider_onboarding_editable(p.onboarding_status)
    )
  );

REVOKE ALL PRIVILEGES ON TABLE public.provider_age_group_capabilities FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.provider_age_group_capabilities TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.provider_age_group_capabilities TO service_role;

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
-- Documented Production mapping: 'school' → 'school_age'.
-- Unknown values, including unproven aliases such as baby/teen, are skipped.

WITH legacy AS (
  SELECT d.provider_id,
         CASE lower(btrim(g))
           WHEN 'school'     THEN 'school_age'
           WHEN 'schoolage'  THEN 'school_age'
           WHEN 'school-age' THEN 'school_age'
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
-- 5. Server-side eligibility (authoritative booking hook, not a client oracle)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.child_age_group_for_months(p_age_months int)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT code FROM public.child_age_groups
  WHERE is_active AND p_age_months BETWEEN min_months AND max_months
  ORDER BY sort_order LIMIT 1;
$$;

COMMENT ON FUNCTION public.child_age_group_for_months(int) IS
  'Maps an age in whole months to its group. Returns NULL outside 0-215.';

CREATE OR REPLACE FUNCTION public.assert_babysitting_booking_eligible(
  p_provider_id uuid,
  p_service_id uuid,
  p_customer_id uuid,
  p_family_member_id uuid,
  p_start_at timestamptz
) RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
  v_fm RECORD;
  v_months int;
  v_group text;
  v_max int;
BEGIN
  SELECT c.slug INTO v_slug
  FROM public.services s
  JOIN public.categories c ON c.id = s.category_id
  WHERE s.id = p_service_id;

  IF v_slug IS DISTINCT FROM 'babysitting' THEN
    RETURN;
  END IF;

  IF p_family_member_id IS NULL THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Babysitting requires an owned child family member.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_fm FROM public.family_members WHERE id = p_family_member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Selected family member was not found.' USING ERRCODE = '23514';
  END IF;
  IF v_fm.customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Selected family member does not belong to this customer.' USING ERRCODE = '42501';
  END IF;
  IF NOT v_fm.is_active THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Selected family member is no longer active.' USING ERRCODE = '23514';
  END IF;
  IF v_fm.date_of_birth IS NULL OR v_fm.date_of_birth > (p_start_at AT TIME ZONE 'utc')::date THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Child date of birth is missing or in the future.' USING ERRCODE = '23514';
  END IF;

  v_months := (
    EXTRACT(YEAR FROM age((p_start_at AT TIME ZONE 'utc')::date, v_fm.date_of_birth)) * 12
    + EXTRACT(MONTH FROM age((p_start_at AT TIME ZONE 'utc')::date, v_fm.date_of_birth))
  )::int;

  IF v_months < 0 OR v_months > 215 THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Child age is outside the supported 0-215 month range.' USING ERRCODE = '23514';
  END IF;

  v_group := public.child_age_group_for_months(v_months);
  IF v_group IS NULL THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Child age is outside the supported 0-215 month range.' USING ERRCODE = '23514';
  END IF;

  SELECT max_children_per_booking INTO v_max FROM public.providers WHERE id = p_provider_id;
  IF v_max IS NULL THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Provider has not declared a maximum children per booking.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.provider_age_group_capabilities c
    WHERE c.provider_id = p_provider_id AND c.age_group_code = v_group
  ) THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Provider does not support this child age group.' USING ERRCODE = '23514';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_babysitting_booking_eligible(uuid, uuid, uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.child_age_group_for_months(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.child_age_group_for_months(int) TO anon, authenticated;

-- Kept only as a revoked internal stub so older scratch grants cannot remain a
-- client-callable capability oracle. Booking enforcement does not use it.
CREATE OR REPLACE FUNCTION public.provider_supports_children(
  p_provider_id uuid,
  p_age_groups  text[],
  p_child_count int
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Direct capability oracle calls are not permitted.' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.provider_supports_children(uuid, text[], int) FROM PUBLIC, anon, authenticated;

-- Wire into the authoritative BEFORE INSERT booking hook. Body is the current
-- create_booking-era validator plus a server-derived single-child babysitting check.
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

  SELECT hourly_rate INTO v_provider_hourly_rate FROM public.providers WHERE id = NEW.provider_id;
  v_rate := COALESCE(v_ps.price_override, v_provider_hourly_rate);
  IF v_ps.price_override IS NOT NULL THEN
    IF NOT v_service.provider_pricing_allowed
       OR (v_service.minimum_price IS NOT NULL AND v_rate < v_service.minimum_price)
       OR (v_service.maximum_price IS NOT NULL AND v_rate > v_service.maximum_price)
    THEN
      RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Provider price no longer meets pricing rules.' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_service.pricing_model = 'hourly' THEN
    v_hours := EXTRACT(EPOCH FROM (NEW.end_at - NEW.start_at)) / 3600.0;
    v_expected_subtotal := ROUND(v_rate * v_hours, 2);
  ELSE
    v_expected_subtotal := v_rate;
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
