-- Count pending online price overrides in admin price-change queue (#403).

CREATE OR REPLACE FUNCTION public.admin_work_queue_counts()
RETURNS TABLE(queue text, item_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutoff timestamptz;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT s.completion_auto_from INTO v_cutoff
  FROM public.booking_expiry_settings() s;

  RETURN QUERY
  SELECT 'new_applications'::text, count(*) FROM public.providers p
    WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND p.resubmitted_at IS NULL
      AND p.id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'resubmitted_applications'::text, count(*) FROM public.providers p
    WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND p.resubmitted_at IS NOT NULL
      AND p.id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'new_service_requests'::text, count(*) FROM public.provider_services ps
    JOIN public.providers p ON p.id = ps.provider_id
    WHERE ps.status = 'pending' AND p.onboarding_status = 'APPROVED'
      AND ps.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'price_change_requests'::text, count(*) FROM public.provider_services ps
    WHERE ps.status = 'approved'
      AND (
        ps.pending_price_override IS NOT NULL
        OR ps.pending_online_price_override IS NOT NULL
      )
      AND ps.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'pending_services'::text, count(*) FROM public.provider_services ps
    WHERE ps.status = 'pending'
      AND ps.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'pending_teaching_groups'::text, count(*) FROM (
    SELECT 1 FROM public.provider_teaching_capabilities c WHERE c.status = 'pending'
      AND c.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
    GROUP BY c.provider_id, c.service_id, c.subject_id, c.curriculum_id,
      c.session_duration_min, c.session_price
  ) groups_pending
  UNION ALL
  SELECT 'pending_documents'::text, count(*) FROM public.provider_documents d
    WHERE d.status = 'pending'
      AND d.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'open_cases'::text,
    (SELECT count(*) FROM public.disputes d WHERE d.status IN ('open', 'info_requested'))
    + (SELECT count(*) FROM public.support_tickets s WHERE s.status IN ('open', 'pending'))
  UNION ALL
  SELECT 'bookings_needing_action'::text,
    (SELECT count(*) FROM public.bookings b WHERE b.status IN ('disputed', 'no_show'))
    + (SELECT count(*) FROM public.online_session_admin_reviews rc WHERE rc.status = 'open')
  UNION ALL
  SELECT 'online_lesson_issue_reports'::text,
    (SELECT count(*) FROM public.online_lesson_issue_reports r WHERE r.status = 'open')
  UNION ALL
  SELECT 'payments_pending_review'::text, count(*) FROM public.payments pay
    WHERE pay.status = 'pending_review'
  UNION ALL
  SELECT 'bookings_lifecycle_attention'::text, count(*) FROM public.bookings b
    WHERE
      (b.status = 'confirmed' AND b.end_at < now())
      OR (b.status = 'arrived' AND b.status_changed_at < now() - interval '30 minutes')
      OR (b.status = 'completion_requested'
          AND b.completion_requested_at IS NOT NULL
          AND b.completion_requested_at < v_cutoff
          AND b.completion_requested_at < now() - interval '12 hours')
      OR (b.status = 'in_progress' AND now() > b.start_at + (b.end_at - b.start_at) + interval '2 hours');
END;
$$;