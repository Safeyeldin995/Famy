-- Online sessions phase 1: service-mode discovery/booking, online pricing,
-- server-only attendance events, prepaid enforcement, and automatic resolution.
-- Existing providers and bookings stay in-person unless they explicitly opt in.

-- ---------------------------------------------------------------------------
-- 1. Service mode and online-pricing data
-- ---------------------------------------------------------------------------

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS service_mode text NOT NULL DEFAULT 'in_person';

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_service_mode_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_service_mode_check
  CHECK (service_mode IN ('in_person', 'online'));

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS online_allowed boolean NOT NULL DEFAULT false;

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS online_allowed boolean NOT NULL DEFAULT false;

-- The safe rollout default is in_person: every existing provider keeps their
-- current marketplace behaviour until they explicitly choose online or both.
ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS offering_mode text NOT NULL DEFAULT 'in_person';

ALTER TABLE public.providers
  DROP CONSTRAINT IF EXISTS providers_offering_mode_check;
ALTER TABLE public.providers
  ADD CONSTRAINT providers_offering_mode_check
  CHECK (offering_mode IN ('in_person', 'online', 'both'));

ALTER TABLE public.provider_services
  ADD COLUMN IF NOT EXISTS online_price_override numeric(10,2) NULL;

ALTER TABLE public.provider_services
  DROP CONSTRAINT IF EXISTS provider_services_online_price_positive;
ALTER TABLE public.provider_services
  ADD CONSTRAINT provider_services_online_price_positive
  CHECK (online_price_override IS NULL OR online_price_override > 0);

-- The table has broad provider UPDATE privileges. Keep the new live price
-- behind the same approved-provider review boundary as price_override.
CREATE OR REPLACE FUNCTION public.tg_guard_provider_service_price_override()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_onboarding text;
  v_pending_fields_changed boolean;
  v_online_price_changed boolean;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.admin_price_change_review', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_pending_fields_changed :=
      NEW.pending_price_override IS DISTINCT FROM OLD.pending_price_override
      OR NEW.price_change_requested_at IS DISTINCT FROM OLD.price_change_requested_at
      OR NEW.price_change_reason IS DISTINCT FROM OLD.price_change_reason;
    v_online_price_changed :=
      NEW.online_price_override IS DISTINCT FROM OLD.online_price_override;
  ELSE
    v_pending_fields_changed :=
      NEW.pending_price_override IS NOT NULL
      OR NEW.price_change_requested_at IS NOT NULL
      OR NEW.price_change_reason IS NOT NULL;
    v_online_price_changed := NEW.online_price_override IS NOT NULL;
  END IF;

  IF v_pending_fields_changed
     AND current_setting('app.provider_price_change_request', true)
       IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION
      'Price change pending fields must be updated through provider_request_price_change or provider_cancel_price_change.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT'
     OR NEW.price_override IS DISTINCT FROM OLD.price_override
     OR v_online_price_changed THEN
    SELECT p.onboarding_status::text INTO v_onboarding
    FROM public.providers p
    WHERE p.id = NEW.provider_id;

    IF v_onboarding = 'APPROVED' AND NEW.status = 'approved' THEN
      IF v_online_price_changed THEN
        RAISE EXCEPTION
          'Approved providers must have online price changes reviewed by an admin.'
          USING ERRCODE = '42501';
      END IF;
      RAISE EXCEPTION
        'Approved providers must request price changes through provider_request_price_change.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_guard_provider_service_price_override()
  FROM PUBLIC, anon, authenticated;

ALTER TABLE public.provider_teaching_capabilities
  ADD COLUMN IF NOT EXISTS online_session_price numeric(10,2) NULL;

ALTER TABLE public.provider_teaching_capabilities
  DROP CONSTRAINT IF EXISTS provider_teaching_online_price_positive;
ALTER TABLE public.provider_teaching_capabilities
  ADD CONSTRAINT provider_teaching_online_price_positive
  CHECK (online_session_price IS NULL OR online_session_price > 0);

-- This table uses column-level SELECT grants. Expose the customer-safe online
-- price while keeping review notes and other private fields hidden.
GRANT SELECT (online_session_price)
  ON public.provider_teaching_capabilities TO anon, authenticated;

COMMENT ON COLUMN public.bookings.service_mode IS
  'How the booked service is delivered: in_person or online.';
COMMENT ON COLUMN public.providers.offering_mode IS
  'Delivery modes the provider currently offers: in_person, online, or both.';

-- bookings.address_id was created nullable, so online bookings need no
-- destructive address-column alteration.

-- Merge the online commission into billing without replacing an admin value.
-- A missing billing row has no in-person commission, so both values are null.
INSERT INTO public.settings (key, value)
VALUES ('billing', jsonb_build_object('commission_percent_online', NULL))
ON CONFLICT (key) DO NOTHING;

UPDATE public.settings
SET value = value || jsonb_build_object(
  'commission_percent_online',
  value->'commission_percent'
)
WHERE key = 'billing'
  AND NOT (value ? 'commission_percent_online');

-- Validate both commission keys with the same existing limits.
CREATE OR REPLACE FUNCTION public.tg_validate_billing_settings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_raw jsonb;
  v_percent numeric;
BEGIN
  IF NEW.key IS DISTINCT FROM 'billing' THEN
    RETURN NEW;
  END IF;

  FOREACH v_key IN ARRAY ARRAY['commission_percent', 'commission_percent_online'] LOOP
    v_raw := NEW.value->v_key;
    IF v_raw IS NULL OR v_raw = 'null'::jsonb THEN
      CONTINUE;
    END IF;

    IF jsonb_typeof(v_raw) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION
        'BILLING_INVALID_COMMISSION: % must be null or a number from 0 to 50 with at most 2 decimal places.',
        v_key
        USING ERRCODE = '23514';
    END IF;

    BEGIN
      v_percent := (NEW.value->>v_key)::numeric;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION
          'BILLING_INVALID_COMMISSION: % must be null or a number from 0 to 50 with at most 2 decimal places.',
          v_key
          USING ERRCODE = '23514';
    END;

    IF v_percent < 0 OR v_percent > 50 OR v_percent <> round(v_percent, 2) THEN
      RAISE EXCEPTION
        'BILLING_INVALID_COMMISSION: % must be null or a number from 0 to 50 with at most 2 decimal places.',
        v_key
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_validate_billing_settings()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Server-written online-session attendance
-- ---------------------------------------------------------------------------

CREATE TABLE public.session_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  participant text NOT NULL CHECK (participant IN ('customer', 'provider')),
  joined_at timestamptz NOT NULL,
  left_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (left_at IS NULL OR left_at >= joined_at)
);

CREATE UNIQUE INDEX session_events_one_open_participant_idx
  ON public.session_events (booking_id, participant)
  WHERE left_at IS NULL;

CREATE INDEX session_events_booking_timeline_idx
  ON public.session_events (booking_id, joined_at);

ALTER TABLE public.session_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.session_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.session_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.session_events TO service_role;

CREATE POLICY session_events_admin_read
  ON public.session_events
  FOR SELECT
  TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));

