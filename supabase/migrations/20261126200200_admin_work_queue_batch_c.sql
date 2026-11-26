-- Batch C (#515, #520, #529): admin work-queue counts match the lists they open.
-- Re-derived from the latest definition (20261126160000_student_learning_profile.sql),
-- keeping every key from #541/#543. Changes:
--   * open_cases also counts open / info_requested no-show reports (the cases list shows them)
--   * online session reviews are their own queue key instead of being added to bookings_needing_action

CREATE OR REPLACE FUNCTION public.admin_work_queue_counts()
RETURNS TABLE(queue text, item_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutoff timestamptz;
  v_sla_hours integer;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT s.completion_auto_from INTO v_cutoff
  FROM public.booking_expiry_settings() s;
  v_sla_hours := public.provider_review_sla_hours();

  RETURN QUERY
  SELECT 'new_applications'::text, count(*) FROM public.providers p
    WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND p.resubmitted_at IS NULL
      AND p.id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'resubmitted_applications'::text, count(*) FROM public.providers p
    WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND p.resubmitted_at IS NOT NULL
      AND p.id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'applications_over_sla'::text, count(*) FROM public.providers p
    WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW')
      AND COALESCE(p.resubmitted_at, p.submitted_at, p.created_at) < now() - (v_sla_hours || ' hours')::interval
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
  SELECT 'documents_expiring_soon'::text, count(*) FROM public.provider_documents d
    WHERE d.status = 'approved'
      AND d.expires_at IS NOT NULL
      AND d.expires_at <= now() + interval '30 days'
      AND d.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'open_cases'::text,
    (SELECT count(*) FROM public.disputes d WHERE d.status IN ('open', 'info_requested'))
    + (SELECT count(*) FROM public.support_tickets s WHERE s.status IN ('open', 'pending'))
    + (SELECT count(*) FROM public.no_show_reports r WHERE r.status IN ('open', 'info_requested'))
  UNION ALL
  SELECT 'bookings_needing_action'::text,
    (SELECT count(*) FROM public.bookings b WHERE b.status IN ('disputed', 'no_show'))
  UNION ALL
  SELECT 'online_session_reviews'::text,
    (SELECT count(*) FROM public.online_session_admin_reviews rc WHERE rc.status = 'open')
  UNION ALL
  SELECT 'online_lesson_issue_reports'::text,
    (SELECT count(*) FROM public.online_lesson_issue_reports r WHERE r.status = 'open')
  UNION ALL
  SELECT 'ugc_reports'::text,
    (SELECT count(*) FROM public.ugc_reports u WHERE u.status = 'open')
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
      OR (b.status = 'in_progress' AND now() > b.start_at + (b.end_at - b.start_at) + interval '2 hours')
  UNION ALL
  SELECT 'pending_settlements'::text,
    (SELECT count(*) FROM public.provider_settlements s WHERE s.status = 'pending')
  UNION ALL
  SELECT 'providers_at_cash_limit'::text,
    (
      SELECT count(*)
      FROM public.providers p
      WHERE p.onboarding_status = 'APPROVED'
        AND public.provider_cash_debt_blocked(p.id)
        AND p.id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
    )
  UNION ALL
  SELECT 'tutors_missing_teaching_data'::text,
    (SELECT count(*) FROM public.admin_tutors_missing_teaching_data_ids());
END;
$$;

REVOKE ALL ON FUNCTION public.admin_work_queue_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_work_queue_counts() TO authenticated;

NOTIFY pgrst, 'reload schema';
