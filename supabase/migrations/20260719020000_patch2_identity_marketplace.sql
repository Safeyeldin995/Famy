-- Patch 2: database-authoritative identity separation and marketplace eligibility.
-- Additive migration. Historical business rows are preserved; ambiguous identities
-- are exposed to Admin instead of being guessed or deleted.

-- New auth users receive exactly the normal role selected at signup. Admin is
-- assigned separately and may coexist with that one normal role.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.app_role;
BEGIN
  v_role := CASE NEW.raw_user_meta_data ->> 'signup_role'
    WHEN 'provider' THEN 'provider'::public.app_role
    ELSE 'customer'::public.app_role
  END;

  INSERT INTO public.profiles (id, phone, email, full_name)
  VALUES (NEW.id, NEW.phone, NEW.email, COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, v_role);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Fail closed. The previous trigger silently deleted the existing normal role,
-- which allowed Customer onboarding to convert the identity to Provider.
DROP TRIGGER IF EXISTS enforce_role_exclusivity_trigger ON public.user_roles;
CREATE OR REPLACE FUNCTION public.enforce_role_exclusivity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_other public.app_role;
BEGIN
  IF TG_OP = 'DELETE' AND auth.uid() IS NULL THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.user_id, NEW.role) IS DISTINCT FROM (OLD.user_id, OLD.role) THEN
    RAISE EXCEPTION 'Identity role assignments are immutable' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role IN ('customer', 'provider') THEN
      v_other := CASE WHEN NEW.role = 'customer' THEN 'provider'::public.app_role ELSE 'customer'::public.app_role END;
      IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.user_id AND role = v_other) THEN
        RAISE EXCEPTION 'Customer and Provider identities are mutually exclusive' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.role = 'admin' AND
      (SELECT count(*) FROM public.user_roles WHERE user_id = NEW.user_id AND role IN ('customer', 'provider')) <> 1 THEN
      RAISE EXCEPTION 'Admin requires exactly one normal identity role' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'DELETE' AND OLD.role IN ('customer', 'provider') AND
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = OLD.user_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Cannot remove the normal identity role from an Admin' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_role_exclusivity() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enforce_role_exclusivity_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_role_exclusivity();

-- Provider onboarding is atomic and is available only to an identity that was
-- created as Provider at signup. It never adds, deletes, or converts roles.
CREATE OR REPLACE FUNCTION public.create_provider_profile(
  p_bio_en text,
  p_bio_ar text,
  p_years_experience integer,
  p_hourly_rate numeric,
  p_city text,
  p_languages text[]
)
RETURNS public.providers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  INSERT INTO public.providers (
    profile_id, bio_en, bio_ar, years_experience, hourly_rate, city,
    country, languages, is_active, is_verified
  ) VALUES (
    v_uid, COALESCE(p_bio_en, ''), COALESCE(p_bio_ar, ''), p_years_experience,
    p_hourly_rate, btrim(p_city), 'EG', COALESCE(p_languages, ARRAY[]::text[]), true, false
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.create_provider_profile(text,text,integer,numeric,text,text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_provider_profile(text,text,integer,numeric,text,text[]) TO authenticated;

-- Database-authoritative directory membership. These functions return only
-- identifiers, leaving existing Admin detail reads/RLS intact.
CREATE OR REPLACE FUNCTION public.admin_customer_identity_ids()
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ur.user_id
  FROM public.user_roles ur
  WHERE public.has_role(auth.uid(), 'admin')
    AND ur.role = 'customer'
    AND NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = ur.user_id AND x.role = 'provider');
$$;
CREATE OR REPLACE FUNCTION public.admin_provider_identity_ids()
RETURNS TABLE(provider_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
  FROM public.providers p
  JOIN public.user_roles ur ON ur.user_id = p.profile_id AND ur.role = 'provider'
  WHERE public.has_role(auth.uid(), 'admin')
    AND NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = p.profile_id AND x.role = 'customer');
$$;
REVOKE ALL ON FUNCTION public.admin_customer_identity_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_provider_identity_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_customer_identity_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_provider_identity_ids() TO authenticated;

-- Conflicts are diagnostic only. No role or business record is removed here.
DROP VIEW IF EXISTS public.admin_identity_conflicts;
CREATE OR REPLACE VIEW public.admin_identity_conflicts
WITH (security_invoker = true) AS
SELECT p.id AS user_id, pr.id AS provider_id, p.full_name, p.phone, p.email,
       'dual_normal_roles'::text AS issue_code,
       'BLOCKED BY BUSINESS DATA — both Customer and Provider roles are assigned'::text AS details
FROM public.profiles p
LEFT JOIN public.providers pr ON pr.profile_id = p.id
WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'customer')
  AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'provider')