CREATE POLICY session_events_service_insert
  ON public.session_events
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY session_events_service_update
  ON public.session_events
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 3. Marketplace eligibility by delivery mode
-- Latest body: 20261022120000_pro_rejection_cascade_and_support.sql.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.marketplace_eligibility_internal(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.marketplace_eligibility_internal(
  p_provider_id uuid,
  p_service_id uuid DEFAULT NULL,
  p_address_id uuid DEFAULT NULL,
  p_service_mode text DEFAULT 'in_person'
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH mode AS (
    SELECT COALESCE(NULLIF(btrim(p_service_mode), ''), 'in_person') AS service_mode
  ), candidates AS (
    SELECT
      p.*,
      ps.service_id,
      ps.status AS ps_status,
      ps.price_override,
      ps.online_price_override,
      s.name_en AS service_name_en,
      s.name_ar AS service_name_ar,
      s.is_active AS service_is_active,
      s.online_allowed AS service_online_allowed,
      s.minimum_price,
      s.maximum_price,
      s.provider_pricing_allowed,
      s.fixed_start_time AS service_fixed_start_time,
      s.duration_min AS service_duration_min,
      cat.online_allowed AS category_online_allowed,
      (cat.slug = 'tutoring') AS is_tutoring,
      mode.service_mode,
      CASE
        WHEN cat.slug = 'tutoring' THEN (
          SELECT MIN(
            CASE
              WHEN mode.service_mode = 'online'
                THEN COALESCE(tc.online_session_price, tc.session_price::numeric)
              ELSE tc.session_price::numeric
            END
          )
          FROM public.provider_teaching_capabilities tc
          WHERE tc.provider_id = p.id
            AND tc.service_id = s.id
            AND tc.status = 'approved'
            AND ps.status = 'approved'
            AND (
              CASE
                WHEN mode.service_mode = 'online'
                  THEN COALESCE(tc.online_session_price, tc.session_price::numeric)
                ELSE tc.session_price::numeric
              END
            ) >= COALESCE(s.minimum_price, 0)
            AND (
              s.maximum_price IS NULL
              OR (
                CASE
                  WHEN mode.service_mode = 'online'
                    THEN COALESCE(tc.online_session_price, tc.session_price::numeric)
                  ELSE tc.session_price::numeric
                END
              ) <= s.maximum_price
            )
        )
        WHEN mode.service_mode = 'online'
          THEN COALESCE(ps.online_price_override, ps.price_override)
        ELSE COALESCE(ps.price_override, p.hourly_rate)
      END AS effective_price
    FROM public.providers p
    JOIN public.provider_services ps ON ps.provider_id = p.id
    JOIN public.services s ON s.id = ps.service_id
    JOIN public.categories cat ON cat.id = s.category_id
    CROSS JOIN mode
    WHERE p.id = p_provider_id
      AND (p_service_id IS NULL OR ps.service_id = p_service_id)
      AND mode.service_mode IN ('in_person', 'online')
  ), checks AS (
    SELECT
      c.*,
      EXISTS (
        SELECT 1 FROM public.user_roles r
        WHERE r.user_id = c.profile_id AND r.role = 'provider'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles r
        WHERE r.user_id = c.profile_id AND r.role = 'customer'
      ) AS identity_valid,
      (
        c.is_active
        AND c.deleted_at IS NULL
        AND NOT c.vacation_mode
        AND c.onboarding_status = 'APPROVED'
      ) AS account_active,
      (c.is_verified AND c.onboarding_status = 'APPROVED') AS provider_verified,
      (c.ps_status = 'approved') AS service_approved,
      c.service_is_active AS service_active,
      CASE
        WHEN c.service_mode = 'online' THEN
          c.service_online_allowed
          AND c.category_online_allowed
          AND c.offering_mode IN ('online', 'both')
        ELSE c.offering_mode IN ('in_person', 'both')
      END AS service_mode_allowed,
      CASE
        WHEN c.is_tutoring THEN c.effective_price IS NOT NULL
        ELSE COALESCE(
          c.effective_price > 0
          AND c.effective_price >= COALESCE(c.minimum_price, 0)
          AND (c.maximum_price IS NULL OR c.effective_price <= c.maximum_price)
          AND (
            c.service_mode <> 'online'
            OR (
              c.online_price_override IS NULL
              AND c.price_override IS NULL
            )
            OR c.provider_pricing_allowed
          ),
          false
        )
      END AS price_valid,
      NOT EXISTS (
        SELECT 1 FROM public.service_requirements sr
        WHERE sr.service_id = c.service_id
          AND sr.is_active
          AND sr.required_for_provider_approval
          AND NOT EXISTS (
            SELECT 1 FROM public.provider_requirement_fulfillments f
            WHERE f.provider_id = c.id
              AND f.requirement_id = sr.id
              AND f.status IN ('passed', 'waived')
          )
      ) AS requirements_complete,
      NOT EXISTS (
        SELECT 1 FROM public.service_requirements sr
        WHERE sr.service_id = c.service_id
          AND sr.is_active
          AND sr.required_for_provider_approval
          AND sr.evidence_required
          AND NOT EXISTS (
            SELECT 1 FROM public.provider_requirement_fulfillments f
            WHERE f.provider_id = c.id
              AND f.requirement_id = sr.id
              AND (
                f.status = 'waived'
                OR (
                  f.status = 'passed'
                  AND f.evidence_storage_path IS NOT NULL
                )
              )
          )
      ) AS evidence_approved,
      CASE
        WHEN c.service_mode = 'online' THEN true
        ELSE EXISTS (
          SELECT 1 FROM public.zones z
          JOIN public.zone_services zs
            ON zs.zone_id = z.id AND zs.service_id = c.service_id
          JOIN public.zone_providers zp
            ON zp.zone_id = z.id AND zp.provider_id = c.id
          WHERE z.is_active
        )
      END AS zone_covered,
      CASE
        WHEN c.service_mode = 'online' THEN true
        WHEN p_address_id IS NULL THEN false
        ELSE EXISTS (
          SELECT 1
          FROM public.addresses a
          JOIN public.zones z ON z.is_active AND (
            (
              z.boundary_type = 'polygon'
              AND public.point_in_polygon(a.lat, a.lng, z.polygon)
            )
            OR (
              z.boundary_type = 'circle'
              AND 6371 * acos(LEAST(1, GREATEST(-1,
                cos(radians(a.lat)) * cos(radians(z.center_lat))
                  * cos(radians(z.center_lng) - radians(a.lng))
                + sin(radians(a.lat)) * sin(radians(z.center_lat))
              ))) <= z.radius_km
            )
          )
          JOIN public.zone_services zs
            ON zs.zone_id = z.id AND zs.service_id = c.service_id
          JOIN public.zone_providers zp
            ON zp.zone_id = z.id AND zp.provider_id = c.id
          WHERE a.id = p_address_id
            AND a.lat IS NOT NULL
            AND a.lng IS NOT NULL
        )
      END AS address_covered,
      EXISTS (
        SELECT 1 FROM public.availability_rules ar
        WHERE ar.provider_id = c.id
          AND ar.end_time > ar.start_time
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
        WHERE pi.provider_id = c.id
          AND pi.status IN ('open', 'investigating')
          AND pi.severity IN ('high', 'critical')
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
    SELECT
      x.*,
      (
        x.identity_valid
        AND x.account_active
        AND x.provider_verified
        AND x.service_approved
        AND x.service_active
        AND x.service_mode_allowed
        AND x.price_valid
        AND x.requirements_complete
        AND x.evidence_approved
        AND x.zone_covered
        AND (x.service_mode = 'online' OR p_address_id IS NULL OR x.address_covered)
        AND x.availability_valid
        AND x.operational_clear
        AND x.not_suspended
        AND x.babysitting_bookable
      ) AS eligible
    FROM checks x
  )
  SELECT
    f.id,
    f.service_id,
    f.service_name_en,
    f.service_name_ar,
    f.identity_valid,
    f.account_active,
    f.provider_verified AS verified,
    f.service_approved,
    f.service_active,
    f.effective_price,
    f.minimum_price,
    f.maximum_price,
    f.price_valid,
    f.requirements_complete,
    f.evidence_approved,
    f.zone_covered,
    f.address_covered,
    f.availability_valid,
    f.operational_clear,
    f.eligible,
    array_remove(ARRAY[
      CASE WHEN NOT f.identity_valid
        THEN 'Identity conflict or missing Provider role' END,
      CASE WHEN NOT f.account_active
        THEN 'Provider account is inactive, not approved, deleted, or in vacation mode' END,
      CASE WHEN NOT f.provider_verified
        THEN 'Provider is not verified or onboarding is not approved' END,
      CASE WHEN NOT f.not_suspended THEN 'Provider is suspended' END,
      CASE WHEN f.ps_status = 'rejected'
        THEN 'Provider-service relationship was rejected by admin' END,
      CASE WHEN f.ps_status = 'pending'
        THEN 'Provider-service relationship is pending admin approval' END,
      CASE WHEN f.ps_status NOT IN ('approved', 'pending', 'rejected')
        THEN 'Provider-service relationship is not approved' END,
      CASE WHEN NOT f.service_active
        THEN 'Service is inactive or hidden from Customers' END,
      CASE WHEN f.service_mode = 'online' AND NOT f.category_online_allowed
        THEN 'This category is not enabled for online sessions' END,
      CASE WHEN f.service_mode = 'online' AND NOT f.service_online_allowed
        THEN 'This service is not enabled for online sessions' END,
      CASE
        WHEN f.service_mode = 'online'
          AND f.offering_mode NOT IN ('online', 'both')
          THEN 'Provider does not offer online sessions'
        WHEN f.service_mode = 'in_person'
          AND f.offering_mode NOT IN ('in_person', 'both')
          THEN 'Provider does not offer in-person sessions'
      END,
      CASE WHEN NOT f.price_valid THEN
        CASE WHEN f.is_tutoring
          THEN 'No approved teaching subject with a valid session price'
          ELSE 'Provider price is missing or outside Admin limits'
        END
      END,
      CASE WHEN NOT f.requirements_complete
        THEN 'Mandatory Provider requirements are incomplete' END,
      CASE WHEN NOT f.evidence_approved
        THEN 'Required evidence is missing or not approved' END,
      CASE WHEN f.service_mode = 'in_person' AND NOT f.zone_covered
        THEN 'Active Provider and Service zone coverage is missing' END,
      CASE
        WHEN f.service_mode = 'in_person'
          AND p_address_id IS NOT NULL
          AND NOT f.address_covered
          THEN 'Customer address is outside applicable active coverage'
      END,
      CASE WHEN NOT f.availability_valid THEN
        CASE WHEN f.service_fixed_start_time IS NOT NULL
          THEN 'Working hours do not cover this package''s fixed time'
          ELSE 'Provider has no valid availability'
        END
      END,
      CASE WHEN NOT f.operational_clear
        THEN 'Provider has a blocking operational incident' END,
      CASE WHEN NOT f.babysitting_bookable
        THEN 'Babysitting maximum children or age-group capabilities are not declared' END
    ], NULL)::text[]
  FROM final f;
$$;

REVOKE ALL ON FUNCTION public.marketplace_eligibility_internal(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Customer marketplace RPCs
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.search_marketplace_providers(uuid, uuid);

CREATE OR REPLACE FUNCTION public.search_marketplace_providers(
  p_service_id uuid DEFAULT NULL,
  p_address_id uuid DEFAULT NULL,
  p_service_mode text DEFAULT 'in_person'
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
  v_mode text := COALESCE(NULLIF(btrim(p_service_mode), ''), 'in_person');
  v_address uuid := CASE WHEN v_mode = 'online' THEN NULL ELSE p_address_id END;
BEGIN
  IF v_uid IS NULL
     OR NOT public.has_role(v_uid, 'customer')
     OR public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Customer identity required' USING ERRCODE = '42501';
  END IF;
  IF v_mode NOT IN ('in_person', 'online') THEN
    RAISE EXCEPTION 'Invalid service mode' USING ERRCODE = '23514';
  END IF;

  IF v_mode = 'in_person' AND v_address IS NULL THEN
    SELECT a.id INTO v_address
    FROM public.addresses a
    WHERE a.user_id = v_uid
    ORDER BY a.is_default DESC, a.created_at ASC
    LIMIT 1;
  END IF;

  IF v_mode = 'in_person' AND (
    v_address IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.addresses a
      WHERE a.id = v_address AND a.user_id = v_uid
    )
  ) THEN
    RAISE EXCEPTION 'A Customer-owned address is required' USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (p.id, s.id)
    p.id,
    pr.full_name,
    pr.avatar_url,
    p.bio_en,
    p.bio_ar,
    e.effective_price,
    p.years_experience,
    p.languages,
    p.city,
    p.is_top_pro,
    p.is_verified,
    p.response_time_min,
    s.id,
    s.slug,
    s.name_en,
    s.name_ar,
    c.slug,
    COALESCE(rs.rating_avg, 0),
    COALESCE(rs.rating_count, 0)::bigint,
    COALESCE(ts.score, 0)
  FROM public.providers p
  JOIN LATERAL public.marketplace_eligibility_internal(
    p.id, p_service_id, v_address, v_mode
  ) e ON e.is_eligible
  JOIN public.profiles pr ON pr.id = p.profile_id
  JOIN public.services s ON s.id = e.service_id
  JOIN public.categories c ON c.id = s.category_id
  LEFT JOIN public.ratings_summary rs ON rs.provider_id = p.id
  LEFT JOIN public.trust_scores ts ON ts.provider_id = p.id
  WHERE public.is_phase1_category_slug(c.slug)
    AND NOT public.provider_cash_debt_blocked(p.id)
  ORDER BY p.id, s.id, p.is_top_pro DESC, COALESCE(rs.rating_avg, 0) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.search_marketplace_providers(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_marketplace_providers(uuid, uuid, text)
  TO authenticated;

DROP FUNCTION IF EXISTS public.marketplace_provider_bookable_services(uuid, uuid);

CREATE OR REPLACE FUNCTION public.marketplace_provider_bookable_services(
  p_provider_id uuid,
  p_address_id uuid DEFAULT NULL,
  p_service_mode text DEFAULT 'in_person'
)
RETURNS TABLE (service_id uuid, effective_price numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mode text := COALESCE(NULLIF(btrim(p_service_mode), ''), 'in_person');
  v_address uuid := CASE WHEN v_mode = 'online' THEN NULL ELSE p_address_id END;
BEGIN
  IF v_uid IS NULL
     OR NOT public.has_role(v_uid, 'customer')
     OR public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Customer identity required' USING ERRCODE = '42501';
  END IF;
  IF v_mode NOT IN ('in_person', 'online') THEN
    RAISE EXCEPTION 'Invalid service mode' USING ERRCODE = '23514';
  END IF;
  IF public.provider_cash_debt_blocked(p_provider_id) THEN
    RETURN;
  END IF;

  IF v_mode = 'in_person' AND v_address IS NULL THEN
    SELECT a.id INTO v_address
    FROM public.addresses a
    WHERE a.user_id = v_uid
    ORDER BY a.is_default DESC, a.created_at ASC
    LIMIT 1;
  END IF;

  IF v_mode = 'in_person'
     AND v_address IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.addresses a
       WHERE a.id = v_address AND a.user_id = v_uid
     ) THEN
    RAISE EXCEPTION 'Address does not belong to Customer' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT x.service_id, x.effective_price
  FROM public.marketplace_eligibility_internal(
    p_provider_id, NULL, v_address, v_mode
  ) x
  WHERE x.is_eligible;
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_provider_bookable_services(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketplace_provider_bookable_services(uuid, uuid, text)
  TO authenticated;

DROP FUNCTION IF EXISTS public.marketplace_provider_details(uuid, uuid);

CREATE OR REPLACE FUNCTION public.marketplace_provider_details(
  p_provider_id uuid,
  p_address_id uuid DEFAULT NULL,
  p_service_mode text DEFAULT 'in_person'
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
  v_mode text := COALESCE(NULLIF(btrim(p_service_mode), ''), 'in_person');
  v_address uuid := CASE WHEN v_mode = 'online' THEN NULL ELSE p_address_id END;
  v_historical boolean;
BEGIN
  IF v_uid IS NULL
     OR NOT public.has_role(v_uid, 'customer')
     OR public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Customer identity required' USING ERRCODE = '42501';
  END IF;
  IF v_mode NOT IN ('in_person', 'online') THEN
    RAISE EXCEPTION 'Invalid service mode' USING ERRCODE = '23514';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.customer_id = v_uid AND b.provider_id = p_provider_id
  ) INTO v_historical;

  IF v_mode = 'in_person' AND v_address IS NULL THEN
    SELECT a.id INTO v_address
    FROM public.addresses a
    WHERE a.user_id = v_uid
    ORDER BY a.is_default DESC, a.created_at ASC
    LIMIT 1;
  END IF;

  IF v_mode = 'in_person'
     AND v_address IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.addresses a
       WHERE a.id = v_address AND a.user_id = v_uid
     ) THEN
    RAISE EXCEPTION 'Address does not belong to Customer' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    pr.full_name,
    pr.avatar_url,
    p.bio_en,
    p.bio_ar,
    COALESCE(e.effective_price, p.hourly_rate),
    p.years_experience,
    p.languages,
    p.city,
    p.is_top_pro,
    p.is_verified,
    p.response_time_min,
    s.id,
    s.slug,
    s.name_en,
    s.name_ar,
    c.slug,
    COALESCE(rs.rating_avg, 0),
    COALESCE(rs.rating_count, 0)::bigint,
    COALESCE(ts.score, 0)
  FROM public.providers p
  JOIN public.profiles pr ON pr.id = p.profile_id
  LEFT JOIN LATERAL (
    SELECT x.*
    FROM public.marketplace_eligibility_internal(
      p.id, NULL, v_address, v_mode
    ) x
    ORDER BY x.is_eligible DESC, x.service_id
    LIMIT 1
  ) e ON true
  LEFT JOIN public.services s ON s.id = e.service_id
  LEFT JOIN public.categories c ON c.id = s.category_id
  LEFT JOIN public.ratings_summary rs ON rs.provider_id = p.id
  LEFT JOIN public.trust_scores ts ON ts.provider_id = p.id
  WHERE p.id = p_provider_id
    AND (COALESCE(e.is_eligible, false) OR v_historical)
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_provider_details(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketplace_provider_details(uuid, uuid, text)
  TO authenticated;

-- The booking page reads these settings after marketplace revalidation. It
-- needs the same address-free online path as search and provider details.
DROP FUNCTION IF EXISTS public.marketplace_provider_booking_settings(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.marketplace_provider_booking_settings(
  p_provider_id uuid,
  p_service_id uuid DEFAULT NULL,
  p_address_id uuid DEFAULT NULL,
  p_service_mode text DEFAULT 'in_person'
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
  v_mode text := COALESCE(NULLIF(btrim(p_service_mode), ''), 'in_person');
  v_address uuid := CASE WHEN v_mode = 'online' THEN NULL ELSE p_address_id END;
BEGIN
  IF v_uid IS NULL
     OR NOT public.has_role(v_uid, 'customer')
     OR public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Customer identity required' USING ERRCODE = '42501';
  END IF;
  IF v_mode NOT IN ('in_person', 'online') THEN
    RAISE EXCEPTION 'Invalid service mode' USING ERRCODE = '23514';
  END IF;

  IF v_mode = 'in_person' AND v_address IS NULL THEN
    SELECT a.id INTO v_address
    FROM public.addresses a
    WHERE a.user_id = v_uid
    ORDER BY a.is_default DESC, a.created_at ASC
    LIMIT 1;
  END IF;

  IF v_mode = 'in_person' AND (
    v_address IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.addresses a
      WHERE a.id = v_address AND a.user_id = v_uid
    )
  ) THEN
    RAISE EXCEPTION 'A Customer-owned address is required' USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
  SELECT p.vacation_mode, p.min_notice_hours, p.max_advance_days, p.buffer_minutes
  FROM public.providers p
  JOIN LATERAL public.marketplace_eligibility_internal(
    p.id, p_service_id, v_address, v_mode
  ) e ON e.is_eligible
  WHERE p.id = p_provider_id
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_provider_booking_settings(uuid, uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketplace_provider_booking_settings(uuid, uuid, uuid, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Booking RPC and authoritative marketplace guard
-- Latest create_booking body: 20261112140000_provider_settlements_ledger.sql.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.booking_request_fingerprint(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, text, uuid, jsonb,
  uuid, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.booking_request_fingerprint(
  p_provider_id uuid,
  p_service_id uuid,
  p_address_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_family_member_id uuid,
  p_notes text,
  p_promo_code_id uuid,
  p_requirement_selections jsonb,
  p_teaching_capability_id uuid DEFAULT NULL,
  p_teaching_subject_code text DEFAULT NULL,
  p_teaching_curriculum_code text DEFAULT NULL,
  p_teaching_level_code text DEFAULT NULL,
  p_supervision_mode text DEFAULT NULL,
  p_service_mode text DEFAULT 'in_person'
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  -- Keep the legacy in-person fingerprint byte-for-byte compatible so a retry
  -- of a pre-migration request still replays. Online adds a distinct component.
  SELECT concat_ws(
    '|',
    p_provider_id::text,
    p_service_id::text,
    p_address_id::text,
    p_start_at::text,
    p_end_at::text,
    coalesce(p_family_member_id::text, ''),
    coalesce(p_notes, ''),
    coalesce(p_promo_code_id::text, ''),
    coalesce(p_requirement_selections::text, '[]'),
    coalesce(p_teaching_capability_id::text, ''),
    coalesce(p_teaching_subject_code, ''),
    coalesce(p_teaching_curriculum_code, ''),
    coalesce(p_teaching_level_code, ''),
    coalesce(p_supervision_mode, ''),
    CASE
      WHEN COALESCE(NULLIF(btrim(p_service_mode), ''), 'in_person') = 'in_person'
        THEN NULL
      ELSE COALESCE(NULLIF(btrim(p_service_mode), ''), 'in_person')
    END
  );
$$;

REVOKE ALL ON FUNCTION public.booking_request_fingerprint(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, text, uuid, jsonb,
  uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb,
  uuid, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.create_booking(
  p_provider_id uuid,
  p_service_id uuid,
  p_address_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_idempotency_key uuid,
  p_family_member_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_promo_code_id uuid DEFAULT NULL,
  p_requirement_selections jsonb DEFAULT '[]'::jsonb,
  p_teaching_capability_id uuid DEFAULT NULL,
  p_teaching_subject_code text DEFAULT NULL,
  p_teaching_curriculum_code text DEFAULT NULL,
  p_teaching_level_code text DEFAULT NULL,
  p_supervision_mode text DEFAULT NULL,
  p_service_mode text DEFAULT 'in_person'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mode text := COALESCE(NULLIF(btrim(p_service_mode), ''), 'in_person');
  v_address uuid;
  v_fingerprint text;
  v_existing RECORD;
  v_booking_id uuid;
  v_created boolean := false;
  v_min_hours_before_start numeric;
  v_provider_min_notice integer;
  v_required_hours numeric;
  v_category_slug text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '42501';
  END IF;
  IF public.is_not_suspended(v_uid) IS NOT TRUE THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Account is suspended.'
      USING ERRCODE = '42501';
  END IF;
  IF v_mode NOT IN ('in_person', 'online') THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Invalid service mode.'
      USING ERRCODE = '23514';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Idempotency key is required.'
      USING ERRCODE = '23514';
  END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Invalid booking time range.'
      USING ERRCODE = '23514';
  END IF;

  -- Online bookings never retain an unrelated address reference.
  v_address := CASE WHEN v_mode = 'online' THEN NULL ELSE p_address_id END;

  SELECT cat.slug INTO v_category_slug
  FROM public.services s
  JOIN public.categories cat ON cat.id = s.category_id
  WHERE s.id = p_service_id;

  IF v_category_slug IN ('babysitting', 'tutoring') THEN
    IF p_supervision_mode IS NULL
       OR p_supervision_mode NOT IN ('cameras', 'adult_present') THEN
      RAISE EXCEPTION
        'BOOKING_SUPERVISION_REQUIRED: Choose how your child will be supervised during this service.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  v_fingerprint := public.booking_request_fingerprint(
    p_provider_id,
    p_service_id,
    v_address,
    p_start_at,
    p_end_at,
    p_family_member_id,
    p_notes,
    p_promo_code_id,
    coalesce(p_requirement_selections, '[]'::jsonb),
    p_teaching_capability_id,
    p_teaching_subject_code,
    p_teaching_curriculum_code,
    p_teaching_level_code,
    p_supervision_mode,
    v_mode
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':' || p_idempotency_key::text, 0)
  );

  SELECT id, request_fingerprint INTO v_existing
  FROM public.bookings
  WHERE customer_id = v_uid AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION
        'BOOKING_DUPLICATE_REQUEST_CONFLICT: Idempotency key reused with different booking details.'
        USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object(
      'booking_id', v_existing.id,
      'created', false,
      'idempotent_replay', true
    );
  END IF;

  SELECT s.min_hours_before_start INTO v_min_hours_before_start
  FROM public.booking_expiry_settings() s;

  SELECT min_notice_hours INTO v_provider_min_notice
  FROM public.providers
  WHERE id = p_provider_id;

  v_required_hours := GREATEST(
    COALESCE(v_min_hours_before_start, 2),
    COALESCE(v_provider_min_notice, 0)::numeric
  );
  IF p_start_at < now() + (v_required_hours * interval '1 hour') THEN
    RAISE EXCEPTION
      'BOOKING_INVALID_BOOKING_REQUEST: This start time is too soon for the provider to respond in time.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.marketplace_eligibility_internal(
      p_provider_id, p_service_id, v_address, v_mode
    ) e
    WHERE e.is_eligible
  ) THEN
    RAISE EXCEPTION
      'BOOKING_PROVIDER_INELIGIBLE: Provider is not eligible for this service mode and address.'
      USING ERRCODE = '23514';
  END IF;

  IF public.provider_cash_debt_blocked(p_provider_id) THEN
    RAISE EXCEPTION
      'BOOKING_PROVIDER_SETTLEMENT_BLOCKED: Provider cannot receive new bookings until platform balance is settled.'
      USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.create_booking_in_progress', 'on', true);

  BEGIN
    INSERT INTO public.bookings (
      customer_id,
      provider_id,
      service_id,
      address_id,
      start_at,
      end_at,
      status,
      notes,
      family_member_id,
      requirement_selections,
      promo_code_id,
      price_subtotal,
      price_discount,
      price_total,
      price_platform_fee,
      price_vat,
      price_extras_total,
      price_travel_fee,
      idempotency_key,
      request_fingerprint,
      currency,
      teaching_capability_id,
      teaching_subject_code,
      teaching_curriculum_code,
      teaching_level_code,
      supervision_mode,
      service_mode
    ) VALUES (
      v_uid,
      p_provider_id,
      p_service_id,
      v_address,
      p_start_at,
      p_end_at,
      'pending',
      NULLIF(btrim(p_notes), ''),
      p_family_member_id,
      coalesce(p_requirement_selections, '[]'::jsonb),
      p_promo_code_id,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      p_idempotency_key,
      v_fingerprint,
      'EGP',
      p_teaching_capability_id,
      NULLIF(btrim(p_teaching_subject_code), ''),
      NULLIF(btrim(p_teaching_curriculum_code), ''),
      NULLIF(btrim(p_teaching_level_code), ''),
      p_supervision_mode,
      v_mode
    )
    RETURNING id INTO v_booking_id;
    v_created := true;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id, request_fingerprint INTO v_existing
      FROM public.bookings
      WHERE customer_id = v_uid AND idempotency_key = p_idempotency_key;

      IF FOUND AND v_existing.request_fingerprint = v_fingerprint THEN
        RETURN jsonb_build_object(
          'booking_id', v_existing.id,
          'created', false,
          'idempotent_replay', true
        );
      END IF;
      RAISE EXCEPTION
        'BOOKING_DUPLICATE_REQUEST_CONFLICT: Concurrent duplicate booking request.'
        USING ERRCODE = '23514';
    WHEN exclusion_violation THEN
      RAISE EXCEPTION
        'BOOKING_SLOT_UNAVAILABLE: That time slot is no longer available.'
        USING ERRCODE = '23514';
    WHEN SQLSTATE '23514' THEN
      RAISE;
    WHEN SQLSTATE '42501' THEN
      RAISE;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'BOOKING_%' THEN
        RAISE;
      END IF;
      RAISE EXCEPTION
        'BOOKING_INVALID_BOOKING_REQUEST: Unable to create booking.'
        USING ERRCODE = '23514';
  END;

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'created', v_created,
    'idempotent_replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb,
  uuid, text, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb,
  uuid, text, text, text, text, text
) TO authenticated;

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

  IF auth.uid() IS NULL
     OR NOT public.has_role(auth.uid(), 'customer')
     OR public.has_role(auth.uid(), 'provider') THEN
    RAISE EXCEPTION 'Customer identity required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.marketplace_eligibility_internal(
      NEW.provider_id, NEW.service_id, NEW.address_id, NEW.service_mode
    ) e
    WHERE e.is_eligible
  ) THEN
    RAISE EXCEPTION
      'Provider is not marketplace eligible for this service mode and address'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_enforce_marketplace_booking_eligibility()
  FROM PUBLIC, anon, authenticated;

-- service_mode is part of the immutable booking identity. The existing
-- transition guard predates this column, so use a narrow trigger rather than
-- replacing its large lifecycle body.
CREATE OR REPLACE FUNCTION public.tg_lock_booking_service_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.service_mode IS DISTINCT FROM OLD.service_mode THEN
    RAISE EXCEPTION 'Booking service mode cannot be changed after creation.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_lock_booking_service_mode()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lock_booking_service_mode ON public.bookings;
CREATE TRIGGER trg_lock_booking_service_mode
  BEFORE UPDATE OF service_mode ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_lock_booking_service_mode();

-- ---------------------------------------------------------------------------
-- 6. Authoritative online pricing and commission snapshot
-- Latest body: 20261001130000_tutoring_teaching_capabilities.sql.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_validate_booking_service()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_addr RECORD;
  v_zone RECORD;
  v_service RECORD;
  v_ps RECORD;
  v_provider_hourly_rate numeric(10,2);
  v_provider_offering_mode text;
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
  v_rpc_insert boolean :=
    current_setting('app.create_booking_in_progress', true) = 'on';
  v_commission_percent numeric(5,2);
  v_commission_base numeric(10,2);
  v_category_slug text;
  v_category_online_allowed boolean;
  v_tut RECORD;
BEGIN
  IF NEW.service_mode NOT IN ('in_person', 'online') THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Invalid service mode.'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_service
  FROM public.services
  WHERE id = NEW.service_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'BOOKING_SERVICE_UNAVAILABLE: Selected service is not currently available.'
      USING ERRCODE = '23514';
  END IF;

  SELECT c.slug, c.online_allowed
    INTO v_category_slug, v_category_online_allowed
  FROM public.categories c
  WHERE c.id = v_service.category_id;

  SELECT * INTO v_ps
  FROM public.provider_services
  WHERE provider_id = NEW.provider_id
    AND service_id = NEW.service_id
    AND status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'BOOKING_PROVIDER_INELIGIBLE: This provider is not approved to offer the selected service.'
      USING ERRCODE = '23514';
  END IF;

  SELECT p.hourly_rate, p.offering_mode
    INTO v_provider_hourly_rate, v_provider_offering_mode
  FROM public.providers p
  WHERE p.id = NEW.provider_id;

  IF NEW.service_mode = 'online' THEN
    IF NOT v_service.online_allowed
       OR NOT COALESCE(v_category_online_allowed, false) THEN
      RAISE EXCEPTION
        'BOOKING_PROVIDER_INELIGIBLE: This service is not enabled for online sessions.'
        USING ERRCODE = '23514';
    END IF;
    IF v_provider_offering_mode NOT IN ('online', 'both') THEN
      RAISE EXCEPTION
        'BOOKING_PROVIDER_INELIGIBLE: This provider does not offer online sessions.'
        USING ERRCODE = '23514';
    END IF;
    NEW.address_id := NULL;
  ELSE
    IF v_provider_offering_mode NOT IN ('in_person', 'both') THEN
      RAISE EXCEPTION
        'BOOKING_PROVIDER_INELIGIBLE: This provider does not offer in-person sessions.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.address_id IS NULL THEN
      RAISE EXCEPTION
        'BOOKING_INVALID_BOOKING_REQUEST: A saved address with a valid location is required to book.'
        USING ERRCODE = '23514';
    END IF;

    SELECT * INTO v_addr
    FROM public.addresses
    WHERE id = NEW.address_id;
    IF NOT FOUND OR v_addr.lat IS NULL OR v_addr.lng IS NULL THEN
      RAISE EXCEPTION
        'BOOKING_INVALID_BOOKING_REQUEST: Selected address has no valid location coordinates.'
        USING ERRCODE = '23514';
    END IF;

    IF v_addr.user_id IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION
        'BOOKING_UNAUTHORIZED: Address does not belong to this customer.'
        USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.zones z
      WHERE z.is_active
        AND (
          (
            z.boundary_type = 'polygon'
            AND public.point_in_polygon(v_addr.lat, v_addr.lng, z.polygon)
          )
          OR (
            z.boundary_type = 'circle'
            AND 6371 * acos(LEAST(1, GREATEST(-1,
              cos(radians(v_addr.lat)) * cos(radians(z.center_lat))
                * cos(radians(z.center_lng) - radians(v_addr.lng))
              + sin(radians(v_addr.lat)) * sin(radians(z.center_lat))
            ))) <= z.radius_km
          )
        )
    ) THEN
      RAISE EXCEPTION
        'BOOKING_ADDRESS_OUTSIDE_ZONE: This area is not currently served.'
        USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.zones z
      JOIN public.zone_services zs
        ON zs.zone_id = z.id AND zs.service_id = NEW.service_id
      JOIN public.zone_providers zp
        ON zp.zone_id = z.id AND zp.provider_id = NEW.provider_id
      WHERE z.is_active
        AND (
          (
            z.boundary_type = 'polygon'
            AND public.point_in_polygon(v_addr.lat, v_addr.lng, z.polygon)
          )
          OR (
            z.boundary_type = 'circle'
            AND 6371 * acos(LEAST(1, GREATEST(-1,
              cos(radians(v_addr.lat)) * cos(radians(z.center_lat))
                * cos(radians(z.center_lng) - radians(v_addr.lng))
              + sin(radians(v_addr.lat)) * sin(radians(z.center_lat))
            ))) <= z.radius_km
          )
        )
    ) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.zones z
        JOIN public.zone_services zs
          ON zs.zone_id = z.id AND zs.service_id = NEW.service_id
        WHERE z.is_active
          AND (
            (
              z.boundary_type = 'polygon'
              AND public.point_in_polygon(v_addr.lat, v_addr.lng, z.polygon)
            )
            OR (
              z.boundary_type = 'circle'
              AND 6371 * acos(LEAST(1, GREATEST(-1,
                cos(radians(v_addr.lat)) * cos(radians(z.center_lat))
                  * cos(radians(z.center_lng) - radians(v_addr.lng))
                + sin(radians(v_addr.lat)) * sin(radians(z.center_lat))
              ))) <= z.radius_km
            )
          )
      ) THEN
        RAISE EXCEPTION
          'BOOKING_ADDRESS_OUTSIDE_ZONE: The selected service is not offered in this area.'
          USING ERRCODE = '23514';
      END IF;
      RAISE EXCEPTION
        'BOOKING_PROVIDER_INELIGIBLE: This provider does not serve the selected area.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.family_member_id IS NOT NULL THEN
    SELECT * INTO v_fm
    FROM public.family_members
    WHERE id = NEW.family_member_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'BOOKING_INVALID_BOOKING_REQUEST: Selected family member was not found.'
        USING ERRCODE = '23514';
    END IF;
    IF v_fm.customer_id IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION
        'BOOKING_UNAUTHORIZED: Selected family member does not belong to this customer.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT v_fm.is_active THEN
      RAISE EXCEPTION
        'BOOKING_INVALID_BOOKING_REQUEST: Selected family member is no longer active.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  PERFORM public.assert_babysitting_booking_eligible(
    NEW.provider_id,
    NEW.service_id,
    NEW.customer_id,
    NEW.family_member_id,
    NEW.start_at
  );

  IF v_category_slug = 'tutoring' THEN
    SELECT * INTO v_tut
    FROM public.assert_tutoring_capability(
      NEW.provider_id,
      NEW.service_id,
      NEW.teaching_capability_id,
      NEW.teaching_subject_code,
      NEW.teaching_curriculum_code,
      NEW.teaching_level_code,
      NEW.start_at,
      NEW.end_at
    );

    IF NEW.service_mode = 'online' THEN
      SELECT COALESCE(cap.online_session_price, cap.session_price::numeric)
        INTO v_expected_subtotal
      FROM public.provider_teaching_capabilities cap
      WHERE cap.id = v_tut.capability_id;

      IF v_expected_subtotal IS NULL
         OR v_expected_subtotal <= 0
         OR (
           v_service.minimum_price IS NOT NULL
           AND v_expected_subtotal < v_service.minimum_price
         )
         OR (
           v_service.maximum_price IS NOT NULL
           AND v_expected_subtotal > v_service.maximum_price
         ) THEN
        RAISE EXCEPTION
          'BOOKING_PROVIDER_INELIGIBLE: Online tutoring price no longer meets pricing rules.'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      v_expected_subtotal := v_tut.session_price;
    END IF;

    NEW.teaching_capability_id := v_tut.capability_id;
    NEW.teaching_subject_code := v_tut.subject_code;
    NEW.teaching_subject_name_en := v_tut.subject_name_en;
    NEW.teaching_subject_name_ar := v_tut.subject_name_ar;
    NEW.teaching_curriculum_code := v_tut.curriculum_code;
    NEW.teaching_curriculum_name_en := v_tut.curriculum_name_en;
    NEW.teaching_curriculum_name_ar := v_tut.curriculum_name_ar;
    NEW.teaching_level_code := v_tut.level_code;
    NEW.teaching_level_name_en := v_tut.level_name_en;
    NEW.teaching_level_name_ar := v_tut.level_name_ar;
    NEW.session_duration_min := v_tut.session_duration_min;
  ELSE
    v_rate := CASE
      WHEN NEW.service_mode = 'online'
        THEN COALESCE(
          v_ps.online_price_override,
          v_ps.price_override
        )
      ELSE COALESCE(v_ps.price_override, v_provider_hourly_rate)
    END;

    IF (
      (
        NEW.service_mode = 'online'
        AND COALESCE(v_ps.online_price_override, v_ps.price_override) IS NOT NULL
      )
      OR (
        NEW.service_mode = 'in_person'
        AND v_ps.price_override IS NOT NULL
      )
    ) AND NOT v_service.provider_pricing_allowed THEN
      RAISE EXCEPTION
        'BOOKING_PROVIDER_INELIGIBLE: Provider price no longer meets pricing rules.'
        USING ERRCODE = '23514';
    END IF;

    IF v_rate IS NULL
       OR v_rate <= 0
       OR (
         v_service.minimum_price IS NOT NULL
         AND v_rate < v_service.minimum_price
       )
       OR (
         v_service.maximum_price IS NOT NULL
         AND v_rate > v_service.maximum_price
       ) THEN
      RAISE EXCEPTION
        'BOOKING_PROVIDER_INELIGIBLE: Provider price no longer meets pricing rules.'
        USING ERRCODE = '23514';
    END IF;

    IF v_service.pricing_model = 'hourly' THEN
      v_hours := EXTRACT(EPOCH FROM (NEW.end_at - NEW.start_at)) / 3600.0;
      v_expected_subtotal := ROUND(v_rate * v_hours, 2);
    ELSE
      v_expected_subtotal := v_rate;
    END IF;
  END IF;

  IF NOT v_rpc_insert
     AND ABS(NEW.price_subtotal - v_expected_subtotal) > 0.01 THEN
    RAISE EXCEPTION
      'BOOKING_INVALID_BOOKING_REQUEST: Booking price does not match the current service price.'
      USING ERRCODE = '23514';
  END IF;

  FOR v_req IN
    SELECT *
    FROM public.service_requirements
    WHERE service_id = NEW.service_id
      AND is_active
      AND required_during_booking
  LOOP
    IF v_req.fulfillment_mode = 'provider' THEN
      v_extras_total := v_extras_total + v_req.provider_extra_fee;
    ELSIF v_req.fulfillment_mode = 'either' THEN
      SELECT elem INTO v_selection
      FROM jsonb_array_elements(
        COALESCE(NEW.requirement_selections, '[]'::jsonb)
      ) elem
      WHERE (elem->>'requirement_id')::uuid = v_req.id
      LIMIT 1;

      IF v_selection IS NULL
         OR (v_selection->>'chosen_by') NOT IN ('customer', 'provider') THEN
        RAISE EXCEPTION
          'BOOKING_INVALID_BOOKING_REQUEST: A choice is required for: %',
          v_req.name_en
          USING ERRCODE = '23514';
      END IF;
      IF v_selection->>'chosen_by' = 'provider' THEN
        v_extras_total := v_extras_total + v_req.provider_extra_fee;
      END IF;
    END IF;
  END LOOP;

  IF v_service.maximum_extras_total IS NOT NULL
     AND v_extras_total > v_service.maximum_extras_total THEN
    RAISE EXCEPTION
      'BOOKING_INVALID_BOOKING_REQUEST: Selected extras exceed the maximum allowed.'
      USING ERRCODE = '23514';
  END IF;

  SELECT value INTO v_billing
  FROM public.settings
  WHERE key = 'billing';

  v_platform_fee := COALESCE((v_billing->>'platform_fee')::numeric, 25);
  v_vat_percent := COALESCE((v_billing->>'vat_percent')::numeric, 14);
  v_vat := ROUND(v_expected_subtotal * v_vat_percent / 100.0);

  IF NEW.service_mode = 'online' THEN
    v_travel_fee := 0;
  ELSE
    SELECT * INTO v_zone
    FROM public.resolve_zone(v_addr.lat, v_addr.lng);
    v_travel_fee := COALESCE(v_zone.travel_fee, 0);
  END IF;

  IF NEW.promo_code_id IS NULL THEN
    v_discount := 0;
    IF NOT v_rpc_insert AND NEW.price_discount IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION
        'BOOKING_INVALID_PROMO: A discount requires a valid promo code.'
        USING ERRCODE = '23514';
    END IF;
    NEW.promo_code := NULL;
    NEW.promo_discount_type := NULL;
    NEW.promo_discount_value := NULL;
    NEW.promo_description_en := NULL;
    NEW.promo_description_ar := NULL;
  ELSE
    SELECT * INTO v_promo
    FROM public.promo_codes
    WHERE id = NEW.promo_code_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'BOOKING_INVALID_PROMO: Selected promo code no longer exists.'
        USING ERRCODE = '23514';
    END IF;
    IF NOT v_promo.is_active THEN
      RAISE EXCEPTION
        'BOOKING_INVALID_PROMO: This promo code is no longer active.'
        USING ERRCODE = '23514';
    END IF;
    IF v_promo.starts_at IS NOT NULL AND now() < v_promo.starts_at THEN
      RAISE EXCEPTION
        'BOOKING_INVALID_PROMO: This promo code is not active yet.'
        USING ERRCODE = '23514';
    END IF;
    IF v_promo.expires_at IS NOT NULL AND now() > v_promo.expires_at THEN
      RAISE EXCEPTION
        'BOOKING_INVALID_PROMO: This promo code has expired.'
        USING ERRCODE = '23514';
    END IF;
    IF v_promo.total_usage_limit IS NOT NULL
       AND v_promo.usage_count >= v_promo.total_usage_limit THEN
      RAISE EXCEPTION
        'BOOKING_INVALID_PROMO: This promo code has reached its usage limit.'
        USING ERRCODE = '23514';
    END IF;
    IF v_expected_subtotal < v_promo.minimum_booking_amount THEN
      RAISE EXCEPTION
        'BOOKING_INVALID_PROMO: Booking does not meet promo minimum amount.'
        USING ERRCODE = '23514';
    END IF;
    IF v_promo.usage_limit_per_customer IS NOT NULL THEN
      SELECT count(*) INTO v_used_by_customer
      FROM public.promo_code_redemptions
      WHERE promo_code_id = v_promo.id
        AND customer_id = NEW.customer_id;

      IF v_used_by_customer >= v_promo.usage_limit_per_customer THEN
        RAISE EXCEPTION
          'BOOKING_INVALID_PROMO: Promo customer usage limit reached.'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    IF v_promo.first_booking_only
       AND EXISTS (
         SELECT 1 FROM public.bookings
         WHERE customer_id = NEW.customer_id
       ) THEN
      RAISE EXCEPTION
        'BOOKING_INVALID_PROMO: Promo is first-booking only.'
        USING ERRCODE = '23514';
    END IF;
    IF v_promo.applicable_scope = 'services' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.promo_code_services
        WHERE promo_code_id = v_promo.id
          AND service_id = NEW.service_id
      ) THEN
        RAISE EXCEPTION
          'BOOKING_INVALID_PROMO: Promo does not apply to this service.'
          USING ERRCODE = '23514';
      END IF;
    ELSIF v_promo.applicable_scope = 'categories' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.promo_code_categories
        WHERE promo_code_id = v_promo.id
          AND category_id = v_service.category_id
      ) THEN
        RAISE EXCEPTION
          'BOOKING_INVALID_PROMO: Promo does not apply to this service.'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    v_discount := CASE v_promo.discount_type
      WHEN 'fixed' THEN v_promo.discount_value
      ELSE ROUND(
        v_expected_subtotal * v_promo.discount_value / 100.0,
        2
      )
    END;
    IF v_promo.maximum_discount IS NOT NULL THEN
      v_discount := LEAST(v_discount, v_promo.maximum_discount);
    END IF;
    v_discount := GREATEST(LEAST(v_discount, v_expected_subtotal), 0);

    IF NOT v_rpc_insert
       AND ABS(NEW.price_discount - v_discount) > 0.01 THEN
      RAISE EXCEPTION
        'BOOKING_INVALID_PROMO: Promo discount does not match current terms.'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.promo_codes
    SET usage_count = usage_count + 1
    WHERE id = v_promo.id;

    NEW.promo_code := v_promo.code;
    NEW.promo_discount_type := v_promo.discount_type;
    NEW.promo_discount_value := v_promo.discount_value;
    NEW.promo_description_en := v_promo.description_en;
    NEW.promo_description_ar := v_promo.description_ar;
  END IF;

  v_expected_total := GREATEST(
    v_expected_subtotal
      + v_platform_fee
      + v_vat
      + v_extras_total
      + v_travel_fee
      - v_discount,
    0
  );

  IF v_rpc_insert THEN
    NEW.price_subtotal := v_expected_subtotal;
    NEW.price_discount := v_discount;
    NEW.price_total := v_expected_total;
  ELSIF ABS(NEW.price_total - v_expected_total) > 0.01 THEN
    RAISE EXCEPTION
      'BOOKING_INVALID_BOOKING_REQUEST: Booking total does not match current price components.'
      USING ERRCODE = '23514';
  END IF;

  NEW.price_platform_fee := v_platform_fee;
  NEW.price_vat := v_vat;
  NEW.price_extras_total := v_extras_total;
  NEW.price_travel_fee := v_travel_fee;

  v_commission_percent := CASE
    WHEN NEW.service_mode = 'online' THEN COALESCE(
      (v_billing->>'commission_percent_online')::numeric,
      (v_billing->>'commission_percent')::numeric
    )
    ELSE (v_billing->>'commission_percent')::numeric
  END;

  IF v_commission_percent IS NULL THEN
    NEW.price_commission_percent := NULL;
    NEW.price_commission_amount := NULL;
    NEW.price_provider_net := NULL;
  ELSE
    v_commission_base := v_expected_subtotal + v_extras_total;
    NEW.price_commission_percent := v_commission_percent;
    NEW.price_commission_amount :=
      ROUND(v_commission_base * v_commission_percent / 100.0, 2);
    NEW.price_provider_net :=
      v_commission_base + v_travel_fee - NEW.price_commission_amount;
  END IF;

  BEGIN
    PERFORM public.check_booking_slot(
      NEW.provider_id, NEW.start_at, NEW.end_at, NULL
    );
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION
        'BOOKING_SLOT_UNAVAILABLE: That time slot is no longer available.'
        USING ERRCODE = '23514';
  END;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_validate_booking_service()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Online bookings are prepaid; cash is rejected server-side
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_snapshot_payment_method()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pm RECORD;
  v_booking_service_mode text;
