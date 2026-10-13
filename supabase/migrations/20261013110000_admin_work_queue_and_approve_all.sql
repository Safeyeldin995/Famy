-- Admin-only work queue and atomic provider application approval.
-- Additive: existing onboarding, service and teaching review functions remain unchanged.
-- This migration must be reviewed and applied by the release owner, not by this PR author.

CREATE INDEX IF NOT EXISTS provider_teaching_pending_admin_queue
  ON public.provider_teaching_capabilities (
    provider_id, service_id, subject_id, curriculum_id,
    session_duration_min, session_price
  ) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS provider_documents_pending_admin_queue
  ON public.provider_documents (provider_id) WHERE status = 'pending';

CREATE FUNCTION public.admin_work_queue_counts()
RETURNS TABLE(queue text, item_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT 'new_applications'::text, count(*) FROM public.providers p
    WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND p.resubmitted_at IS NULL
      AND p.id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'resubmitted_applications'::text, count(*) FROM public.providers p
    WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND p.resubmitted_at IS NOT NULL
      AND p.id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
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
  SELECT 'bookings_needing_action'::text, count(*) FROM public.bookings b
    WHERE b.status IN ('disputed', 'no_show')
  UNION ALL
  SELECT 'payments_pending_review'::text, count(*) FROM public.payments pay
    WHERE pay.status = 'pending_review';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_work_queue_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_work_queue_counts() TO authenticated;

-- A queue card opens a filtered provider list, including already-approved
-- providers who have a new pending service, document or teaching group.
CREATE FUNCTION public.admin_work_queue_provider_ids(p_queue text)
RETURNS TABLE(provider_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_queue = 'new_applications' THEN
    RETURN QUERY SELECT p.id FROM public.providers p
      WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND p.resubmitted_at IS NULL
        AND p.id IN (SELECT identity.provider_id FROM public.admin_provider_identity_ids() identity);
  ELSIF p_queue = 'resubmitted_applications' THEN
    RETURN QUERY SELECT p.id FROM public.providers p
      WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND p.resubmitted_at IS NOT NULL
        AND p.id IN (SELECT identity.provider_id FROM public.admin_provider_identity_ids() identity);
  ELSIF p_queue = 'pending_services' THEN
    RETURN QUERY SELECT DISTINCT ps.provider_id FROM public.provider_services ps
      WHERE ps.status = 'pending'
        AND ps.provider_id IN (SELECT identity.provider_id FROM public.admin_provider_identity_ids() identity);
  ELSIF p_queue = 'pending_teaching_groups' THEN
    RETURN QUERY SELECT DISTINCT c.provider_id FROM public.provider_teaching_capabilities c
      WHERE c.status = 'pending'
        AND c.provider_id IN (SELECT identity.provider_id FROM public.admin_provider_identity_ids() identity);
  ELSIF p_queue = 'pending_documents' THEN
    RETURN QUERY SELECT DISTINCT d.provider_id FROM public.provider_documents d
      WHERE d.status = 'pending'
        AND d.provider_id IN (SELECT identity.provider_id FROM public.admin_provider_identity_ids() identity);
  ELSE
    RAISE EXCEPTION 'Unknown provider work queue.' USING ERRCODE = '23514';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_work_queue_provider_ids(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_work_queue_provider_ids(text) TO authenticated;

CREATE FUNCTION public.admin_approve_provider_application_all(p_provider_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile_id uuid;
  v_status text;
  v_service_id uuid;
  v_group record;
  v_service_count integer := 0;
  v_group_count integer := 0;
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_provider_id IS NULL THEN
    RAISE EXCEPTION 'Provider not found.' USING ERRCODE = '42501';
  END IF;

  -- This lock serializes the decision with provider submission. Existing RPCs
  -- keep their own validation, mandatory-requirement gates and audit trail.
  SELECT p.profile_id, p.onboarding_status::text INTO v_profile_id, v_status
    FROM public.providers p WHERE p.id = p_provider_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider not found.' USING ERRCODE = '42501';
  END IF;
  IF v_profile_id = v_uid THEN
    RAISE EXCEPTION 'Administrators cannot approve their own provider application.' USING ERRCODE = '42501';
  END IF;
  IF v_status NOT IN ('SUBMITTED', 'UNDER_REVIEW') THEN
    RAISE EXCEPTION 'Only submitted or in-review applications can be approved.' USING ERRCODE = '23514';
  END IF;

  -- A teaching group cannot be approved without a reviewable provider-service
  -- relationship. Rejected/suspended services are not silently revived.
  IF EXISTS (
    SELECT 1 FROM public.provider_teaching_capabilities c
    WHERE c.provider_id = p_provider_id AND c.status = 'pending'
      AND NOT EXISTS (
        SELECT 1 FROM public.provider_services ps
        WHERE ps.provider_id = p_provider_id AND ps.service_id = c.service_id
          AND ps.status IN ('pending', 'approved')
      )
  ) THEN
    RAISE EXCEPTION 'Pending teaching group has no reviewable provider service.' USING ERRCODE = '23514';
  END IF;

  FOR v_service_id IN
    SELECT ps.id FROM public.provider_services ps
    WHERE ps.provider_id = p_provider_id AND ps.status = 'pending' ORDER BY ps.id
  LOOP
    PERFORM public.admin_set_provider_service_status(v_service_id, 'approved', NULL);
    v_service_count := v_service_count + 1;
  END LOOP;

  FOR v_group IN
    SELECT array_agg(c.id ORDER BY c.id) AS ids
    FROM public.provider_teaching_capabilities c
    WHERE c.provider_id = p_provider_id AND c.status = 'pending'
    GROUP BY c.provider_id, c.service_id, c.subject_id, c.curriculum_id,
      c.session_duration_min, c.session_price
    ORDER BY c.service_id, c.subject_id, c.curriculum_id,
      c.session_duration_min, c.session_price
  LOOP
    PERFORM public.admin_review_teaching_group(v_group.ids, 'approved', NULL);
    v_group_count := v_group_count + 1;
  END LOOP;

  PERFORM public.admin_provider_onboarding_action(p_provider_id, 'approve', NULL, NULL, NULL);

  -- A function call executes in one transaction. Any raised exception rolls
  -- back services, groups, onboarding state, audit rows and notifications.
  RETURN jsonb_build_object('approved_services', v_service_count,
                            'approved_teaching_groups', v_group_count);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_approve_provider_application_all(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_approve_provider_application_all(uuid)
  TO authenticated;

-- Section decisions are private admin review annotations. They never grant
-- provider approval or replace the server's final completion/document checks.
CREATE TABLE public.provider_admin_section_reviews (
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  section text NOT NULL CHECK (section IN (
    'identity_documents', 'personal_details', 'references', 'services_prices',
    'babysitting_ages', 'teaching_groups', 'hours_zones'
  )),
  decision text NOT NULL CHECK (decision IN ('approved', 'request_changes', 'rejected')),
  reason text,
  reviewed_by uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, section),
  CONSTRAINT section_review_reason_required CHECK (
    decision = 'approved' OR NULLIF(btrim(reason), '') IS NOT NULL
  )
);

ALTER TABLE public.provider_admin_section_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_admin_section_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.provider_admin_section_reviews TO authenticated;
GRANT ALL ON public.provider_admin_section_reviews TO service_role;
CREATE POLICY provider_admin_section_reviews_admin_read
  ON public.provider_admin_section_reviews FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE FUNCTION public.admin_review_provider_section(
  p_provider_id uuid, p_section text, p_decision text, p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile_id uuid;
  v_status text;
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_section IS NULL OR p_section NOT IN (
    'identity_documents', 'personal_details', 'references', 'services_prices',
    'babysitting_ages', 'teaching_groups', 'hours_zones'
  ) OR p_decision IS NULL OR p_decision NOT IN ('approved', 'request_changes', 'rejected', 'clear') THEN
    RAISE EXCEPTION 'Invalid section review.' USING ERRCODE = '23514';
  END IF;
  IF p_decision NOT IN ('approved', 'clear') AND NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required.' USING ERRCODE = '23514';
  END IF;
  SELECT p.profile_id, p.onboarding_status::text INTO v_profile_id, v_status
    FROM public.providers p WHERE p.id = p_provider_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider not found.' USING ERRCODE = '42501'; END IF;
  IF v_profile_id = v_uid THEN
    RAISE EXCEPTION 'Administrators cannot review their own provider application.' USING ERRCODE = '42501';
  END IF;
  IF v_status NOT IN ('SUBMITTED', 'UNDER_REVIEW') THEN
    RAISE EXCEPTION 'Only submitted or in-review applications can be reviewed.' USING ERRCODE = '23514';
  END IF;

  IF p_decision = 'clear' THEN
    DELETE FROM public.provider_admin_section_reviews
      WHERE provider_id = p_provider_id AND section = p_section AND decision = 'approved';
    RETURN;
  END IF;

  IF p_decision = 'request_changes' THEN
    PERFORM public.admin_provider_onboarding_action(
      p_provider_id, 'request_changes', p_section, btrim(p_reason), NULL
    );
  ELSIF p_decision = 'rejected' THEN
    PERFORM public.admin_provider_onboarding_action(
      p_provider_id, 'reject', p_section, btrim(p_reason), NULL
    );
  END IF;

  INSERT INTO public.provider_admin_section_reviews
    (provider_id, section, decision, reason, reviewed_by, reviewed_at)
  VALUES (p_provider_id, p_section, p_decision, NULLIF(btrim(p_reason), ''), v_uid, now())
  ON CONFLICT (provider_id, section) DO UPDATE
    SET decision = EXCLUDED.decision, reason = EXCLUDED.reason,
        reviewed_by = EXCLUDED.reviewed_by, reviewed_at = EXCLUDED.reviewed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_provider_section(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_provider_section(uuid, text, text, text)
  TO authenticated;
