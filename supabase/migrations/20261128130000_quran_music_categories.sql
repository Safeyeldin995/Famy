-- Quran and music become their own categories (PO, 28 Nov 2026).
--
-- Before: «تحفيظ قرآن وتجويد» (quran-lessons) and «دروس موسيقى» (music-lessons)
-- sat under «دروس خصوصية» (slug tutoring). Now they live in two new
-- categories, «قرآن» (quran) and «موسيقى» (music). Only services.category_id
-- moves: bookings, provider_services, teaching capabilities, subjects and
-- prices keep their ids, so everything that already exists keeps working.
--
-- The three categories share the same teaching rules (subjects, grades or
-- levels, capability-based prices, online allowed), so every function that
-- treated 'tutoring' as "a teaching category" now accepts all three.
-- Promo codes that were scoped to tutoring keep covering Quran and music.

INSERT INTO public.categories (slug, name_en, name_ar, icon, sort_order, is_active, online_allowed)
VALUES
  ('quran', 'Quran', 'قرآن', 'book-open', 6, true, true),
  ('music', 'Music', 'موسيقى', 'music', 7, true, true)
ON CONFLICT (slug) DO UPDATE
  SET name_en = EXCLUDED.name_en,
      name_ar = EXCLUDED.name_ar,
      icon = EXCLUDED.icon,
      sort_order = EXCLUDED.sort_order,
      is_active = true,
      online_allowed = true,
      updated_at = now();

-- Keep inactive categories after the live ones.
UPDATE public.categories SET sort_order = 8, updated_at = now()
 WHERE slug = 'pet-care' AND sort_order < 8;

UPDATE public.services s
   SET category_id = c.id, updated_at = now()
  FROM public.categories c
 WHERE c.slug = 'quran' AND s.slug = 'quran-lessons' AND s.category_id IS DISTINCT FROM c.id;

UPDATE public.services s
   SET category_id = c.id, updated_at = now()
  FROM public.categories c
 WHERE c.slug = 'music' AND s.slug = 'music-lessons' AND s.category_id IS DISTINCT FROM c.id;

INSERT INTO public.promo_code_categories (promo_code_id, category_id)
SELECT pcc.promo_code_id, nc.id
  FROM public.promo_code_categories pcc
  JOIN public.categories tc ON tc.id = pcc.category_id AND tc.slug = 'tutoring'
  CROSS JOIN public.categories nc
 WHERE nc.slug IN ('quran', 'music')
ON CONFLICT DO NOTHING;

