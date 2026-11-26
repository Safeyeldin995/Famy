-- Online lessons for all of Egypt; in-person stays zone based.
--
-- Online eligibility already ignores zones (marketplace_eligibility_internal
-- returns zone_covered/address_covered = true for service_mode 'online'), and
-- in-person coverage is already the zone_services matrix. This migration adds
-- what is missing around that:
--   1. A governorate vocabulary (27 codes) on customers and providers.
--   2. An admin switch to close online lessons in a governorate
--      (settings.online_availability.closed_governorates, default none),
--      enforced on new online bookings.
--   3. Online-only applications: a DRAFT / NEEDS_CHANGES applicant can choose
--      online or both before approval (submission already skips the zone
--      requirement for offering_mode = 'online').
--   4. "Tell me when you arrive" requests by governorate and service on the
--      existing area_requests table, and an admin summary of them.
-- No existing zone, zone_services row or booking rule changes behaviour.

-- 1. Governorates -----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.egypt_governorate_codes()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT ARRAY[
    'cairo', 'giza', 'alexandria', 'qalyubia', 'sharqia', 'dakahlia', 'gharbia',
    'monufia', 'beheira', 'kafr_el_sheikh', 'damietta', 'port_said', 'ismailia',
    'suez', 'north_sinai', 'south_sinai', 'red_sea', 'faiyum', 'beni_suef',
    'minya', 'asyut', 'sohag', 'qena', 'luxor', 'aswan', 'matrouh', 'new_valley'
  ]::text[];
$$;

REVOKE ALL ON FUNCTION public.egypt_governorate_codes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.egypt_governorate_codes() TO anon, authenticated, service_role;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS governorate text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS governorate text;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_governorate_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_governorate_check
  CHECK (governorate IS NULL OR governorate = ANY (public.egypt_governorate_codes()));

ALTER TABLE public.providers DROP CONSTRAINT IF EXISTS providers_governorate_check;
ALTER TABLE public.providers ADD CONSTRAINT providers_governorate_check
  CHECK (governorate IS NULL OR governorate = ANY (public.egypt_governorate_codes()));