BEGIN
  IF NEW.payment_method_id IS NULL THEN
    RAISE EXCEPTION 'A payment method is required.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_pm
  FROM public.payment_methods
  WHERE id = NEW.payment_method_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected payment method does not exist.'
      USING ERRCODE = '23514';
  END IF;
  IF NOT v_pm.is_active THEN
    RAISE EXCEPTION 'Selected payment method is not currently available.'
      USING ERRCODE = '23514';
  END IF;

  SELECT b.service_mode INTO v_booking_service_mode
  FROM public.bookings b
  WHERE b.id = NEW.booking_id;

  IF v_booking_service_mode = 'online' AND v_pm.method_type = 'cash' THEN
    RAISE EXCEPTION 'ONLINE_BOOKING_PREPAID_REQUIRED: Cash is not available for online sessions.'
      USING ERRCODE = '23514';
  END IF;

  NEW.payment_method_code := v_pm.code;
  NEW.payment_method_name_en := v_pm.name_en;
  NEW.payment_method_name_ar := v_pm.name_ar;
  NEW.payment_method_type := v_pm.method_type;
  NEW.payment_method_snapshot := jsonb_build_object(
    'instructions_en', v_pm.instructions_en,
    'instructions_ar', v_pm.instructions_ar,
    'public_config', v_pm.public_config
  );

  NEW.method := CASE v_pm.code
    WHEN 'cash_on_delivery' THEN 'cash'::public.payment_method
    WHEN 'instapay' THEN 'instapay'::public.payment_method
    WHEN 'paymob' THEN 'paymob'::public.payment_method
    ELSE NULL
  END;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_snapshot_payment_method()
  FROM PUBLIC, anon, authenticated;