-- is_phase1_category_slug: re-derived from its latest definition on main; only the category check changes.
CREATE OR REPLACE FUNCTION public.is_phase1_category_slug(p_slug text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_slug IN ('babysitting', 'tutoring', 'quran', 'music');
$$;

-- assert_tutoring_capability: re-derived from its latest definition on main; only the category check changes.
CREATE OR REPLACE FUNCTION public.assert_tutoring_capability(
  p_provider_id uuid,
  p_service_id uuid,
  p_capability_id uuid,
  p_subject_code text,
  p_curriculum_code text,
  p_level_code text,
  p_start_at timestamptz,
  p_end_at timestamptz
)
RETURNS TABLE (
  capability_id uuid,
  session_price integer,
  session_duration_min int,
  subject_code text,
  subject_name_en text,
  subject_name_ar text,
  curriculum_code text,
  curriculum_name_en text,
  curriculum_name_ar text,
  level_code text,
  level_name_en text,
  level_name_ar text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_service RECORD;
  v_cap RECORD;
  v_duration_min int;
BEGIN
  SELECT s.*, c.slug AS category_slug
  INTO v_service
  FROM public.services s
  JOIN public.categories c ON c.id = s.category_id
  WHERE s.id = p_service_id;

  IF v_service.category_slug IS NULL OR v_service.category_slug NOT IN ('tutoring', 'quran', 'music') THEN
    RETURN;
  END IF;

  IF p_capability_id IS NULL THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: An approved teaching capability is required to book tutoring.' USING ERRCODE = '23514';
  END IF;

  SELECT
    cap.id, cap.provider_id, cap.service_id, cap.subject_id, cap.status,
    cap.session_duration_min, cap.session_price,
    sub.code AS subject_code, sub.name_en AS subject_name_en, sub.name_ar AS subject_name_ar,
    sub.max_session_duration_min AS subject_max_duration,
    sub.is_active AS subject_active,
    cur.code AS curriculum_code, cur.name_en AS curriculum_name_en, cur.name_ar AS curriculum_name_ar,
    cur.is_active AS curriculum_active,
    lvl.code AS level_code, lvl.name_en AS level_name_en, lvl.name_ar AS level_name_ar,
    lvl.is_active AS level_active
  INTO v_cap
  FROM public.provider_teaching_capabilities cap
  JOIN public.teaching_subjects sub ON sub.id = cap.subject_id
  JOIN public.teaching_curricula cur ON cur.id = cap.curriculum_id
  JOIN public.teaching_levels lvl ON lvl.id = cap.level_id
  WHERE cap.id = p_capability_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Teaching capability was not found.' USING ERRCODE = '23514';
  END IF;
  IF v_cap.subject_active IS NOT TRUE
     OR v_cap.level_active IS NOT TRUE
     OR (COALESCE(v_service.requires_teaching_curriculum, true) AND v_cap.curriculum_active IS NOT TRUE)
  THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Subject, curriculum, or level is no longer active.' USING ERRCODE = '23514';
  END IF;
  IF v_cap.provider_id IS DISTINCT FROM p_provider_id THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Teaching capability does not belong to this provider.' USING ERRCODE = '23514';
  END IF;
  IF v_cap.service_id IS DISTINCT FROM p_service_id THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Teaching capability does not match the selected service.' USING ERRCODE = '23514';
  END IF;
  IF v_cap.status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Teaching capability is not approved.' USING ERRCODE = '23514';
  END IF;
  IF p_subject_code IS DISTINCT FROM v_cap.subject_code
     OR p_curriculum_code IS DISTINCT FROM v_cap.curriculum_code
     OR p_level_code IS DISTINCT FROM v_cap.level_code
  THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Subject, curriculum, or level does not match the selected capability.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.teaching_subject_services tss
    WHERE tss.subject_id = v_cap.subject_id AND tss.service_id = p_service_id
  ) THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Subject is not linked to this service.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.service_teaching_levels stl
    WHERE stl.service_id = p_service_id AND stl.level_id = (
      SELECT level_id FROM public.provider_teaching_capabilities WHERE id = p_capability_id
    )
  ) THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Level is not linked to this service.' USING ERRCODE = '23514';
  END IF;

  v_duration_min := ROUND(EXTRACT(EPOCH FROM (p_end_at - p_start_at)) / 60.0)::int;
  IF v_duration_min IS DISTINCT FROM v_cap.session_duration_min THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Booking duration does not match the capability session length.' USING ERRCODE = '23514';
  END IF;
  IF v_service.allowed_session_durations IS NULL
     OR NOT (v_cap.session_duration_min = ANY (v_service.allowed_session_durations))
     OR v_cap.session_duration_min > v_cap.subject_max_duration
  THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Session duration is not allowed for this subject.' USING ERRCODE = '23514';
  END IF;
  IF (v_service.minimum_price IS NOT NULL AND v_cap.session_price < v_service.minimum_price)
     OR (v_service.maximum_price IS NOT NULL AND v_cap.session_price > v_service.maximum_price)
  THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Capability price no longer meets pricing rules.' USING ERRCODE = '23514';
  END IF;

  capability_id := v_cap.id;
  session_price := v_cap.session_price;
  session_duration_min := v_cap.session_duration_min;
  subject_code := v_cap.subject_code;
  subject_name_en := v_cap.subject_name_en;
  subject_name_ar := v_cap.subject_name_ar;
  curriculum_code := v_cap.curriculum_code;
  curriculum_name_en := v_cap.curriculum_name_en;
  curriculum_name_ar := v_cap.curriculum_name_ar;
  level_code := v_cap.level_code;
  level_name_en := v_cap.level_name_en;
  level_name_ar := v_cap.level_name_ar;
  RETURN NEXT;
