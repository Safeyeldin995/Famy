DROP VIEW IF EXISTS public.eligible_providers;
DROP FUNCTION IF EXISTS public.provider_eligibility(uuid);

CREATE FUNCTION public.provider_eligibility(p_provider_id uuid)
RETURNS TABLE (
  provider_id uuid,
  verified boolean,
  active boolean,
  has_approved_service boolean,
  price_valid boolean,
  zone_covered boolean,
  requirements_met boolean,
  has_availability boolean,
  is_eligible boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH service_state AS (
    SELECT
      bool_or(ps.status = 'approved' AND s.is_active) AS has_approved_service,
      bool_or(
        ps.status = 'approved' AND s.is_active
        AND COALESCE(ps.price_override, p.hourly_rate) >= COALESCE(s.minimum_price, 0)
        AND (s.maximum_price IS NULL OR COALESCE(ps.price_override, p.hourly_rate) <= s.maximum_price)
      ) AS price_valid
    FROM public.providers p
    LEFT JOIN public.provider_services ps ON ps.provider_id = p.id
    LEFT JOIN public.services s ON s.id = ps.service_id
    WHERE p.id = p_provider_id
  ),
  eligibility AS (
    SELECT
      p.id AS provider_id,
      p.is_verified AS verified,
      p.is_active AS active,
      COALESCE(ss.has_approved_service, false) AS has_approved_service,
      COALESCE(ss.price_valid, false) AS price_valid,
      EXISTS (
        SELECT 1
        FROM public.zone_providers zp
        JOIN public.zones z ON z.id = zp.zone_id AND z.is_active
        JOIN public.zone_services zs ON zs.zone_id = z.id
        JOIN public.provider_services ps
          ON ps.service_id = zs.service_id
         AND ps.provider_id = p.id
         AND ps.status = 'approved'
        WHERE zp.provider_id = p.id
      ) AS zone_covered,
      NOT EXISTS (
        SELECT 1
        FROM public.provider_services ps
        JOIN public.service_requirements sr
          ON sr.service_id = ps.service_id
         AND sr.required_for_provider_approval
         AND sr.is_active
        WHERE ps.provider_id = p.id
          AND ps.status = 'approved'
          AND NOT EXISTS (
            SELECT 1
            FROM public.provider_requirement_fulfillments prf
            WHERE prf.provider_id = p.id
              AND prf.requirement_id = sr.id
              AND prf.status IN ('passed', 'waived')
          )
      ) AS requirements_met,
      EXISTS (
        SELECT 1 FROM public.availability_rules ar
        WHERE ar.provider_id = p.id
      ) AS has_availability
    FROM public.providers p
    CROSS JOIN service_state ss
    WHERE p.id = p_provider_id
  )
  SELECT e.*,
    e.verified AND e.active AND e.has_approved_service AND e.price_valid
    AND e.zone_covered AND e.requirements_met AND e.has_availability AS is_eligible
  FROM eligibility e;
$$;

REVOKE ALL ON FUNCTION public.provider_eligibility(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provider_eligibility(uuid) TO authenticated;

CREATE VIEW public.eligible_providers
WITH (security_invoker = true) AS
SELECT p.*
FROM public.providers p
CROSS JOIN LATERAL public.provider_eligibility(p.id) e
WHERE e.is_eligible;

GRANT SELECT ON public.eligible_providers TO anon, authenticated;