-- Manual-transfer approval must be able to capture an online prepayment before
-- the session. Paymob retains its stricter verified-webhook-only branch.
CREATE OR REPLACE FUNCTION public.tg_validate_payment_capture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_status public.booking_status;
  v_service_mode text;
BEGIN
  IF NEW.status = 'captured'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'captured') THEN
    IF current_setting('app.ledger_internal_capture', true) = 'on' THEN
      RETURN NEW;
    END IF;

    IF COALESCE(NEW.payment_method_code, '') = 'paymob'
       AND COALESCE(NEW.payment_method_type, '') = 'online' THEN
      IF EXISTS (
        SELECT 1
        FROM public.paymob_webhook_events e
        WHERE e.payment_id = NEW.id
          AND e.outcome = 'captured'
      ) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION
        'Paymob online payments can only be captured by the verified webhook.'
        USING ERRCODE = '42501';
    END IF;

    SELECT b.status, b.service_mode
      INTO v_booking_status, v_service_mode
    FROM public.bookings b
    WHERE b.id = NEW.booking_id;

    IF v_service_mode = 'online'
       AND v_booking_status IN ('pending', 'confirmed') THEN
      RETURN NEW;
    END IF;

    IF v_booking_status IS DISTINCT FROM 'completed' THEN
      RAISE EXCEPTION
        'Payment cannot be captured until the booking is completed (current booking status: %)',
        v_booking_status
        USING ERRCODE = '42501';
    END IF;

    IF COALESCE(NEW.payment_method_type, '') = 'cash' THEN
      RETURN NEW;
    END IF;

    IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'This payment method can only be captured after admin review.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_validate_payment_capture()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Online-only provider onboarding does not require a service zone
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.provider_onboarding_completion(p_provider_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider public.providers;
  v_profile public.profiles;
  v_details public.provider_onboarding_details;
  v_service_count int;
  v_zone_count int;
  v_ref_count int;
  v_babysitting boolean;
  v_errors jsonb := '{}'::jsonb;
  v_complete boolean := true;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.providers p
      WHERE p.id = p_provider_id AND p.profile_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Access denied.' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_provider
  FROM public.providers
  WHERE id = p_provider_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_provider.profile_id;
  SELECT * INTO v_details
  FROM public.provider_onboarding_details
  WHERE provider_id = p_provider_id;

  IF v_profile.full_name IS NULL OR btrim(v_profile.full_name) = '' THEN
    v_errors := v_errors || jsonb_build_object('personal', 'legal_name_required');
    v_complete := false;
  END IF;
  IF v_profile.phone IS NULL OR btrim(v_profile.phone) = '' THEN
    v_errors := v_errors || jsonb_build_object('personal', 'phone_required');
    v_complete := false;
  END IF;
  IF v_details.provider_id IS NULL
     OR v_details.date_of_birth IS NULL
     OR v_details.governorate IS NULL
     OR btrim(v_details.governorate) = ''
     OR v_details.area IS NULL
     OR btrim(v_details.area) = ''
     OR v_details.full_address IS NULL
     OR btrim(v_details.full_address) = '' THEN
    v_errors :=
      v_errors || jsonb_build_object('personal', 'personal_details_incomplete');
    v_complete := false;
  END IF;
  IF v_profile.avatar_url IS NULL OR btrim(v_profile.avatar_url) = '' THEN
    v_errors :=
      v_errors || jsonb_build_object('personal', 'profile_photo_required');
    v_complete := false;
  END IF;

  SELECT count(*) INTO v_service_count
  FROM public.provider_services ps
  JOIN public.services s ON s.id = ps.service_id
  JOIN public.categories c ON c.id = s.category_id
  WHERE ps.provider_id = p_provider_id
    AND s.is_active
    AND c.is_active
    AND public.is_phase1_category_slug(c.slug);
  IF v_service_count < 1 THEN
    v_errors := v_errors || jsonb_build_object('services', 'service_required');
    v_complete := false;
  END IF;

  IF COALESCE(v_provider.years_experience, 0) < 0
     OR (
       COALESCE(v_provider.bio_en, '') = ''
       AND COALESCE(v_provider.bio_ar, '') = ''
     ) THEN
    v_errors :=
      v_errors || jsonb_build_object('experience', 'experience_incomplete');
    v_complete := false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.provider_services ps
    JOIN public.services s ON s.id = ps.service_id
    JOIN public.categories c ON c.id = s.category_id
    WHERE ps.provider_id = p_provider_id
      AND c.slug = 'babysitting'
  ) INTO v_babysitting;

  IF v_babysitting AND (
    v_provider.max_children_per_booking IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.provider_age_group_capabilities c
      WHERE c.provider_id = p_provider_id
    )
  ) THEN
    v_errors :=
      v_errors || jsonb_build_object(
        'experience', 'babysitting_details_required'
      );
    v_complete := false;
  END IF;

  SELECT count(*) INTO v_zone_count
  FROM public.zone_providers zp
  JOIN public.zones z ON z.id = zp.zone_id
  WHERE zp.provider_id = p_provider_id AND z.is_active;

  IF v_provider.offering_mode <> 'online' AND v_zone_count < 1 THEN
    v_errors := v_errors || jsonb_build_object('coverage', 'zone_required');
    v_complete := false;
  END IF;

  SELECT count(*) INTO v_ref_count
  FROM public.provider_references
  WHERE provider_id = p_provider_id;
  IF v_ref_count < 1 THEN
    v_errors :=
      v_errors || jsonb_build_object('references', 'reference_required');
    v_complete := false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT public.normalize_reference_phone(phone) AS norm_phone, count(*) AS c
      FROM public.provider_references
      WHERE provider_id = p_provider_id
      GROUP BY 1
      HAVING count(*) > 1
    ) dup
  ) THEN
    v_errors :=
      v_errors || jsonb_build_object(
        'references', 'duplicate_reference_phones'
      );
    v_complete := false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.provider_documents d
    WHERE d.provider_id = p_provider_id AND d.type = 'id_card_front'
  ) THEN
    v_errors :=
      v_errors || jsonb_build_object('documents', 'national_id_required');
    v_complete := false;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.provider_documents d
    WHERE d.provider_id = p_provider_id AND d.type = 'id_card_back'
  ) THEN
    v_errors :=
      v_errors || jsonb_build_object('documents', 'national_id_required');
    v_complete := false;
  END IF;

  IF v_details.accuracy_confirmed_at IS NULL THEN
    v_errors :=
      v_errors || jsonb_build_object(
        'review', 'accuracy_confirmation_required'
      );
    v_complete := false;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'complete', v_complete,
    'errors', v_errors
  );