END;
$$;

-- marketplace_eligibility_internal: re-derived from its latest definition on main; only the category check changes.
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
      (cat.slug IN ('tutoring', 'quran', 'music')) AS is_tutoring,
      mode.service_mode,
      CASE
        WHEN cat.slug IN ('tutoring', 'quran', 'music') THEN (
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

-- guest_search_online_tutors: re-derived from its latest definition on main; only the category check changes.
CREATE OR REPLACE FUNCTION public.guest_search_online_tutors(
  p_service_id uuid DEFAULT NULL
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
BEGIN
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
    p.id, p_service_id, NULL, 'online'
  ) e ON e.is_eligible
  JOIN public.profiles pr ON pr.id = p.profile_id
  JOIN public.services s ON s.id = e.service_id
  JOIN public.categories c ON c.id = s.category_id
  LEFT JOIN public.ratings_summary rs ON rs.provider_id = p.id
  LEFT JOIN public.trust_scores ts ON ts.provider_id = p.id
  WHERE c.slug IN ('tutoring', 'quran', 'music')
    AND public.is_phase1_category_slug(c.slug)
    AND NOT public.provider_cash_debt_blocked_core(p.id)
  ORDER BY p.id, s.id, p.is_top_pro DESC, COALESCE(rs.rating_avg, 0) DESC;
END;
$$;

-- provider_onboarding_submittable: re-derived from its latest definition on main; only the category check changes.
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
      AND c.slug NOT IN ('tutoring', 'quran', 'music')
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

-- provider_request_service: re-derived from its latest definition on main; only the category check changes.
CREATE OR REPLACE FUNCTION public.provider_request_service(
  p_service_id uuid,
  p_payload jsonb,
  p_idempotency_key uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_service RECORD;
  v_ps public.provider_services;
  v_group jsonb;
  v_level_id uuid;
  v_level_ids uuid[];
  v_req jsonb;
  v_cap_count int := 0;
  v_price int;
  v_max int;
  v_cap jsonb;
  v_existing public.provider_age_group_capabilities;
  v_code text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Request payload must be a JSON object.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501';
  END IF;
  IF v_provider.onboarding_status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Only approved providers can request new services this way.' USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_provider.id::text || ':' || p_idempotency_key::text, 0));
    SELECT * INTO v_ps FROM public.provider_services
    WHERE provider_id = v_provider.id AND request_idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'provider_service_id', v_ps.id, 'idempotent_replay', true);
    END IF;
  END IF;

  SELECT s.*, c.slug AS category_slug
  INTO v_service
  FROM public.services s
  JOIN public.categories c ON c.id = s.category_id
  WHERE s.id = p_service_id AND s.is_active AND c.is_active;
  IF NOT FOUND OR NOT public.is_phase1_category_slug(v_service.category_slug) THEN
    RAISE EXCEPTION 'Service is not available.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_ps
  FROM public.provider_services
  WHERE provider_id = v_provider.id AND service_id = p_service_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_ps.status = 'approved' THEN
      RAISE EXCEPTION 'Service is already active on your profile.' USING ERRCODE = '23514';
    ELSIF v_ps.status = 'pending' THEN
      RAISE EXCEPTION 'You already have a pending request for this service.' USING ERRCODE = '23514';
    ELSIF v_ps.status IN ('rejected', 'removed') THEN
      DELETE FROM public.provider_teaching_capabilities
      WHERE provider_id = v_provider.id AND service_id = p_service_id AND status IN ('pending', 'rejected');
      PERFORM set_config('app.provider_service_lifecycle', '1', true);
      UPDATE public.provider_services
      SET status = 'pending', rejection_reason = NULL, request_idempotency_key = p_idempotency_key
      WHERE id = v_ps.id;
    ELSIF v_ps.status = 'paused' THEN
      RAISE EXCEPTION 'Resume a paused service before submitting a new request.' USING ERRCODE = '23514';
    END IF;
  ELSE
    PERFORM set_config('app.provider_service_request', '1', true);
    INSERT INTO public.provider_services (provider_id, service_id, status, request_idempotency_key)
    VALUES (v_provider.id, p_service_id, 'pending', p_idempotency_key)
    RETURNING * INTO v_ps;
  END IF;

  IF v_service.category_slug IN ('tutoring', 'quran', 'music') THEN
    IF NOT (p_payload ? 'teaching_groups') OR jsonb_typeof(p_payload->'teaching_groups') <> 'array'
       OR jsonb_array_length(p_payload->'teaching_groups') < 1 THEN
      RAISE EXCEPTION 'At least one subject, grade, and session price is required for tutoring services.'
        USING ERRCODE = '23514';
    END IF;
    FOR v_group IN SELECT jsonb_array_elements(p_payload->'teaching_groups') LOOP
      v_level_ids := ARRAY(
        SELECT jsonb_array_elements_text(v_group->'level_ids')::uuid
      );
      PERFORM public.provider_save_teaching_group(
        p_service_id,
        (v_group->>'subject_id')::uuid,
        (v_group->>'curriculum_id')::uuid,
        v_level_ids,
        (v_group->>'session_duration_min')::int,
        (v_group->>'session_price')::int
      );
      v_cap_count := v_cap_count + cardinality(v_level_ids);
    END LOOP;
    IF v_cap_count < 1 THEN
      RAISE EXCEPTION 'At least one subject, grade, and session price is required for tutoring services.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF v_service.provider_pricing_allowed THEN
    IF NOT (p_payload ? 'price_override') OR p_payload->'price_override' IS NULL THEN
      RAISE EXCEPTION 'Session price is required for this service.' USING ERRCODE = '23514';
    END IF;
    v_price := (p_payload->>'price_override')::int;
    IF v_service.minimum_price IS NOT NULL AND v_price < v_service.minimum_price THEN
      RAISE EXCEPTION 'Price is below the allowed minimum.' USING ERRCODE = '23514';
    END IF;
    IF v_service.maximum_price IS NOT NULL AND v_price > v_service.maximum_price THEN
      RAISE EXCEPTION 'Price is above the allowed maximum.' USING ERRCODE = '23514';
    END IF;
    UPDATE public.provider_services SET price_override = v_price WHERE id = v_ps.id;
  END IF;

  IF v_service.category_slug = 'babysitting' THEN
    IF p_payload ? 'max_children_per_booking' THEN
      v_max := (p_payload->>'max_children_per_booking')::int;
      IF v_max IS NULL OR v_max < 1 OR v_max > 6 THEN
        RAISE EXCEPTION 'max_children_per_booking must be between 1 and 6.' USING ERRCODE = '23514';
      END IF;
      PERFORM set_config('app.max_children_declaration', '1', true);
      UPDATE public.providers SET max_children_per_booking = v_max WHERE id = v_provider.id;
    ELSIF v_provider.max_children_per_booking IS NULL THEN
      RAISE EXCEPTION 'Maximum children per booking is required for babysitting.' USING ERRCODE = '23514';
    END IF;

    IF p_payload ? 'age_group_capabilities' THEN
      IF jsonb_typeof(p_payload->'age_group_capabilities') <> 'array' THEN
        RAISE EXCEPTION 'age_group_capabilities must be an array.' USING ERRCODE = '23514';
      END IF;
      PERFORM 1 FROM public.provider_age_group_capabilities
      WHERE provider_id = v_provider.id FOR UPDATE;
      FOR v_cap IN SELECT jsonb_array_elements(p_payload->'age_group_capabilities') LOOP
        v_code := btrim(v_cap->>'age_group_code');
        IF v_code IS NULL OR v_code = '' THEN
          RAISE EXCEPTION 'age_group_code is required.' USING ERRCODE = '23514';
        END IF;
        SELECT * INTO v_existing FROM public.provider_age_group_capabilities
        WHERE provider_id = v_provider.id AND age_group_code = v_code;
        IF NOT FOUND THEN
          INSERT INTO public.provider_age_group_capabilities (
            provider_id, age_group_code, years_experience, note
          ) VALUES (
            v_provider.id, v_code,
            NULLIF(v_cap->>'years_experience', '')::int,
            NULLIF(btrim(v_cap->>'note'), '')
          );
        END IF;
      END LOOP;
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.provider_age_group_capabilities WHERE provider_id = v_provider.id
    ) THEN
      RAISE EXCEPTION 'At least one age group is required for babysitting.' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF p_payload ? 'requirement_fulfillments' AND jsonb_typeof(p_payload->'requirement_fulfillments') = 'array' THEN
    FOR v_req IN SELECT jsonb_array_elements(p_payload->'requirement_fulfillments') LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.service_requirements sr
        WHERE sr.id = (v_req->>'requirement_id')::uuid
          AND sr.service_id = p_service_id
          AND sr.is_active
          AND sr.required_for_provider_approval
      ) THEN
        CONTINUE;
      END IF;
      INSERT INTO public.provider_requirement_fulfillments (
        provider_id, requirement_id, notes, evidence_storage_path
      ) VALUES (
        v_provider.id,
        (v_req->>'requirement_id')::uuid,
        NULLIF(btrim(v_req->>'notes'), ''),
        NULLIF(btrim(v_req->>'evidence_storage_path'), '')
      )
      ON CONFLICT (provider_id, requirement_id) DO UPDATE SET
        notes = COALESCE(EXCLUDED.notes, provider_requirement_fulfillments.notes),
        evidence_storage_path = COALESCE(
          EXCLUDED.evidence_storage_path,
          provider_requirement_fulfillments.evidence_storage_path
        );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'provider_service_id', v_ps.id, 'idempotent_replay', false);
