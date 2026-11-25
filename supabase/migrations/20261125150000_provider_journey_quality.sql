-- Provider journey: performance stats, warnings, review SLA, document expiry, work-queue badges.

CREATE TABLE IF NOT EXISTS public.provider_warnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(btrim(reason)) > 0),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_warnings_provider ON public.provider_warnings(provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_warnings_created_by ON public.provider_warnings(created_by);

ALTER TABLE public.provider_warnings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_warnings_select ON public.provider_warnings;
CREATE POLICY provider_warnings_select ON public.provider_warnings
  FOR SELECT USING (
    public.has_role((SELECT auth.uid()), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.profile_id = (SELECT auth.uid())
    )
  );

GRANT SELECT ON public.provider_warnings TO authenticated;
GRANT ALL ON public.provider_warnings TO service_role;

DROP TRIGGER IF EXISTS trg_audit_provider_warnings ON public.provider_warnings;
CREATE TRIGGER trg_audit_provider_warnings
  AFTER INSERT ON public.provider_warnings
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

INSERT INTO public.settings (key, value)
VALUES ('provider_review_sla_hours', '{"hours":24}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.provider_review_sla_hours()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT GREATEST(
    1,
    COALESCE((SELECT (value->>'hours')::integer FROM public.settings WHERE key = 'provider_review_sla_hours'), 24)
  );
$$;

REVOKE ALL ON FUNCTION public.provider_review_sla_hours() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_review_sla_hours() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.provider_performance_stats_core(
  p_provider_id uuid,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from timestamptz := now() - make_interval(days => GREATEST(1, LEAST(COALESCE(p_days, 30), 365)));
  v_requests bigint := 0;
  v_accepted bigint := 0;
  v_provider_cancelled bigint := 0;
  v_no_response bigint := 0;
  v_completed bigint := 0;
  v_confirmed_outcomes bigint := 0;
  v_median_response numeric;
  v_rating_avg numeric;
  v_rating_count bigint;
BEGIN
  IF p_provider_id IS NULL THEN
    RAISE EXCEPTION 'Provider required.' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_requests
  FROM public.bookings b
  WHERE b.provider_id = p_provider_id
    AND b.deleted_at IS NULL
    AND b.created_at >= v_from;

  SELECT count(*) INTO v_accepted
  FROM public.bookings b
  WHERE b.provider_id = p_provider_id
    AND b.deleted_at IS NULL
    AND b.created_at >= v_from
    AND EXISTS (
      SELECT 1 FROM public.booking_status_history h
      WHERE h.booking_id = b.id AND h.from_status = 'pending' AND h.to_status = 'confirmed'
    );

  SELECT count(*) INTO v_no_response
  FROM public.bookings b
  WHERE b.provider_id = p_provider_id
    AND b.deleted_at IS NULL
    AND b.created_at >= v_from
    AND b.cancellation_reason = 'provider_no_response';

  SELECT count(*) INTO v_provider_cancelled
  FROM public.booking_cancellations c
  JOIN public.bookings b ON b.id = c.booking_id
  WHERE b.provider_id = p_provider_id
    AND b.deleted_at IS NULL
    AND c.cancelled_at >= v_from
    AND c.cancelled_by_role = 'provider';

  SELECT count(*) INTO v_completed
  FROM public.bookings b
  WHERE b.provider_id = p_provider_id
    AND b.deleted_at IS NULL
    AND b.completed_at IS NOT NULL
    AND b.completed_at >= v_from;

  SELECT count(*) INTO v_confirmed_outcomes
  FROM public.bookings b
  WHERE b.provider_id = p_provider_id
    AND b.deleted_at IS NULL
    AND b.created_at >= v_from
    AND (
      b.completed_at IS NOT NULL
      OR b.status = 'no_show'
      OR EXISTS (
        SELECT 1 FROM public.booking_cancellations c
        WHERE c.booking_id = b.id AND c.previous_status <> 'pending'
      )
    );

  SELECT percentile_cont(0.5) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (h.created_at - b.created_at)) / 60.0
  ) INTO v_median_response
  FROM public.bookings b
  JOIN public.booking_status_history h ON h.booking_id = b.id
  WHERE b.provider_id = p_provider_id
    AND b.deleted_at IS NULL
    AND b.created_at >= v_from
    AND h.from_status = 'pending'
    AND h.to_status = 'confirmed';

  SELECT rs.rating_avg, rs.rating_count INTO v_rating_avg, v_rating_count
  FROM public.ratings_summary rs
  WHERE rs.provider_id = p_provider_id;

  RETURN jsonb_build_object(
    'days', GREATEST(1, LEAST(COALESCE(p_days, 30), 365)),
    'request_count', v_requests,
    'acceptance_rate',
      CASE
        WHEN (v_accepted + v_provider_cancelled + v_no_response) > 0 THEN
          round(100.0 * v_accepted::numeric / (v_accepted + v_provider_cancelled + v_no_response)::numeric, 1)
        ELSE NULL
      END,
    'provider_cancellation_rate',
      CASE WHEN v_requests > 0 THEN round(100.0 * v_provider_cancelled::numeric / v_requests::numeric, 1) ELSE NULL END,
    'completion_rate',
      CASE
        WHEN v_confirmed_outcomes > 0 THEN round(100.0 * v_completed::numeric / v_confirmed_outcomes::numeric, 1)
        ELSE NULL
      END,
    'median_response_minutes', CASE WHEN v_median_response IS NULL THEN NULL ELSE round(v_median_response::numeric, 0) END,
    'rating_avg', v_rating_avg,
    'rating_count', COALESCE(v_rating_count, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.provider_performance_stats_core(uuid, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.provider_performance_stats(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_provider_id FROM public.providers WHERE profile_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501'; END IF;
  RETURN public.provider_performance_stats_core(v_provider_id, p_days);
END;
$$;

REVOKE ALL ON FUNCTION public.provider_performance_stats(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_performance_stats(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_provider_performance_stats(
  p_provider_id uuid,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  RETURN public.provider_performance_stats_core(p_provider_id, p_days);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_provider_performance_stats(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_provider_performance_stats(uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_create_provider_warning(
  p_provider_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider public.providers;
  v_id uuid;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_body_en text;
  v_body_ar text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) < 3 THEN
    RAISE EXCEPTION 'A reason is required.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE id = p_provider_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider not found.' USING ERRCODE = '42501'; END IF;

  PERFORM set_config('app.audit_reason', v_reason, true);

  INSERT INTO public.provider_warnings (provider_id, reason, created_by)
  VALUES (p_provider_id, v_reason, auth.uid())
  RETURNING id INTO v_id;

  v_body_en := 'Famy sent you a quality notice: ' || v_reason;
  v_body_ar := 'فامي بعتتلك إنذار جودة: ' || v_reason;

  INSERT INTO public.notifications (
    user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
  ) VALUES (
    v_provider.profile_id, 'provider_warning', 'provider',
    'Quality notice', v_body_en,
    'Quality notice', 'إنذار جودة',
    v_body_en, v_body_ar,
    jsonb_build_object('provider_id', p_provider_id, 'warning_id', v_id),
    '/pro/profile#warnings'
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_provider_warning(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_provider_warning(uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_review_provider_document(uuid, public.verification_status, text);

CREATE OR REPLACE FUNCTION public.admin_review_provider_document(
  p_document_id uuid,
  p_status public.verification_status,
  p_reason text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_doc public.provider_documents;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid document review status.' USING ERRCODE = '23514';
  END IF;
  IF p_status = 'rejected' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'A reason is required to reject a document.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_doc FROM public.provider_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found.' USING ERRCODE = '42501'; END IF;

  UPDATE public.provider_documents
  SET status = p_status,
      rejected_reason = CASE WHEN p_status = 'rejected' THEN btrim(p_reason) ELSE NULL END,
      expires_at = CASE WHEN p_status = 'approved' THEN p_expires_at ELSE NULL END,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = p_document_id;

  PERFORM set_config('app.onboarding_internal_call', '1', true);
  PERFORM public.log_provider_onboarding_event(
    v_doc.provider_id, auth.uid(), 'admin',
    CASE WHEN p_status = 'approved' THEN 'document_approved' ELSE 'document_rejected' END,
    NULL, NULL,
    jsonb_build_object(
      'document_id', p_document_id,
      'document_type', v_doc.type::text,
      'expires_at', p_expires_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_provider_document(uuid, public.verification_status, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_provider_document(uuid, public.verification_status, text, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_expiring_provider_documents(p_within_days integer DEFAULT 30)
RETURNS TABLE (
  document_id uuid,
  provider_id uuid,
  document_type text,
  expires_at timestamptz,
  full_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT d.id, d.provider_id, d.type::text, d.expires_at, pr.full_name
  FROM public.provider_documents d
  JOIN public.providers p ON p.id = d.provider_id
  JOIN public.profiles pr ON pr.id = p.profile_id
  WHERE d.status = 'approved'
    AND d.expires_at IS NOT NULL
    AND d.expires_at <= now() + make_interval(days => GREATEST(1, LEAST(COALESCE(p_within_days, 30), 90)))
    AND p.id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  ORDER BY d.expires_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_expiring_provider_documents(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_expiring_provider_documents(integer) TO authenticated;

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

REVOKE ALL ON FUNCTION public.admin_work_queue_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_work_queue_counts() TO authenticated;