-- The signed-in customer (or provider) records where they live.
CREATE OR REPLACE FUNCTION public.set_my_governorate(p_governorate text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text := lower(btrim(coalesce(p_governorate, '')));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (v_code = ANY (public.egypt_governorate_codes())) THEN
    RAISE EXCEPTION 'invalid_governorate' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles SET governorate = v_code WHERE id = v_uid;
  -- An application under review is read-only (tg_guard_provider_onboarding_fields);
  -- the provider row follows once it is editable again.
  IF public.has_role(v_uid, 'provider') THEN
    UPDATE public.providers
    SET governorate = v_code
    WHERE profile_id = v_uid
      AND onboarding_status NOT IN ('SUBMITTED', 'UNDER_REVIEW');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_governorate(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_governorate(text) TO authenticated;

-- 2. Online availability by governorate -------------------------------------

INSERT INTO public.settings (key, value)
VALUES ('online_availability', '{"closed_governorates": []}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- True unless an admin closed online lessons in that governorate. An unknown
-- or missing governorate is open: closing is an exception, not a gate.
CREATE OR REPLACE FUNCTION public.online_open_for_governorate(p_governorate text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_governorate IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.settings s
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(s.value -> 'closed_governorates') = 'array'
            THEN s.value -> 'closed_governorates'
          ELSE '[]'::jsonb
        END
      ) AS closed(code)
      WHERE s.key = 'online_availability'
        AND closed.code = p_governorate
    );
$$;

REVOKE ALL ON FUNCTION public.online_open_for_governorate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.online_open_for_governorate(text)
  TO anon, authenticated, service_role;

-- New online bookings from a closed governorate are refused. A narrow trigger
-- so the shared marketplace eligibility trigger stays untouched.
CREATE OR REPLACE FUNCTION public.tg_bookings_online_region_open()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_governorate text;
BEGIN
  IF auth.role() = 'service_role' OR NEW.service_mode IS DISTINCT FROM 'online' THEN
    RETURN NEW;
  END IF;
  SELECT governorate INTO v_governorate FROM public.profiles WHERE id = NEW.customer_id;
  IF NOT public.online_open_for_governorate(v_governorate) THEN
    RAISE EXCEPTION 'BOOKING_ONLINE_REGION_CLOSED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_bookings_online_region_open() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bookings_online_region_open ON public.bookings;
CREATE TRIGGER trg_bookings_online_region_open
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_bookings_online_region_open();

-- 3. Online-only applications ------------------------------------------------
-- Re-derived from 20261124130000_provider_online_lesson_settings.sql. The only
-- change: an applicant still in DRAFT or NEEDS_CHANGES may pick online or both
-- (their services are not approved yet; admin review and marketplace
-- eligibility still gate everything). Approved providers keep the old rules.

CREATE OR REPLACE FUNCTION public.provider_update_offering_mode(p_offering_mode text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_mode text := lower(btrim(p_offering_mode));
  v_online_service_count int;
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'provider') IS NOT TRUE THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;

  IF v_mode NOT IN ('in_person', 'online', 'both') THEN
    RAISE EXCEPTION 'Invalid lesson mode.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501';
  END IF;

  IF v_mode IN ('online', 'both')
     AND v_provider.onboarding_status NOT IN ('DRAFT', 'NEEDS_CHANGES') THEN
    IF v_provider.onboarding_status <> 'APPROVED' OR v_provider.is_verified IS NOT TRUE THEN
      RAISE EXCEPTION
        'Only verified approved providers can enable online lessons.'
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*) INTO v_online_service_count
    FROM public.provider_services ps
    JOIN public.services s ON s.id = ps.service_id
    JOIN public.categories c ON c.id = s.category_id
    WHERE ps.provider_id = v_provider.id
      AND ps.status = 'approved'
      AND s.is_active
      AND c.is_active
      AND s.online_allowed
      AND c.online_allowed;

    IF v_online_service_count < 1 THEN
      RAISE EXCEPTION
        'Add and get approval for at least one service that supports online lessons first.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.providers
  SET offering_mode = v_mode
  WHERE id = v_provider.id;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_update_offering_mode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_update_offering_mode(text) TO authenticated;

-- 4. "Tell me when you arrive" by governorate and service --------------------

ALTER TABLE public.area_requests ALTER COLUMN lat DROP NOT NULL;
ALTER TABLE public.area_requests ALTER COLUMN lng DROP NOT NULL;
ALTER TABLE public.area_requests ADD COLUMN IF NOT EXISTS governorate text;
ALTER TABLE public.area_requests
  ADD COLUMN IF NOT EXISTS service_id uuid REFERENCES public.services(id) ON DELETE SET NULL;

ALTER TABLE public.area_requests DROP CONSTRAINT IF EXISTS area_requests_governorate_check;
ALTER TABLE public.area_requests ADD CONSTRAINT area_requests_governorate_check
  CHECK (governorate IS NULL OR governorate = ANY (public.egypt_governorate_codes()));

ALTER TABLE public.area_requests DROP CONSTRAINT IF EXISTS area_requests_location_check;
ALTER TABLE public.area_requests ADD CONSTRAINT area_requests_location_check
  CHECK (
    (lat IS NULL) = (lng IS NULL)
    AND (lat IS NOT NULL OR governorate IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS area_requests_governorate_service_idx
  ON public.area_requests (governorate, service_id);
CREATE INDEX IF NOT EXISTS area_requests_service_idx
  ON public.area_requests (service_id);

-- Counts for the admin: where people want Famy next, and for what.
CREATE OR REPLACE FUNCTION public.admin_area_request_summary()
RETURNS TABLE (
  governorate text,
  service_id uuid,
  service_name_ar text,
  service_name_en text,
  request_count bigint,
  customer_count bigint,
  last_requested_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    ar.governorate,
    ar.service_id,
    s.name_ar,
    s.name_en,
    count(*)::bigint,
    count(DISTINCT ar.user_id)::bigint,
    max(ar.created_at)
  FROM public.area_requests ar
  LEFT JOIN public.services s ON s.id = ar.service_id
  GROUP BY ar.governorate, ar.service_id, s.name_ar, s.name_en
  ORDER BY count(DISTINCT ar.user_id) DESC, max(ar.created_at) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_area_request_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_area_request_summary() TO authenticated;