END;
$$;

-- provider_set_online_service_price: re-derived from its latest definition on main; only the category check changes.
CREATE OR REPLACE FUNCTION public.provider_set_online_service_price(
  p_service_id uuid,
  p_price numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_ps public.provider_services;
  v_service RECORD;
  v_price numeric(10,2);
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'provider') IS NOT TRUE THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;

  v_price := round(p_price::numeric, 2);

  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ps
  FROM public.provider_services
  WHERE provider_id = v_provider.id AND service_id = p_service_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider service not found.' USING ERRCODE = '42501';
  END IF;

  SELECT s.*, c.slug AS category_slug, c.online_allowed AS category_online_allowed
  INTO v_service
  FROM public.services s
  JOIN public.categories c ON c.id = s.category_id
  WHERE s.id = p_service_id
    AND s.is_active;

  IF NOT FOUND OR NOT v_service.online_allowed OR NOT v_service.category_online_allowed THEN
    RAISE EXCEPTION 'This service does not support online lessons.' USING ERRCODE = '23514';
  END IF;
  IF v_service.category_slug IN ('tutoring', 'quran', 'music') THEN
    RAISE EXCEPTION 'Use teaching capability settings for online tutoring prices.'
      USING ERRCODE = '23514';
  END IF;

  IF v_price <= 0
     OR (v_service.minimum_price IS NOT NULL AND v_price < v_service.minimum_price)
     OR (v_service.maximum_price IS NOT NULL AND v_price > v_service.maximum_price) THEN
    RAISE EXCEPTION 'Online price must be within the allowed minimum and maximum.'
      USING ERRCODE = '23514';
  END IF;

  IF v_provider.onboarding_status = 'APPROVED' AND v_ps.status = 'approved' THEN
    RAISE EXCEPTION
      'Approved providers must request online price changes through provider_request_online_price_change.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.provider_services
  SET online_price_override = v_price
  WHERE id = v_ps.id;