UNION ALL
SELECT p.id, pr.id, p.full_name, p.phone, p.email,
       'provider_row_missing_role',
       'BLOCKED BY BUSINESS DATA — Provider business row exists but Provider role is missing'
FROM public.providers pr
JOIN public.profiles p ON p.id = pr.profile_id
WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'provider')
UNION ALL
SELECT p.id, pr.id, p.full_name, p.phone, p.email,
       'admin_normal_role_count',
       'BLOCKED BY BUSINESS DATA — Admin must coexist with exactly one normal role'
FROM public.profiles p
LEFT JOIN public.providers pr ON pr.profile_id = p.id
WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'admin')
  AND (SELECT count(*) FROM public.user_roles r WHERE r.user_id = p.id AND r.role IN ('customer','provider')) <> 1;
GRANT SELECT ON public.admin_identity_conflicts TO authenticated;

-- Private, row-per-service eligibility engine. No client role receives EXECUTE.
-- Customer and Admin/Provider wrappers below are the only supported entry points.
DROP VIEW IF EXISTS public.eligible_providers;
DROP FUNCTION IF EXISTS public.provider_eligibility(uuid);
CREATE OR REPLACE FUNCTION public.marketplace_eligibility_internal(
  p_provider_id uuid,
  p_service_id uuid DEFAULT NULL,
  p_address_id uuid DEFAULT NULL
)
RETURNS TABLE (
  provider_id uuid,
  service_id uuid,
  service_name_en text,
  service_name_ar text,
  identity_valid boolean,
  account_active boolean,
  verified boolean,
  service_approved boolean,
  service_active boolean,
  effective_price numeric,
  minimum_price numeric,
  maximum_price numeric,
  price_valid boolean,
  requirements_complete boolean,
  evidence_approved boolean,
  zone_covered boolean,
  address_covered boolean,
  availability_valid boolean,
  operational_clear boolean,
  is_eligible boolean,
  failure_reasons text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT p.*, ps.service_id, ps.status AS ps_status, ps.price_override,
           s.name_en AS service_name_en, s.name_ar AS service_name_ar,
           s.is_active AS service_is_active, s.minimum_price, s.maximum_price,
           COALESCE(ps.price_override, p.hourly_rate) AS effective_price
    FROM public.providers p
    JOIN public.provider_services ps ON ps.provider_id = p.id
    JOIN public.services s ON s.id = ps.service_id
    WHERE p.id = p_provider_id AND (p_service_id IS NULL OR ps.service_id = p_service_id)
  ), checks AS (
    SELECT c.*,
      EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = c.profile_id AND r.role = 'provider')
        AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = c.profile_id AND r.role = 'customer') AS identity_valid,
      (c.is_active AND c.deleted_at IS NULL AND NOT c.vacation_mode) AS account_active,
      (c.ps_status = 'approved') AS service_approved,
      c.service_is_active AS service_active,
      (c.effective_price > 0
        AND c.effective_price >= COALESCE(c.minimum_price, 0)
        AND (c.maximum_price IS NULL OR c.effective_price <= c.maximum_price)) AS price_valid,
      NOT EXISTS (
        SELECT 1 FROM public.service_requirements sr
        WHERE sr.service_id = c.service_id AND sr.is_active AND sr.required_for_provider_approval
          AND NOT EXISTS (
            SELECT 1 FROM public.provider_requirement_fulfillments f
            WHERE f.provider_id = c.id AND f.requirement_id = sr.id AND f.status IN ('passed','waived')
          )
      ) AS requirements_complete,
      NOT EXISTS (
        SELECT 1 FROM public.service_requirements sr
        WHERE sr.service_id = c.service_id AND sr.is_active AND sr.required_for_provider_approval AND sr.evidence_required
          AND NOT EXISTS (
            SELECT 1 FROM public.provider_requirement_fulfillments f
            WHERE f.provider_id = c.id AND f.requirement_id = sr.id
              AND (f.status = 'waived' OR (f.status = 'passed' AND f.evidence_storage_path IS NOT NULL))
          )
      ) AS evidence_approved,
      EXISTS (
        SELECT 1 FROM public.zones z
        JOIN public.zone_services zs ON zs.zone_id = z.id AND zs.service_id = c.service_id
        JOIN public.zone_providers zp ON zp.zone_id = z.id AND zp.provider_id = c.id
        WHERE z.is_active
      ) AS zone_covered,
      CASE WHEN p_address_id IS NULL THEN false ELSE EXISTS (
        SELECT 1 FROM public.addresses a
        JOIN public.zones z ON z.is_active AND (
          (z.boundary_type = 'polygon' AND public.point_in_polygon(a.lat, a.lng, z.polygon))
          OR (z.boundary_type = 'circle' AND 6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(a.lat)) * cos(radians(z.center_lat)) * cos(radians(z.center_lng) - radians(a.lng))
            + sin(radians(a.lat)) * sin(radians(z.center_lat))))) <= z.radius_km)
        )
        JOIN public.zone_services zs ON zs.zone_id = z.id AND zs.service_id = c.service_id
        JOIN public.zone_providers zp ON zp.zone_id = z.id AND zp.provider_id = c.id
        WHERE a.id = p_address_id AND a.lat IS NOT NULL AND a.lng IS NOT NULL
      ) END AS address_covered,
      EXISTS (
        SELECT 1 FROM public.availability_rules ar
        WHERE ar.provider_id = c.id AND ar.end_time > ar.start_time
      ) AS availability_valid,
      NOT EXISTS (
        SELECT 1 FROM public.provider_incidents pi
        WHERE pi.provider_id = c.id AND pi.status IN ('open','investigating') AND pi.severity IN ('high','critical')
      ) AS operational_clear
    FROM candidates c
  ), final AS (
    SELECT x.*,
      (x.identity_valid AND x.account_active AND x.is_verified AND x.service_approved AND x.service_active
       AND x.price_valid AND x.requirements_complete AND x.evidence_approved AND x.zone_covered
       AND (p_address_id IS NULL OR x.address_covered) AND x.availability_valid AND x.operational_clear) AS eligible
    FROM checks x
  )
  SELECT f.id, f.service_id, f.service_name_en, f.service_name_ar,
    f.identity_valid, f.account_active, f.is_verified, f.service_approved, f.service_active,
    f.effective_price, f.minimum_price, f.maximum_price, f.price_valid,
    f.requirements_complete, f.evidence_approved, f.zone_covered, f.address_covered,
    f.availability_valid, f.operational_clear, f.eligible,
    array_remove(ARRAY[
      CASE WHEN NOT f.identity_valid THEN 'Identity conflict or missing Provider role' END,
      CASE WHEN NOT f.account_active THEN 'Provider account is inactive, deleted, or in vacation mode' END,
      CASE WHEN NOT f.is_verified THEN 'Provider is not verified' END,
      CASE WHEN NOT f.service_approved THEN 'Provider-service relationship is not approved' END,
      CASE WHEN NOT f.service_active THEN 'Service is inactive or hidden from Customers' END,
      CASE WHEN NOT f.price_valid THEN 'Provider price is missing or outside Admin limits' END,
      CASE WHEN NOT f.requirements_complete THEN 'Mandatory Provider requirements are incomplete' END,
      CASE WHEN NOT f.evidence_approved THEN 'Required evidence is missing or not approved' END,
      CASE WHEN NOT f.zone_covered THEN 'Active Provider and Service zone coverage is missing' END,
      CASE WHEN p_address_id IS NOT NULL AND NOT f.address_covered THEN 'Customer address is outside applicable active coverage' END,
      CASE WHEN NOT f.availability_valid THEN 'Provider has no valid availability' END,
      CASE WHEN NOT f.operational_clear THEN 'Provider has a blocking operational incident' END
    ], NULL)::text[]
  FROM final f;
