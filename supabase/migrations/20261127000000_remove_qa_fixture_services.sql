-- Remove QA fixture services left in Production by integration tests that ran
-- against Production between 2026-07-19 and 2026-08-02 (PO approved removal).
--
-- Marker: services.slug matching '^qa[-_\s]' (case-insensitive). This is the same
-- rule as src/lib/catalog/qaCatalog.ts (QA_SLUG_RE). Slugs are stable; display names
-- are not used, so the real "Home Cleaning QA_" category is never matched.
--
-- Rules:
--   * A QA service referenced by anything real (booking, provider offer, teaching
--     capability, promo scope, area request, tutor demand) is NOT deleted. It is
--     archived instead (is_active = false, deleted_at set).
--   * Every other QA service is deleted together with its own fixture config rows
--     (service_requirements, zone_services, teaching_subject_services,
--     service_teaching_levels), in FK-safe order.
--   * Payments, wallet entries and reviews hang off bookings, so the bookings
--     check covers them.
-- Idempotent: a second run finds nothing to do.

DO $$
DECLARE
  v_referenced int;
  v_requirements int;
  v_zone_services int;
  v_subject_services int;
  v_teaching_levels int;
  v_services int;
BEGIN
  CREATE TEMP TABLE _qa_services ON COMMIT DROP AS
  SELECT s.id,
         (
           EXISTS (SELECT 1 FROM public.bookings b WHERE b.service_id = s.id)
           OR EXISTS (SELECT 1 FROM public.provider_services ps WHERE ps.service_id = s.id)
           OR EXISTS (SELECT 1 FROM public.provider_teaching_capabilities c WHERE c.service_id = s.id)
           OR EXISTS (SELECT 1 FROM public.promo_code_services p WHERE p.service_id = s.id)
           OR EXISTS (SELECT 1 FROM public.area_requests a WHERE a.service_id = s.id)
           OR EXISTS (SELECT 1 FROM public.tutor_demand_requests t WHERE t.service_id = s.id)
         ) AS referenced
  FROM public.services s
  WHERE s.slug ~* '^qa[-_\s]';

  -- Referenced QA services: archive, never delete.
  UPDATE public.services s
     SET is_active = false,
         deleted_at = COALESCE(s.deleted_at, now())
    FROM _qa_services q
   WHERE q.id = s.id AND q.referenced
     AND (s.is_active OR s.deleted_at IS NULL);
  SELECT count(*) INTO v_referenced FROM _qa_services WHERE referenced;

  -- Unreferenced QA services: delete fixture config first, then the service.
  DELETE FROM public.service_requirements r
   USING _qa_services q WHERE q.id = r.service_id AND NOT q.referenced;
  GET DIAGNOSTICS v_requirements = ROW_COUNT;

  DELETE FROM public.zone_services z
   USING _qa_services q WHERE q.id = z.service_id AND NOT q.referenced;
  GET DIAGNOSTICS v_zone_services = ROW_COUNT;

  DELETE FROM public.teaching_subject_services t
   USING _qa_services q WHERE q.id = t.service_id AND NOT q.referenced;
  GET DIAGNOSTICS v_subject_services = ROW_COUNT;

  DELETE FROM public.service_teaching_levels l
   USING _qa_services q WHERE q.id = l.service_id AND NOT q.referenced;
  GET DIAGNOSTICS v_teaching_levels = ROW_COUNT;

  DELETE FROM public.services s
   USING _qa_services q WHERE q.id = s.id AND NOT q.referenced;
  GET DIAGNOSTICS v_services = ROW_COUNT;

  RAISE NOTICE 'qa fixtures: services deleted=%, archived (referenced)=%, service_requirements=%, zone_services=%, teaching_subject_services=%, service_teaching_levels=%',
    v_services, v_referenced, v_requirements, v_zone_services, v_subject_services, v_teaching_levels;
END
$$;