END;
$$;

-- provider_upsert_teaching_capability: re-derived from its latest definition on main; only the category check changes.
CREATE OR REPLACE FUNCTION public.provider_upsert_teaching_capability(
  p_service_id uuid,
  p_subject_id uuid,
  p_curriculum_id uuid,
  p_level_id uuid,
  p_session_duration_min int,
  p_session_price integer,
  p_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider_id uuid;
  v_service RECORD;
  v_subject RECORD;
  v_curriculum_code text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_provider_id FROM public.providers WHERE profile_id = v_uid;
  IF v_provider_id IS NULL THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Provider profile required.' USING ERRCODE = '42501';
  END IF;

  SELECT s.*, c.slug AS category_slug
  INTO v_service
  FROM public.services s
  JOIN public.categories c ON c.id = s.category_id
  WHERE s.id = p_service_id;
  IF NOT FOUND OR v_service.category_slug IS NULL OR v_service.category_slug NOT IN ('tutoring', 'quran', 'music') THEN
    RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Service is not a tutoring service.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_subject FROM public.teaching_subjects WHERE id = p_subject_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Subject was not found.' USING ERRCODE = '23514';
  END IF;
  IF v_subject.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Subject is not active.' USING ERRCODE = '23514';
  END IF;

  SELECT code INTO v_curriculum_code FROM public.teaching_curricula WHERE id = p_curriculum_id;
  IF v_curriculum_code IS NULL THEN
    RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Curriculum was not found.' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(v_service.requires_teaching_curriculum, true) THEN
    IF v_curriculum_code = 'na' THEN
      RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: School curriculum is required for this service.' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.teaching_curricula WHERE id = p_curriculum_id AND is_active
    ) THEN
      RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Curriculum is not active.' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF v_curriculum_code IS DISTINCT FROM 'na' THEN
      RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: This service does not use a school curriculum.' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.teaching_levels WHERE id = p_level_id
  ) THEN
    RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Level was not found.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.teaching_levels WHERE id = p_level_id AND is_active
  ) THEN
    RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Level is not active.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.service_teaching_levels
    WHERE service_id = p_service_id AND level_id = p_level_id
  ) THEN
    RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Level is not linked to this service.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.teaching_subject_services
    WHERE subject_id = p_subject_id AND service_id = p_service_id
  ) THEN
    RAISE EXCEPTION 'TEACHING_SUBJECT_NOT_LINKED: Subject is not linked to this service.' USING ERRCODE = '23514';
  END IF;

  IF p_session_duration_min IS NULL
     OR p_session_duration_min NOT IN (45, 60, 90, 120, 180)
     OR v_service.allowed_session_durations IS NULL
     OR NOT (p_session_duration_min = ANY (v_service.allowed_session_durations))
     OR p_session_duration_min > v_subject.max_session_duration_min
  THEN
    RAISE EXCEPTION 'TEACHING_INVALID_DURATION: Session duration is not allowed for this subject.' USING ERRCODE = '23514';
  END IF;

  IF p_session_price IS NULL
     OR p_session_price <= 0
     OR (v_service.minimum_price IS NOT NULL AND p_session_price < v_service.minimum_price)
     OR (v_service.maximum_price IS NOT NULL AND p_session_price > v_service.maximum_price)
  THEN
    RAISE EXCEPTION 'TEACHING_INVALID_PRICE: Session price must be whole EGP within the service limits.' USING ERRCODE = '23514';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.provider_teaching_capabilities
    SET service_id = p_service_id,
        subject_id = p_subject_id,
        curriculum_id = p_curriculum_id,
        level_id = p_level_id,
        session_duration_min = p_session_duration_min,
        session_price = p_session_price,
        status = 'pending',
        submitted_at = now(),
        reviewed_by = NULL,
        reviewed_at = NULL,
        review_note = NULL
    WHERE id = p_id AND provider_id = v_provider_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Capability does not belong to this provider.' USING ERRCODE = '42501';
    END IF;
    RETURN v_id;
  END IF;

  INSERT INTO public.provider_teaching_capabilities (
    provider_id, service_id, subject_id, curriculum_id, level_id,
    session_duration_min, session_price, status, submitted_at,
    reviewed_by, reviewed_at, review_note
  ) VALUES (
    v_provider_id, p_service_id, p_subject_id, p_curriculum_id, p_level_id,
    p_session_duration_min, p_session_price, 'pending', now(),
    NULL, NULL, NULL
  )
  ON CONFLICT (provider_id, service_id, subject_id, curriculum_id, level_id)
  DO UPDATE SET
    session_duration_min = EXCLUDED.session_duration_min,
    session_price = EXCLUDED.session_price,
    status = 'pending',
    submitted_at = now(),
    reviewed_by = NULL,
    reviewed_at = NULL,
    review_note = NULL
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- tg_guard_provider_services: re-derived from its latest definition on main; only the category check changes.
CREATE OR REPLACE FUNCTION public.tg_guard_provider_services()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin');
  v_becoming_approved boolean;
  v_category_slug text;
  v_lifecycle_allowed boolean :=
    COALESCE(current_setting('app.provider_service_lifecycle', true), '') = '1';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending' AND NOT v_is_admin THEN
      RAISE EXCEPTION 'New service requests must start pending.' USING ERRCODE = '42501';
    END IF;
    v_becoming_approved := (NEW.status = 'approved');
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT v_is_admin
       AND NOT v_lifecycle_allowed THEN
      RAISE EXCEPTION 'Only admin can change service approval status.' USING ERRCODE = '42501';
    END IF;
    v_becoming_approved := (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved');
  END IF;

  IF v_becoming_approved AND EXISTS (
    SELECT 1 FROM public.service_requirements sr
    WHERE sr.service_id = NEW.service_id AND sr.is_active AND sr.required_for_provider_approval
      AND NOT EXISTS (
        SELECT 1 FROM public.provider_requirement_fulfillments prf
        WHERE prf.provider_id = NEW.provider_id AND prf.requirement_id = sr.id AND prf.status IN ('passed','waived')
      )
  ) THEN
    RAISE EXCEPTION 'This provider has not completed all mandatory requirements for this service.' USING ERRCODE = '23514';
  END IF;

  IF v_becoming_approved THEN
    SELECT c.slug INTO v_category_slug
    FROM public.services s
    JOIN public.categories c ON c.id = s.category_id
    WHERE s.id = NEW.service_id;
    IF v_category_slug IN ('tutoring', 'quran', 'music')
       AND EXISTS (
         SELECT 1 FROM public.providers p
         WHERE p.id = NEW.provider_id AND p.onboarding_status = 'APPROVED'
       )
       AND NOT EXISTS (
      SELECT 1 FROM public.provider_teaching_capabilities tc
      WHERE tc.provider_id = NEW.provider_id
        AND tc.service_id = NEW.service_id
        AND tc.status IN ('pending', 'approved')
    ) THEN
      RAISE EXCEPTION 'Tutoring service requests require at least one subject and grade before approval.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- tg_notify_tutor_demand_on_capability: re-derived from its latest definition on main; only the category check changes.
CREATE OR REPLACE FUNCTION public.tg_notify_tutor_demand_on_capability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offering text;
  r record;
BEGIN
  IF NEW.status <> 'approved'
     OR (TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'approved') THEN
    RETURN NEW;
  END IF;

  SELECT p.offering_mode INTO v_offering
    FROM public.providers p
   WHERE p.id = NEW.provider_id AND p.onboarding_status = 'APPROVED';
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  FOR r IN
    UPDATE public.tutor_demand_requests d
       SET notified_at = now()
     WHERE d.notified_at IS NULL
       AND d.service_id = NEW.service_id
       AND (d.subject_id IS NULL OR d.subject_id = NEW.subject_id)
       AND (d.curriculum_id IS NULL OR d.curriculum_id = NEW.curriculum_id)
       AND (d.level_id IS NULL OR d.level_id = NEW.level_id)
       AND (
         (d.service_mode = 'online' AND COALESCE(v_offering, 'in_person') IN ('online', 'both'))
         OR (d.service_mode = 'in_person' AND COALESCE(v_offering, 'in_person') IN ('in_person', 'both'))
       )
    RETURNING d.id, d.customer_id, d.service_mode, d.subject_id
  LOOP
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      r.customer_id, 'tutor_demand_available', 'system',
      'A tutor is available',
      'A tutor who matches your request just joined. Book a lesson now.',
      'A tutor is available', 'فيه مدرس متاح دلوقتي',
      'A tutor who matches your request just joined. Book a lesson now.',
      'فيه مدرس مناسب لطلبك انضم دلوقتي، احجز درسك',
      jsonb_build_object(
        'demand_request_id', r.id,
        'service_id', NEW.service_id,
        'subject_id', r.subject_id,
        'provider_id', NEW.provider_id,
        'service_mode', r.service_mode
      ),
      CASE WHEN r.service_mode = 'online' THEN '/online/tutors' ELSE '/category/' || COALESCE((
        SELECT c.slug FROM public.services s JOIN public.categories c ON c.id = s.category_id
        WHERE s.id = NEW.service_id
      ), 'tutoring') END
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- tg_validate_booking_service: re-derived from its latest definition on main; only the category check changes.
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

  IF v_category_slug IN ('tutoring', 'quran', 'music') THEN
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

-- create_booking: re-derived from its latest definition on main; only the category check changes.
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
  v_age integer;
  v_supervision text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '42501';
  END IF;
  IF public.is_admin_account(v_uid) THEN
    RAISE EXCEPTION 'admin_account_restricted' USING ERRCODE = 'P0001';
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

  IF v_mode = 'in_person' AND v_category_slug IN ('babysitting', 'tutoring', 'quran', 'music') THEN
    IF p_supervision_mode IS NULL
       OR p_supervision_mode NOT IN ('cameras', 'adult_present') THEN
      RAISE EXCEPTION
        'BOOKING_SUPERVISION_REQUIRED: Choose how your child will be supervised during this service.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Supervision stored on the booking:
  --   in person: the babysitting/tutoring choice validated above (cameras / adult_present);
  --   online:    'parent_online' only when a parent books for their own child and confirms
  --              they will be with the child or supervising; NULL otherwise.
  IF v_mode = 'online' THEN
    v_supervision := CASE
      WHEN p_family_member_id IS NOT NULL AND p_supervision_mode = 'parent_online'
        THEN 'parent_online'
      ELSE NULL
    END;
  ELSIF p_supervision_mode = 'parent_online' THEN
    RAISE EXCEPTION
      'BOOKING_SUPERVISION_REQUIRED: Choose how your child will be supervised during this service.'
      USING ERRCODE = '23514';
  ELSE
    v_supervision := p_supervision_mode;
  END IF;

  IF v_mode = 'online' THEN
    -- Age of the learner: the account owner for «أنا», or the booker's own child
    -- (NULL when the child doesn't belong to the booker).
    v_age := public.booking_online_age_years(v_uid, p_family_member_id);
    IF v_age IS NULL THEN
      RAISE EXCEPTION
        'BOOKING_ONLINE_BIRTH_DATE_REQUIRED: Add a date of birth before booking an online lesson.'
        USING ERRCODE = '23514';
    ELSIF v_age < 12 THEN
      IF p_family_member_id IS NULL THEN
        -- Students booking for themselves stay 12+.
        RAISE EXCEPTION
          'BOOKING_ONLINE_AGE_MINIMUM: Online lessons are available from age 12.'
          USING ERRCODE = '23514';
      ELSIF v_supervision IS DISTINCT FROM 'parent_online' THEN
        -- A parent may book any age for their child, after confirming supervision.
        RAISE EXCEPTION
          'BOOKING_PARENT_SUPERVISION_REQUIRED: Confirm you will be with your child or supervising the lesson.'
          USING ERRCODE = '23514';
      END IF;
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
    v_supervision,
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

  IF public.provider_cash_debt_blocked_core(p_provider_id) THEN
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
      v_supervision,
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
