-- Tutoring eligibility uses approved, in-range teaching session prices.
-- All other eligibility predicates and the internal RPC permissions are unchanged.

CREATE OR REPLACE FUNCTION public.marketplace_eligibility_internal(
  p_provider_id uuid, p_service_id uuid DEFAULT NULL, p_address_id uuid DEFAULT NULL
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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH candidates AS (
    SELECT p.*, ps.service_id, ps.status AS ps_status, ps.price_override,
           s.name_en AS service_name_en, s.name_ar AS service_name_ar,
           s.is_active AS service_is_active, s.minimum_price, s.maximum_price,
           EXISTS (SELECT 1 FROM public.categories cat
             WHERE cat.id = s.category_id AND cat.slug = 'tutoring') AS is_tutoring,
           CASE WHEN EXISTS (SELECT 1 FROM public.categories cat
             WHERE cat.id = s.category_id AND cat.slug = 'tutoring') THEN (
               SELECT MIN(tc.session_price)
               FROM public.provider_teaching_capabilities tc
               WHERE tc.provider_id = p.id AND tc.service_id = s.id AND tc.status = 'approved'
                 AND tc.session_price >= COALESCE(s.minimum_price, 0)
                 AND (s.maximum_price IS NULL OR tc.session_price <= s.maximum_price)
             ) ELSE COALESCE(ps.price_override, p.hourly_rate) END AS effective_price
    FROM public.providers p
    JOIN public.provider_services ps ON ps.provider_id = p.id
    JOIN public.services s ON s.id = ps.service_id
    WHERE p.id = p_provider_id AND (p_service_id IS NULL OR ps.service_id = p_service_id)
  ), checks AS (
    SELECT c.*,
      EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = c.profile_id AND r.role = 'provider')
        AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = c.profile_id AND r.role = 'customer') AS identity_valid,
      (c.is_active AND c.deleted_at IS NULL AND NOT c.vacation_mode AND c.onboarding_status = 'APPROVED') AS account_active,
      (c.is_verified AND c.onboarding_status = 'APPROVED') AS provider_verified,
      (c.ps_status = 'approved') AS service_approved,
      c.service_is_active AS service_active,
      CASE WHEN c.is_tutoring THEN c.effective_price IS NOT NULL ELSE
        (c.effective_price > 0 AND c.effective_price >= COALESCE(c.minimum_price, 0)
          AND (c.maximum_price IS NULL OR c.effective_price <= c.maximum_price)) END AS price_valid,
      NOT EXISTS (
        SELECT 1 FROM public.service_requirements sr
        WHERE sr.service_id = c.service_id AND sr.is_active AND sr.required_for_provider_approval
          AND NOT EXISTS (SELECT 1 FROM public.provider_requirement_fulfillments f
            WHERE f.provider_id = c.id AND f.requirement_id = sr.id AND f.status IN ('passed','waived'))
      ) AS requirements_complete,
      NOT EXISTS (
        SELECT 1 FROM public.service_requirements sr
        WHERE sr.service_id = c.service_id AND sr.is_active AND sr.required_for_provider_approval AND sr.evidence_required
          AND NOT EXISTS (SELECT 1 FROM public.provider_requirement_fulfillments f
            WHERE f.provider_id = c.id AND f.requirement_id = sr.id
              AND (f.status = 'waived' OR (f.status = 'passed' AND f.evidence_storage_path IS NOT NULL)))
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
      EXISTS (SELECT 1 FROM public.availability_rules ar WHERE ar.provider_id = c.id AND ar.end_time > ar.start_time) AS availability_valid,
      NOT EXISTS (
        SELECT 1 FROM public.provider_incidents pi
        WHERE pi.provider_id = c.id AND pi.status IN ('open','investigating') AND pi.severity IN ('high','critical')
      ) AS operational_clear,
      (c.onboarding_status <> 'SUSPENDED') AS not_suspended,
      (
        NOT EXISTS (
          SELECT 1
          FROM public.services s_bs
          JOIN public.categories cat_bs ON cat_bs.id = s_bs.category_id
          WHERE s_bs.id = c.service_id AND cat_bs.slug = 'babysitting'
        )
        OR (
          c.max_children_per_booking IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.provider_age_group_capabilities ag
            WHERE ag.provider_id = c.id
          )
        )
      ) AS babysitting_bookable
    FROM candidates c
  ), final AS (
    SELECT x.*,
      (x.identity_valid AND x.account_active AND x.provider_verified AND x.service_approved AND x.service_active
       AND x.price_valid AND x.requirements_complete AND x.evidence_approved AND x.zone_covered
       AND (p_address_id IS NULL OR x.address_covered) AND x.availability_valid AND x.operational_clear AND x.not_suspended
       AND x.babysitting_bookable) AS eligible
    FROM checks x
  )
  SELECT f.id, f.service_id, f.service_name_en, f.service_name_ar,
    f.identity_valid, f.account_active, f.provider_verified AS verified, f.service_approved, f.service_active,
    f.effective_price, f.minimum_price, f.maximum_price, f.price_valid,
    f.requirements_complete, f.evidence_approved, f.zone_covered, f.address_covered,
    f.availability_valid, f.operational_clear, f.eligible,
    array_remove(ARRAY[
      CASE WHEN NOT f.identity_valid THEN 'Identity conflict or missing Provider role' END,
      CASE WHEN NOT f.account_active THEN 'Provider account is inactive, not approved, deleted, or in vacation mode' END,
      CASE WHEN NOT f.provider_verified THEN 'Provider is not verified or onboarding is not approved' END,
      CASE WHEN NOT f.not_suspended THEN 'Provider is suspended' END,
      CASE WHEN NOT f.service_approved THEN 'Provider-service relationship is not approved' END,
      CASE WHEN NOT f.service_active THEN 'Service is inactive or hidden from Customers' END,
      CASE WHEN NOT f.price_valid THEN CASE WHEN f.is_tutoring
        THEN 'No approved teaching subject with a valid session price'
        ELSE 'Provider price is missing or outside Admin limits' END END,
      CASE WHEN NOT f.requirements_complete THEN 'Mandatory Provider requirements are incomplete' END,
      CASE WHEN NOT f.evidence_approved THEN 'Required evidence is missing or not approved' END,
      CASE WHEN NOT f.zone_covered THEN 'Active Provider and Service zone coverage is missing' END,
      CASE WHEN p_address_id IS NOT NULL AND NOT f.address_covered THEN 'Customer address is outside applicable active coverage' END,
      CASE WHEN NOT f.availability_valid THEN 'Provider has no valid availability' END,
      CASE WHEN NOT f.operational_clear THEN 'Provider has a blocking operational incident' END,
      CASE WHEN NOT f.babysitting_bookable THEN 'Babysitting maximum children or age-group capabilities are not declared' END
    ], NULL)::text[]
  FROM final f;
$$;

REVOKE ALL ON FUNCTION public.marketplace_eligibility_internal(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
