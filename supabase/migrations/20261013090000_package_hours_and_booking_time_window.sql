-- 1. Fixed-start packages need matching working hours.
--    An approved provider offered overnight babysitting (18:00 for 6 hours)
--    with working hours 09:00-17:00. Eligibility only checked that any
--    working-hours rule existed, so customers saw a service with no bookable
--    time. marketplace_eligibility_internal now requires a rule covering the
--    package's whole fixed window. Only the availability check and its
--    failure reason change; the rest is the 20261004130000 body verbatim.
--
-- 2. Providers cannot run a booking's lifecycle far ahead of its time.
--    A test booking for the next day was marked on the way, started and
--    completed the same evening. New trigger (separate from the transition
--    guard, which is unchanged) for provider-initiated changes:
--      confirmed -> on_the_way          from 3 hours before start
--      arrival_confirmed -> in_progress from 30 minutes before start
--      in_progress -> completion_requested from the start time
--    Admins and server paths (no JWT) are not limited. Raises
--    BOOKING_TOO_EARLY so the app can show a clear message.

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
           s.fixed_start_time AS service_fixed_start_time, s.duration_min AS service_duration_min,
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
      -- A fixed-start package (e.g. overnight 18:00 for 6 hours) is only
      -- bookable when at least one working-hours rule covers its whole
      -- window; any valid rule is enough for flexible services.
      EXISTS (
        SELECT 1 FROM public.availability_rules ar
        WHERE ar.provider_id = c.id AND ar.end_time > ar.start_time
          AND (
            c.service_fixed_start_time IS NULL
            OR (
              ar.start_time <= c.service_fixed_start_time
              AND ar.end_time::interval >= c.service_fixed_start_time::interval
                + make_interval(mins => COALESCE(c.service_duration_min, 0))
            )
          )
      ) AS availability_valid,
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
      CASE WHEN NOT f.availability_valid THEN CASE WHEN f.service_fixed_start_time IS NOT NULL
        THEN 'Working hours do not cover this package''s fixed time'
        ELSE 'Provider has no valid availability' END END,
      CASE WHEN NOT f.operational_clear THEN 'Provider has a blocking operational incident' END,
      CASE WHEN NOT f.babysitting_bookable THEN 'Babysitting maximum children or age-group capabilities are not declared' END
    ], NULL)::text[]
  FROM final f;
$$;
REVOKE ALL ON FUNCTION public.marketplace_eligibility_internal(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;


CREATE OR REPLACE FUNCTION public.tg_booking_time_window_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_opens_at timestamptz;
BEGIN
  -- Only the booking's own provider is time-limited; everyone else is left
  -- to the transition guard (admins and server paths are never limited).
  IF v_uid IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status
     OR NOT EXISTS (SELECT 1 FROM public.providers p WHERE p.id = OLD.provider_id AND p.profile_id = v_uid)
     OR public.has_role(v_uid, 'admin') THEN
    RETURN NEW;
  END IF;

  v_opens_at := CASE
    WHEN OLD.status = 'confirmed' AND NEW.status = 'on_the_way' THEN OLD.start_at - interval '3 hours'
    WHEN OLD.status = 'arrival_confirmed' AND NEW.status = 'in_progress' THEN OLD.start_at - interval '30 minutes'
    WHEN OLD.status = 'in_progress' AND NEW.status = 'completion_requested' THEN OLD.start_at
  END;

  IF v_opens_at IS NOT NULL AND now() < v_opens_at THEN
    RAISE EXCEPTION 'BOOKING_TOO_EARLY: This step opens at %.', to_char(v_opens_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD HH24:MI')
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_booking_time_window_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_booking_time_window_guard
  BEFORE UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_time_window_guard();
