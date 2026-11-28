-- «الطلبة بيدوروا على إيه»: unmet student demand shown to approved tutors.
--
-- Source: open «بلغني» requests (public.tutor_demand_requests, notified_at IS NULL)
-- from the last 90 days. Tutors only ever see aggregates: no customer, child or
-- request ids, and no names. A governorate is shown only when at least two
-- different customers asked for the same in-person combination there; otherwise
-- the in-person row is folded into a governorate-less «في البيت» row.
--
-- Rows are keyed by service, subject, curriculum and level ids (not category
-- slugs), so moving Quran and music into their own categories does not change
-- this function.

CREATE OR REPLACE FUNCTION public.provider_tutor_demand_insights()
RETURNS TABLE (
  service_id uuid,
  service_slug text,
  service_name_ar text,
  service_name_en text,
  subject_id uuid,
  subject_code text,
  subject_name_ar text,
  subject_name_en text,
  curriculum_id uuid,
  curriculum_code text,
  curriculum_name_ar text,
  curriculum_name_en text,
  level_id uuid,
  level_code text,
  level_label_ar text,
  level_label_en text,
  service_mode text,
  governorate_code text,
  students bigint,
  last_requested_at timestamptz,
  teaches_subject boolean,
  capability_status text,
  mode_fits boolean,
  near_me boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required.' USING ERRCODE = '42501';
  END IF;

  SELECT p.* INTO v_provider
    FROM public.providers p
   WHERE p.profile_id = v_uid
     AND p.onboarding_status = 'APPROVED'
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEMAND_PROVIDER_NOT_APPROVED' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH open_demand AS (
    SELECT d.service_id, d.subject_id, d.curriculum_id, d.level_id, d.service_mode,
           CASE WHEN d.service_mode = 'in_person' THEN d.governorate_code END AS governorate_code,
           d.customer_id, d.family_member_id, d.created_at
      FROM public.tutor_demand_requests d
      JOIN public.services s ON s.id = d.service_id AND s.is_active
     WHERE d.notified_at IS NULL
       AND d.created_at > now() - interval '90 days'
  ),
  place_counts AS (
    -- Distinct customers per exact place, so a governorate is only shown
    -- when it cannot point at a single family.
    SELECT o.service_id, o.subject_id, o.curriculum_id, o.level_id, o.service_mode,
           o.governorate_code, count(DISTINCT o.customer_id) AS place_customers
      FROM open_demand o
     GROUP BY o.service_id, o.subject_id, o.curriculum_id, o.level_id, o.service_mode,
              o.governorate_code
  ),
  by_place AS (
    SELECT o.*, pc.place_customers
      FROM open_demand o
      JOIN place_counts pc
        ON pc.service_id = o.service_id
       AND pc.subject_id IS NOT DISTINCT FROM o.subject_id
       AND pc.curriculum_id IS NOT DISTINCT FROM o.curriculum_id
       AND pc.level_id IS NOT DISTINCT FROM o.level_id
       AND pc.service_mode = o.service_mode
       AND pc.governorate_code IS NOT DISTINCT FROM o.governorate_code
  ),
  safe AS (
    SELECT b.service_id, b.subject_id, b.curriculum_id, b.level_id, b.service_mode,
           CASE WHEN b.place_customers >= 2 THEN b.governorate_code END AS governorate_code,
           b.customer_id, b.family_member_id, b.created_at
      FROM by_place b
  ),
  buckets AS (
    SELECT sf.service_id, sf.subject_id, sf.curriculum_id, sf.level_id, sf.service_mode,
           sf.governorate_code,
           count(DISTINCT (sf.customer_id, sf.family_member_id))::bigint AS students,
           max(sf.created_at) AS last_requested_at
      FROM safe sf
     GROUP BY sf.service_id, sf.subject_id, sf.curriculum_id, sf.level_id,
              sf.service_mode, sf.governorate_code
  )
  SELECT x.* FROM (
  SELECT bk.service_id, s.slug, s.name_ar, s.name_en,
         bk.subject_id, ts.code, ts.name_ar, ts.name_en,
         bk.curriculum_id, c.code, c.name_ar, c.name_en,
         bk.level_id, l.code,
         CASE WHEN l.id IS NULL THEN NULL
              ELSE public.teaching_level_label(l.code, c.level_label_style, 'ar', l.name_ar) END,
         CASE WHEN l.id IS NULL THEN NULL
              ELSE public.teaching_level_label(l.code, c.level_label_style, 'en', l.name_en) END,
         bk.service_mode,
         bk.governorate_code,
         bk.students,
         bk.last_requested_at,
         EXISTS (
           SELECT 1 FROM public.provider_teaching_capabilities ptc
            WHERE ptc.provider_id = v_provider.id
              AND ptc.service_id = bk.service_id
              AND ptc.subject_id IS NOT DISTINCT FROM bk.subject_id
              AND ptc.status IN ('approved', 'pending')
         ) AS teaches_subject,
         (
           SELECT ptc.status FROM public.provider_teaching_capabilities ptc
            WHERE ptc.provider_id = v_provider.id
              AND ptc.service_id = bk.service_id
              AND ptc.subject_id IS NOT DISTINCT FROM bk.subject_id
              AND ptc.curriculum_id IS NOT DISTINCT FROM bk.curriculum_id
              AND ptc.level_id IS NOT DISTINCT FROM bk.level_id
            ORDER BY CASE ptc.status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END
            LIMIT 1
         ) AS capability_status,
         CASE bk.service_mode
           WHEN 'online' THEN COALESCE(v_provider.offering_mode, 'in_person') IN ('online', 'both')
           ELSE COALESCE(v_provider.offering_mode, 'in_person') IN ('in_person', 'both')
         END AS mode_fits,
         (bk.service_mode = 'in_person'
           AND bk.governorate_code IS NOT NULL
           AND bk.governorate_code = v_provider.governorate) AS near_me
    FROM buckets bk
    JOIN public.services s ON s.id = bk.service_id
    LEFT JOIN public.teaching_subjects ts ON ts.id = bk.subject_id
    LEFT JOIN public.teaching_curricula c ON c.id = bk.curriculum_id
    LEFT JOIN public.teaching_levels l ON l.id = bk.level_id
  ) x
  -- What this tutor can take right away first, so the cap never hides it.
  ORDER BY (x.teaches_subject AND x.mode_fits) DESC, (x.near_me AND x.mode_fits) DESC,
           x.students DESC, x.last_requested_at DESC
  LIMIT 50;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_tutor_demand_insights() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_tutor_demand_insights() TO authenticated;

COMMENT ON FUNCTION public.provider_tutor_demand_insights() IS
  'Approved providers only: aggregated open «بلغني» demand (last 90 days). No customer data; a governorate appears only when 2+ customers share it.';
