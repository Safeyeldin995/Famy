-- Patch 2 audit fix: Customers cannot read providers directly after Patch 2 RLS.
-- Expose only the booking-slot fields needed by /book/:providerId after
-- server-side marketplace eligibility revalidation.
CREATE OR REPLACE FUNCTION public.marketplace_provider_booking_settings(
  p_provider_id uuid,
  p_service_id uuid DEFAULT NULL,
  p_address_id uuid DEFAULT NULL
)
RETURNS TABLE (
  vacation_mode boolean,
  min_notice_hours integer,
  max_advance_days integer,
  buffer_minutes integer
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
    WHERE a.user_id = v_uid
    ORDER BY a.is_default DESC, a.created_at ASC
    LIMIT 1;
  END IF;
  IF v_address IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.addresses a WHERE a.id = v_address AND a.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'A Customer-owned address is required' USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
  SELECT p.vacation_mode, p.min_notice_hours, p.max_advance_days, p.buffer_minutes
  FROM public.providers p
  JOIN LATERAL public.marketplace_eligibility_internal(p.id, p_service_id, v_address) e ON e.is_eligible
  WHERE p.id = p_provider_id
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_provider_booking_settings(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketplace_provider_booking_settings(uuid,uuid,uuid) TO authenticated;
