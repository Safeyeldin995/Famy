-- Customer booking writes are marketplace-gated. The service role is reserved
-- for trusted operational/QA fixture work and already bypasses table RLS; do
-- not make privileged maintenance fabricate Customer marketplace prerequisites.
CREATE OR REPLACE FUNCTION public.tg_enforce_marketplace_booking_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'customer') OR public.has_role(auth.uid(), 'provider') THEN
    RAISE EXCEPTION 'Customer identity required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.marketplace_eligibility_internal(NEW.provider_id, NEW.service_id, NEW.address_id) e
    WHERE e.is_eligible
  ) THEN
    RAISE EXCEPTION 'Provider is not marketplace eligible for this service and address' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_enforce_marketplace_booking_eligibility() FROM PUBLIC, anon, authenticated;