END;
$$;

REVOKE ALL ON FUNCTION public.provider_onboarding_completion(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_onboarding_completion(uuid)
  TO authenticated;

-- Submission uses the newer minimal checklist, so relax its zone gate too.
CREATE OR REPLACE FUNCTION public.provider_onboarding_submittable(p_provider_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider public.providers;
  v_profile public.profiles;
  v_details public.provider_onboarding_details;
  v_service_count int;
  v_zone_count int;
  v_errors jsonb := '{}'::jsonb;
  v_complete boolean := true;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.providers p
      WHERE p.id = p_provider_id AND p.profile_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Access denied.' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_provider
  FROM public.providers
  WHERE id = p_provider_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_provider.profile_id;
  SELECT * INTO v_details
  FROM public.provider_onboarding_details
  WHERE provider_id = p_provider_id;

  IF v_profile.full_name IS NULL OR btrim(v_profile.full_name) = '' THEN
    v_errors := v_errors || jsonb_build_object('personal', 'legal_name_required');
    v_complete := false;
  END IF;
  IF v_profile.phone IS NULL OR btrim(v_profile.phone) = '' THEN
    v_errors := v_errors || jsonb_build_object('personal', 'phone_required');
    v_complete := false;
  END IF;

  SELECT count(*) INTO v_service_count
  FROM public.provider_services ps
  JOIN public.services s ON s.id = ps.service_id
  JOIN public.categories c ON c.id = s.category_id
  WHERE ps.provider_id = p_provider_id
    AND s.is_active
    AND c.is_active
    AND public.is_phase1_category_slug(c.slug);
  IF v_service_count < 1 THEN
    v_errors := v_errors || jsonb_build_object('services', 'service_required');
    v_complete := false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.provider_services ps
    JOIN public.services s ON s.id = ps.service_id
    JOIN public.categories c ON c.id = s.category_id
    WHERE ps.provider_id = p_provider_id
      AND s.is_active
      AND c.is_active
      AND public.is_phase1_category_slug(c.slug)
      AND c.slug <> 'tutoring'
      AND s.provider_pricing_allowed
      AND (
        (
          CASE
            WHEN v_provider.offering_mode = 'online'
              THEN COALESCE(
                ps.online_price_override,
                ps.price_override
              )
            ELSE COALESCE(ps.price_override, v_provider.hourly_rate)
          END
        ) IS NULL
        OR (
          CASE
            WHEN v_provider.offering_mode = 'online'
              THEN COALESCE(
                ps.online_price_override,
                ps.price_override
              )
            ELSE COALESCE(ps.price_override, v_provider.hourly_rate)
          END
        ) <= 0
        OR (
          s.minimum_price IS NOT NULL
          AND (
            CASE
              WHEN v_provider.offering_mode = 'online'
                THEN COALESCE(
                  ps.online_price_override,
                  ps.price_override
                )
              ELSE COALESCE(ps.price_override, v_provider.hourly_rate)
            END
          ) < s.minimum_price
        )
        OR (
          s.maximum_price IS NOT NULL
          AND (
            CASE
              WHEN v_provider.offering_mode = 'online'
                THEN COALESCE(
                  ps.online_price_override,
                  ps.price_override
                )
              ELSE COALESCE(ps.price_override, v_provider.hourly_rate)
            END
          ) > s.maximum_price
        )
      )
  ) THEN
    v_errors :=
      v_errors || jsonb_build_object('services', 'provider_price_invalid');
    v_complete := false;
  END IF;

  SELECT count(*) INTO v_zone_count
  FROM public.zone_providers zp
  JOIN public.zones z ON z.id = zp.zone_id
  WHERE zp.provider_id = p_provider_id AND z.is_active;

  IF v_provider.offering_mode <> 'online' AND v_zone_count < 1 THEN
    v_errors := v_errors || jsonb_build_object('coverage', 'zone_required');
    v_complete := false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.provider_documents d
    WHERE d.provider_id = p_provider_id AND d.type = 'id_card_front'
  ) THEN
    v_errors :=
      v_errors || jsonb_build_object('documents', 'national_id_required');
    v_complete := false;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.provider_documents d
    WHERE d.provider_id = p_provider_id AND d.type = 'id_card_back'
  ) THEN
    v_errors :=
      v_errors || jsonb_build_object('documents', 'national_id_required');
    v_complete := false;
  END IF;

  IF v_details.accuracy_confirmed_at IS NULL THEN
    v_errors :=
      v_errors || jsonb_build_object(
        'review', 'accuracy_confirmation_required'
      );
    v_complete := false;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'complete', v_complete,
    'errors', v_errors
  );