$$;
REVOKE ALL ON FUNCTION public.marketplace_eligibility_internal(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;

-- Admin sees every service and exact exclusion reasons; a Provider sees only
-- their own checklist. Customers and anon cannot execute this private RPC.
CREATE FUNCTION public.provider_marketplace_eligibility(
  p_provider_id uuid,
  p_service_id uuid DEFAULT NULL,
  p_address_id uuid DEFAULT NULL
)
RETURNS TABLE (
  provider_id uuid, service_id uuid, service_name_en text, service_name_ar text,
  identity_valid boolean, account_active boolean, verified boolean,
  service_approved boolean, service_active boolean, effective_price numeric,
  minimum_price numeric, maximum_price numeric, price_valid boolean,
  requirements_complete boolean, evidence_approved boolean, zone_covered boolean,
  address_covered boolean, availability_valid boolean, operational_clear boolean,
  is_eligible boolean, failure_reasons text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = p_provider_id AND p.profile_id = auth.uid() AND public.has_role(auth.uid(), 'provider')
    )
  ) THEN
    RAISE EXCEPTION 'Admin or owning Provider required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.marketplace_eligibility_internal(p_provider_id, p_service_id, p_address_id);
END;
$$;
REVOKE ALL ON FUNCTION public.provider_marketplace_eligibility(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_marketplace_eligibility(uuid,uuid,uuid) TO authenticated;

-- Customer marketplace returns safe public fields only and validates both the
-- Customer identity and address ownership inside the database.
CREATE OR REPLACE FUNCTION public.search_marketplace_providers(
  p_service_id uuid DEFAULT NULL,
  p_address_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, full_name text, avatar_url text, bio_en text, bio_ar text,
  hourly_rate numeric, years_experience integer, languages text[], city text,
  is_top_pro boolean, is_verified boolean, response_time_min integer,
  service_id uuid, service_slug text, service_name_en text, service_name_ar text,
  category_slug text, rating_avg numeric, rating_count bigint, trust_score numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_address uuid := p_address_id;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'customer') OR public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Customer identity required' USING ERRCODE = '42501';
  END IF;
  IF v_address IS NULL THEN
    SELECT a.id INTO v_address FROM public.addresses a
    WHERE a.user_id = v_uid ORDER BY a.is_default DESC, a.created_at ASC LIMIT 1;
  END IF;
  IF v_address IS NULL OR NOT EXISTS (SELECT 1 FROM public.addresses a WHERE a.id = v_address AND a.user_id = v_uid) THEN
    RAISE EXCEPTION 'A Customer-owned address is required' USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (p.id)
    p.id, pr.full_name, pr.avatar_url, p.bio_en, p.bio_ar, e.effective_price,
    p.years_experience, p.languages, p.city, p.is_top_pro, p.is_verified,
    p.response_time_min, s.id, s.slug, s.name_en, s.name_ar, c.slug,
    COALESCE(rs.rating_avg, 0), COALESCE(rs.rating_count, 0), COALESCE(ts.score, 0)
  FROM public.providers p
  JOIN LATERAL public.marketplace_eligibility_internal(p.id, p_service_id, v_address) e ON e.is_eligible
  JOIN public.profiles pr ON pr.id = p.profile_id
  JOIN public.services s ON s.id = e.service_id
  JOIN public.categories c ON c.id = s.category_id
  LEFT JOIN public.ratings_summary rs ON rs.provider_id = p.id
  LEFT JOIN public.trust_scores ts ON ts.provider_id = p.id
  ORDER BY p.id, p.is_top_pro DESC, COALESCE(rs.rating_avg, 0) DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.search_marketplace_providers(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_marketplace_providers(uuid,uuid) TO authenticated;

-- Details use the same eligibility engine. Historical booking participants may
-- still resolve the safe Provider card even if the Provider later becomes hidden.
CREATE OR REPLACE FUNCTION public.marketplace_provider_details(
  p_provider_id uuid,
  p_address_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, full_name text, avatar_url text, bio_en text, bio_ar text,
  hourly_rate numeric, years_experience integer, languages text[], city text,
  is_top_pro boolean, is_verified boolean, response_time_min integer,
  service_id uuid, service_slug text, service_name_en text, service_name_ar text,
  category_slug text, rating_avg numeric, rating_count bigint, trust_score numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_address uuid := p_address_id;
  v_historical boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'customer') OR public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Customer identity required' USING ERRCODE = '42501';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.bookings b WHERE b.customer_id = v_uid AND b.provider_id = p_provider_id)
    INTO v_historical;
  IF v_address IS NULL THEN
    SELECT a.id INTO v_address FROM public.addresses a WHERE a.user_id = v_uid
    ORDER BY a.is_default DESC, a.created_at ASC LIMIT 1;
  END IF;
  IF v_address IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.addresses a WHERE a.id = v_address AND a.user_id = v_uid) THEN
    RAISE EXCEPTION 'Address does not belong to Customer' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT p.id, pr.full_name, pr.avatar_url, p.bio_en, p.bio_ar,
    COALESCE(e.effective_price, p.hourly_rate), p.years_experience, p.languages,
    p.city, p.is_top_pro, p.is_verified, p.response_time_min,
    s.id, s.slug, s.name_en, s.name_ar, c.slug,
    COALESCE(rs.rating_avg, 0), COALESCE(rs.rating_count, 0), COALESCE(ts.score, 0)
  FROM public.providers p
  JOIN public.profiles pr ON pr.id = p.profile_id
  LEFT JOIN LATERAL (
    SELECT x.* FROM public.marketplace_eligibility_internal(p.id, NULL, v_address) x
    ORDER BY x.is_eligible DESC, x.service_id LIMIT 1
  ) e ON true
  LEFT JOIN public.services s ON s.id = e.service_id
  LEFT JOIN public.categories c ON c.id = s.category_id
  LEFT JOIN public.ratings_summary rs ON rs.provider_id = p.id
  LEFT JOIN public.trust_scores ts ON ts.provider_id = p.id
  WHERE p.id = p_provider_id AND (COALESCE(e.is_eligible, false) OR v_historical)
  LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION public.marketplace_provider_details(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketplace_provider_details(uuid,uuid) TO authenticated;

-- Prevent direct table reads from bypassing the marketplace pipeline. Admin,
-- owning Provider, and existing booking participants retain the required reads.
DROP POLICY IF EXISTS "providers_public_read" ON public.providers;
CREATE POLICY "providers_marketplace_participant_read" ON public.providers FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') OR profile_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.bookings b WHERE b.provider_id = providers.id AND b.customer_id = auth.uid())
);
REVOKE SELECT ON public.providers FROM anon;

-- Booking creation cannot bypass eligibility with hand-crafted client writes.
CREATE OR REPLACE FUNCTION public.tg_enforce_marketplace_booking_eligibility()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.marketplace_eligibility_internal(NEW.provider_id, NEW.service_id, NEW.address_id) e
    WHERE e.is_eligible
  ) THEN
    RAISE EXCEPTION 'Provider is not marketplace eligible for this service and address' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_enforce_marketplace_booking_eligibility() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_enforce_marketplace_booking_eligibility ON public.bookings;
CREATE TRIGGER trg_enforce_marketplace_booking_eligibility
  BEFORE INSERT OR UPDATE OF provider_id, service_id, address_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_enforce_marketplace_booking_eligibility();

-- Supporting indexes for role membership and eligibility joins.
CREATE INDEX IF NOT EXISTS idx_user_roles_role_user ON public.user_roles(role, user_id);
CREATE INDEX IF NOT EXISTS idx_provider_incidents_blocking ON public.provider_incidents(provider_id, status, severity);
