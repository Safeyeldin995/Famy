-- Provider -> customer-app visibility eligibility pipeline. Previously
-- useProviders() only checked is_active/is_verified, so a verified provider
-- with no approved service, no zone coverage, or an out-of-range price could
-- still appear (or a real provider could be invisible with no way for Admin
-- to see why). One function is now the single source of truth for both
-- customer-facing search and the Admin exclusion-reason display.
CREATE OR REPLACE FUNCTION public.provider_eligibility(p_provider_id uuid)
RETURNS TABLE (
  provider_id uuid,
  verified boolean,
  active boolean,
  has_approved_service boolean,
  price_valid boolean,
  zone_covered boolean,
  requirements_met boolean,
  is_eligible boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider RECORD;
  v_has_approved_service boolean := false;
  v_price_valid boolean := false;
  v_zone_covered boolean := false;
  v_requirements_met boolean := true;
BEGIN
  SELECT * INTO v_provider FROM public.providers p WHERE p.id = p_provider_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- At least one approved, active service with a price inside the service's
  -- admin-configured range (base price if no override).
  SELECT
    bool_or(ps.status = 'approved' AND s.is_active),
    bool_or(
      ps.status = 'approved' AND s.is_active
      AND COALESCE(ps.price_override, s.base_price) >= COALESCE(s.minimum_price, 0)
      AND (s.maximum_price IS NULL OR COALESCE(ps.price_override, s.base_price) <= s.maximum_price)
    )
  INTO v_has_approved_service, v_price_valid
  FROM public.provider_services ps
  JOIN public.services s ON s.id = ps.service_id
  WHERE ps.provider_id = p_provider_id;
  v_has_approved_service := COALESCE(v_has_approved_service, false);
  v_price_valid := COALESCE(v_price_valid, false);

  -- Provider is covered by at least one active zone that also carries at
  -- least one of the provider's approved services.
  SELECT EXISTS (
    SELECT 1
    FROM public.zone_providers zp
    JOIN public.zones z ON z.id = zp.zone_id AND z.is_active
    JOIN public.zone_services zs ON zs.zone_id = z.id
    JOIN public.provider_services ps ON ps.service_id = zs.service_id AND ps.provider_id = p_provider_id AND ps.status = 'approved'
  ) INTO v_zone_covered;

  -- Every requirement flagged required_for_provider_approval, on any of the
  -- provider's approved services, must be passed or waived.
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.provider_services ps
    JOIN public.service_requirements sr ON sr.service_id = ps.service_id AND sr.required_for_provider_approval AND sr.is_active
    WHERE ps.provider_id = p_provider_id AND ps.status = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM public.provider_requirement_fulfillments prf
        WHERE prf.provider_id = p_provider_id AND prf.requirement_id = sr.id AND prf.status IN ('passed', 'waived')
      )
  ) INTO v_requirements_met;

  RETURN QUERY SELECT
    p_provider_id,
    v_provider.is_verified,
    v_provider.is_active,
    v_has_approved_service,
    v_price_valid,
    v_zone_covered,
    v_requirements_met,
    (v_provider.is_verified AND v_provider.is_active AND v_has_approved_service AND v_price_valid AND v_zone_covered AND v_requirements_met);
END;
$$;
GRANT EXECUTE ON FUNCTION public.provider_eligibility(uuid) TO authenticated;

-- Customer-search gate: exactly the providers provider_eligibility() marks
-- eligible. LATERAL is fine at closed-beta scale and keeps this in sync with
-- the Admin exclusion-reason breakdown by construction (one function, not
-- duplicated logic).
CREATE OR REPLACE VIEW public.eligible_providers AS
SELECT p.*
FROM public.providers p
CROSS JOIN LATERAL public.provider_eligibility(p.id) e
WHERE e.is_eligible;

GRANT SELECT ON public.eligible_providers TO anon, authenticated;
ALTER VIEW public.eligible_providers SET (security_invoker = true);