END;
$$;

REVOKE ALL ON FUNCTION public.provider_onboarding_submittable(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_onboarding_submittable(uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Automatic online-session completion/no-show/refund
-- Lock order is booking row -> customer debt lock -> payment/ledger writes.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_online_session_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_customer_joined_at timestamptz;
  v_provider_joined_at timestamptz;
  v_reporter uuid;
  v_reported_party text;
  v_reason text;
  v_cancellation_fee numeric;
  v_pay public.payments%ROWTYPE;
  v_carried numeric;
  v_fee numeric;
  v_method text;
  v_count integer := 0;
BEGIN
  FOR v_booking IN
    SELECT
      b.*,
      p.profile_id AS provider_user_id
    FROM public.bookings b
    JOIN public.providers p ON p.id = b.provider_id
    WHERE b.service_mode = 'online'
      AND b.status = 'confirmed'
      AND b.start_at + interval '15 minutes' <= now()
      AND EXISTS (
        SELECT 1
        FROM public.payments pay
        WHERE pay.booking_id = b.id
          AND pay.status = 'captured'
          AND COALESCE(pay.payment_method_type, '') IN (
            'online', 'manual_transfer'
          )
      )
    ORDER BY b.start_at, b.id
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    SELECT
      min(se.joined_at) FILTER (
        WHERE se.participant = 'customer'
          AND se.joined_at <= v_booking.start_at + interval '15 minutes'
      ),
      min(se.joined_at) FILTER (
        WHERE se.participant = 'provider'
          AND se.joined_at <= v_booking.start_at + interval '15 minutes'
      )
      INTO v_customer_joined_at, v_provider_joined_at
    FROM public.session_events se
    WHERE se.booking_id = v_booking.id;

    -- A missed 15-minute join deadline takes precedence over a later join.
    IF v_provider_joined_at IS NULL THEN
      v_reporter := v_booking.customer_id;
      v_reported_party := 'provider';
      v_reason :=
        'Automatic online-session resolution: provider did not join within 15 minutes of start.';
      v_cancellation_fee := 0;
    ELSIF v_customer_joined_at IS NULL THEN
      v_reporter := v_booking.provider_user_id;
      v_reported_party := 'customer';
      v_reason :=
        'Automatic online-session resolution: customer did not join within 15 minutes of start.';
      v_cancellation_fee :=
        public.cancellation_fee_for_total(v_booking.price_total);
    ELSIF v_booking.end_at <= now() THEN
      PERFORM set_config('app.auto_complete_in_progress', 'on', true);
      PERFORM set_config('app.audit_reason', 'online_session_auto_complete', true);

      UPDATE public.bookings
      SET status = 'completed',
          session_started_at = COALESCE(
            session_started_at,
            GREATEST(v_customer_joined_at, v_provider_joined_at)
          ),
          session_ended_at = COALESCE(session_ended_at, end_at),
          completion_requested_at = COALESCE(completion_requested_at, end_at),
          completed_at = COALESCE(completed_at, now()),
          status_changed_at = now(),
          status_changed_by = NULL
      WHERE id = v_booking.id
        AND status = 'confirmed';

      IF FOUND THEN
        v_count := v_count + 1;
      END IF;
      CONTINUE;
    ELSE
      CONTINUE;
    END IF;

    -- The booking row is already locked. Take the customer debt advisory lock
    -- before no-show triggers, carried-debt settlement, or ledger writes.
    PERFORM public.lock_customer_debts(v_booking.customer_id);
    PERFORM set_config('app.no_show_in_progress', 'on', true);
    PERFORM set_config(
      'app.audit_reason',
      'online_session_' || v_reported_party || '_no_show',
      true
    );

    UPDATE public.bookings
    SET status = 'no_show',
        no_show_party = v_reported_party,
        no_show_reported_by = v_reporter,
        no_show_reason = v_reason,
        status_changed_at = now(),
        status_changed_by = NULL
    WHERE id = v_booking.id
      AND status = 'confirmed';

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    INSERT INTO public.no_show_reports (
      booking_id,
      reported_by,
      reporter_role,
      reported_party,
      previous_status,
      reason,
      evidence_paths,
      cancellation_fee,
      status,
      admin_notes,
      resolved_at
    ) VALUES (
      v_booking.id,
      v_reporter,
      CASE
        WHEN v_reported_party = 'provider' THEN 'customer'
        ELSE 'provider'
      END,
      v_reported_party,
      v_booking.status,
      v_reason,
      '{}'::text[],
      v_cancellation_fee,
      'resolved',
      'Automatically resolved from server-verified online session attendance.',
      now()
    );

    SELECT * INTO v_pay
    FROM public.payments pay
    WHERE pay.booking_id = v_booking.id
      AND pay.status = 'captured'
      AND COALESCE(pay.payment_method_type, '') IN (
        'online', 'manual_transfer'
      )
    ORDER BY pay.captured_at DESC NULLS LAST, pay.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Paid online booking has no refundable payment.'
        USING ERRCODE = 'P0002';
    END IF;

    v_method := COALESCE(v_pay.payment_method_code, v_pay.payment_method_type);

    -- Preserve the carried-fee policy: earlier debts are settled before this
    -- booking's refund. This is the current admin refund path's lock order.
    v_carried := LEAST(
      public.settle_carried_fees(v_booking.id, v_method, NULL),
      v_pay.amount
    );

    v_fee := LEAST(
      v_cancellation_fee,
      GREATEST(v_pay.amount - v_carried, 0)
    );

    IF v_reported_party = 'customer' THEN
      IF EXISTS (
        SELECT 1
        FROM public.customer_debts d
        WHERE d.booking_id = v_booking.id AND d.status = 'paid'
      ) THEN
        v_fee := 0;
      ELSIF EXISTS (
        SELECT 1
        FROM public.customer_debts d
        JOIN public.bookings cb ON cb.id = d.carried_booking_id
        WHERE d.booking_id = v_booking.id
          AND d.status = 'open'
          AND cb.status::text NOT IN ('cancelled', 'no_show', 'completed')
      ) THEN
        v_fee := 0;
      ELSE
        UPDATE public.customer_debts
        SET status = 'waived',
            resolved_at = now(),
            resolved_by = NULL,
            resolution_note = 'Deducted from the automatic online no-show refund'
        WHERE booking_id = v_booking.id
          AND status = 'open';
      END IF;
    ELSE
      -- Provider no-show: the current booking is refunded in full. Only
      -- unrelated carried fees already owed by the customer are retained.
      v_fee := 0;
    END IF;

    PERFORM set_config('app.ledger_internal_capture', 'on', true);
    UPDATE public.payments
    SET status = CASE
          WHEN v_fee + v_carried > 0
            THEN 'partially_refunded'::public.payment_status
          ELSE 'refunded'::public.payment_status
        END,
        reviewed_by = NULL,
        reviewed_at = now(),
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'refund',
          jsonb_build_object(
            'reference',
              'online-session-auto-' || v_reported_party || '-' || v_booking.id,
            'amount_refunded', v_pay.amount - v_fee - v_carried,
            'cancellation_fee', v_fee,
            'carried_fees', v_carried,
            'recorded_at', now(),
            'recorded_by', NULL,
            'previous_status', v_pay.status,
            'reason', 'online_session_' || v_reported_party || '_no_show'
          )
        )
    WHERE id = v_pay.id;
    PERFORM set_config('app.ledger_internal_capture', 'off', true);

    IF v_fee > 0 THEN
      PERFORM public.ledger_insert_entry(
        v_booking.provider_id,
        v_booking.id,
        'cancellation_fee_provider_share',
        'credit',
        v_fee,
        v_method,
        NULL,
        NULL,
        NULL
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_online_session_bookings()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_online_session_bookings()
  TO service_role;

-- Best-effort scheduling; service_role may invoke the same idempotent function
-- from an external scheduler when pg_cron is unavailable.
DO $$
BEGIN
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE
      'pg_cron extension unavailable (%); schedule resolve_online_session_bookings() externally.',
      SQLERRM;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (
      SELECT 1
      FROM cron.job
      WHERE jobname = 'famy-resolve-online-session-bookings'
    ) THEN
      PERFORM cron.unschedule('famy-resolve-online-session-bookings');
    END IF;
    PERFORM cron.schedule(
      'famy-resolve-online-session-bookings',
      '*/5 * * * *',
      'SELECT public.resolve_online_session_bookings();'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE
      'pg_cron scheduling skipped (%); schedule resolve_online_session_bookings() externally.',
      SQLERRM;
END
$$;

NOTIFY pgrst, 'reload schema';
