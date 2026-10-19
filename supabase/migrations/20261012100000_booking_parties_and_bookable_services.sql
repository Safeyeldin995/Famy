-- Booking parties can see each other's display identity, and customers see
-- only the services a provider can actually be booked for.
--
-- 1. booking_party_profiles(p_booking_ids)
--    `profiles` is self-only under RLS, so chat headers fell back to
--    "Famy user" and providers saw "client" with no name. This returns the
--    counterpart's name and avatar for bookings the caller is a party to.
--    The phone number is returned only while the booking is active
--    (confirmed .. completion_requested), the same window in which the
--    provider can already read the booking address. While a request is
--    pending or active the provider also gets the service zone and the
--    family member's first name and age so they can decide; never the exact
--    address, and nothing of this once the booking has ended.
--
-- 2. marketplace_provider_bookable_services(p_provider_id, p_address_id)
--    The customer provider page listed every approved provider_services row,
--    including tutoring services whose subject groups were still under
--    review, so booking them failed with PROVIDER_INELIGIBLE. This exposes
--    only the eligible service ids (no internal failure reasons) using the
--    same eligibility source the booking trigger enforces.

CREATE OR REPLACE FUNCTION public.booking_party_profiles(p_booking_ids uuid[])
RETURNS TABLE (
  booking_id uuid,
  viewer_role text,
  other_user_id uuid,
  other_name text,
  other_avatar_url text,
  other_phone text,
  area text,
  zone_name_en text,
  zone_name_ar text,
  member_first_name text,
  member_age_years integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_booking_ids IS NULL OR cardinality(p_booking_ids) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_booking_ids) > 200 THEN
    RAISE EXCEPTION 'Too many bookings requested' USING ERRCODE = '22023';
  END IF;
  v_admin := public.has_role(v_uid, 'admin');

  RETURN QUERY
  WITH scoped AS (
    SELECT
      b.id,
      b.status,
      b.customer_id,
      pv.profile_id AS provider_user_id,
      CASE
        WHEN b.customer_id = v_uid THEN 'customer'
        WHEN pv.profile_id = v_uid THEN 'provider'
        ELSE 'admin'
      END AS role,
      b.status IN ('confirmed', 'on_the_way', 'arrived', 'arrival_confirmed', 'in_progress', 'completion_requested') AS is_active,
      b.status IN ('pending', 'confirmed', 'on_the_way', 'arrived', 'arrival_confirmed', 'in_progress', 'completion_requested') AS is_open
    FROM public.bookings b
    JOIN public.providers pv ON pv.id = b.provider_id
    WHERE b.id = ANY (p_booking_ids)
      AND b.deleted_at IS NULL
      AND (b.customer_id = v_uid OR pv.profile_id = v_uid OR v_admin)
  )
  SELECT
    s.id,
    s.role,
    other.id,
    NULLIF(btrim(other.full_name), ''),
    other.avatar_url,
    CASE WHEN s.is_active OR s.role = 'admin' THEN other.phone END,
    CASE WHEN s.is_active OR s.role = 'admin' OR s.role = 'customer'
      THEN COALESCE(NULLIF(btrim(bl.area), ''), NULLIF(btrim(bl.city), ''))
    END,
    CASE WHEN s.is_open OR s.role IN ('admin', 'customer') THEN bl.zone_name_en END,
    CASE WHEN s.is_open OR s.role IN ('admin', 'customer') THEN bl.zone_name_ar END,
    CASE WHEN (s.role = 'provider' AND s.is_open) OR s.role = 'admin'
      THEN NULLIF(split_part(btrim(fm.full_name), ' ', 1), '')
    END,
    CASE WHEN ((s.role = 'provider' AND s.is_open) OR s.role = 'admin') AND fm.date_of_birth IS NOT NULL
      THEN date_part('year', age(current_date, fm.date_of_birth))::integer
    END
  FROM scoped s
  JOIN public.profiles other
    ON other.id = CASE WHEN s.role = 'customer' THEN s.provider_user_id ELSE s.customer_id END
  LEFT JOIN public.booking_locations bl ON bl.booking_id = s.id
  LEFT JOIN public.booking_family_member_snapshots fm ON fm.booking_id = s.id;
END;
$$;

REVOKE ALL ON FUNCTION public.booking_party_profiles(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_party_profiles(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.marketplace_provider_bookable_services(
  p_provider_id uuid,
  p_address_id uuid DEFAULT NULL
)
RETURNS TABLE (service_id uuid, effective_price numeric)
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
    SELECT a.id INTO v_address FROM public.addresses a WHERE a.user_id = v_uid
    ORDER BY a.is_default DESC, a.created_at ASC LIMIT 1;
  END IF;
  IF v_address IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.addresses a WHERE a.id = v_address AND a.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Address does not belong to Customer' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT x.service_id, x.effective_price
  FROM public.marketplace_eligibility_internal(p_provider_id, NULL, v_address) x
  WHERE x.is_eligible;
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_provider_bookable_services(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketplace_provider_bookable_services(uuid, uuid) TO authenticated;
