-- Draft for Claude to review and apply. No policies, approval requirements or stored status rules change.
-- Fold service/grade approval notices into the final application approval while it is under review.
-- Separate post-approval actions retain their own notices. Private review notes stay private.

CREATE OR REPLACE FUNCTION public.admin_provider_onboarding_action(
  p_provider_id uuid,
  p_action text,
  p_reason_code text DEFAULT NULL,
  p_reason_public text DEFAULT NULL,
  p_notes_internal text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_new_status public.provider_onboarding_status;
  v_completion jsonb;
  v_body_en text;
  v_body_ar text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE id = p_provider_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider not found.' USING ERRCODE = '42501'; END IF;

  IF p_action = 'start_review' THEN
    IF v_provider.onboarding_status <> 'SUBMITTED' THEN
      RAISE EXCEPTION 'Only submitted applications can enter review.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'UNDER_REVIEW';
  ELSIF p_action = 'approve' THEN
    IF v_provider.onboarding_status NOT IN ('SUBMITTED', 'UNDER_REVIEW') THEN
      RAISE EXCEPTION 'Only submitted or in-review applications can be approved.' USING ERRCODE = '23514';
    END IF;
    v_completion := public.provider_onboarding_completion(p_provider_id);
    IF NOT COALESCE((v_completion->>'complete')::boolean, false) THEN
      RAISE EXCEPTION 'Application is incomplete and cannot be approved.' USING ERRCODE = '23514';
    END IF;
    IF NOT public.provider_required_documents_approved(p_provider_id) THEN
      RAISE EXCEPTION 'Required identity documents must be approved before provider approval.' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.provider_documents d
      WHERE d.provider_id = p_provider_id AND d.type IN ('id_card_front', 'id_card_back') AND d.status = 'rejected'
    ) THEN
      RAISE EXCEPTION 'Rejected required documents must be replaced and approved.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'APPROVED';
  ELSIF p_action = 'request_changes' THEN
    IF v_provider.onboarding_status NOT IN ('SUBMITTED', 'UNDER_REVIEW') THEN
      RAISE EXCEPTION 'Invalid status for requesting changes.' USING ERRCODE = '23514';
    END IF;
    IF p_reason_code IS NULL OR btrim(p_reason_code) = '' OR p_reason_public IS NULL OR btrim(p_reason_public) = '' THEN
      RAISE EXCEPTION 'A reason is required to request changes.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'NEEDS_CHANGES';
  ELSIF p_action = 'request_updated_details' THEN
    IF v_provider.profile_id = v_uid THEN
      RAISE EXCEPTION 'Administrators cannot request updated details for their own provider profile.' USING ERRCODE = '42501';
    END IF;
    IF v_provider.onboarding_status <> 'APPROVED' THEN
      RAISE EXCEPTION 'Only approved providers can be asked for updated details.' USING ERRCODE = '23514';
    END IF;
    IF p_reason_code IS NULL OR btrim(p_reason_code) = '' OR p_reason_public IS NULL OR btrim(p_reason_public) = '' THEN
      RAISE EXCEPTION 'A reason is required to request updated details.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'NEEDS_CHANGES';
  ELSIF p_action = 'reject' THEN
    IF v_provider.onboarding_status NOT IN ('SUBMITTED', 'UNDER_REVIEW', 'NEEDS_CHANGES') THEN
      RAISE EXCEPTION 'Invalid status for rejection.' USING ERRCODE = '23514';
    END IF;
    IF p_reason_code IS NULL OR btrim(p_reason_code) = '' OR p_reason_public IS NULL OR btrim(p_reason_public) = '' THEN
      RAISE EXCEPTION 'A reason is required to reject an application.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'REJECTED';
  ELSIF p_action = 'suspend' THEN
    IF v_provider.onboarding_status <> 'APPROVED' THEN
      RAISE EXCEPTION 'Only approved providers can be suspended.' USING ERRCODE = '23514';
    END IF;
    IF p_reason_code IS NULL OR btrim(p_reason_code) = '' OR p_reason_public IS NULL OR btrim(p_reason_public) = '' THEN
      RAISE EXCEPTION 'A reason is required to suspend a provider.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'SUSPENDED';
  ELSIF p_action = 'unsuspend' THEN
    IF v_provider.onboarding_status <> 'SUSPENDED' THEN
      RAISE EXCEPTION 'Only suspended providers can be unsuspended.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'APPROVED';
  ELSE
    RAISE EXCEPTION 'Unknown onboarding action.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.audit_reason', COALESCE(btrim(p_reason_public), ''), true);
  PERFORM set_config('app.onboarding_internal_call', '1', true);
  PERFORM public.apply_provider_onboarding_status(
    p_provider_id, v_new_status, v_uid, 'admin', p_action,
    p_reason_code, p_reason_public, p_notes_internal, '{}'::jsonb
  );

  IF p_action = 'approve' THEN
    SELECT
      'Your application is approved! Customers can now find you.' ||
        COALESCE(' Approved services: ' || string_agg(s.name_en, ', ' ORDER BY s.name_en), ''),
      'اتوافق على طلبك! بقيت ظاهر للعملاء' ||
        COALESCE('. الخدمات اللي اتوافق عليها: ' || string_agg(COALESCE(NULLIF(btrim(s.name_ar), ''), 'خدمة'), '، ' ORDER BY s.name_ar), '')
    INTO v_body_en, v_body_ar
    FROM public.provider_services ps JOIN public.services s ON s.id = ps.service_id
    WHERE ps.provider_id = p_provider_id AND ps.status = 'approved';
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'provider_onboarding_approved', 'provider',
      'Application approved', v_body_en,
      'Application approved', 'اتوافق على طلبك! بقيت ظاهر للعملاء',
      v_body_en, v_body_ar,
      jsonb_build_object('provider_id', p_provider_id, 'action', p_action),
      '/pro/onboarding'
    );
  ELSIF p_action = 'reject' THEN
    v_body_en := 'Your provider application was not approved.'
      || CASE WHEN p_reason_public IS NOT NULL AND btrim(p_reason_public) <> '' THEN ' ' || btrim(p_reason_public) ELSE '' END;
    v_body_ar := 'طلبك ماتقبلش.'
      || CASE WHEN p_reason_public IS NOT NULL AND btrim(p_reason_public) <> '' THEN ' ' || btrim(p_reason_public) ELSE '' END;
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'provider_onboarding_rejected', 'provider',
      'Application rejected', v_body_en,
      'Application rejected', 'طلبك ماتقبلش',
      v_body_en, v_body_ar,
      jsonb_build_object('provider_id', p_provider_id, 'action', p_action, 'reason_public', btrim(p_reason_public)),
      '/pro/onboarding'
    );
  ELSIF p_action = 'request_changes' THEN
    v_body_en := 'Your provider application needs changes.'
      || CASE WHEN p_reason_public IS NOT NULL AND btrim(p_reason_public) <> '' THEN ' ' || btrim(p_reason_public) ELSE '' END;
    v_body_ar := 'طلبك محتاج شوية تعديلات.'
      || CASE WHEN p_reason_public IS NOT NULL AND btrim(p_reason_public) <> '' THEN ' ' || btrim(p_reason_public) ELSE '' END;
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'provider_onboarding_needs_changes', 'provider',
      'Changes requested', v_body_en,
      'Changes requested', 'طلبك محتاج تعديل',
      v_body_en, v_body_ar,
      jsonb_build_object('provider_id', p_provider_id, 'action', p_action, 'reason_public', btrim(p_reason_public)),
      '/pro/onboarding'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_provider_service_status(
  p_id uuid, p_status text, p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
  v_stored_status text;
  v_ps public.provider_services;
  v_provider public.providers;
  v_service_name text;
  v_service_name_ar text;
  v_old_status text;
  v_body_en text;
  v_body_ar text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid provider service status.' USING ERRCODE = '23514';
  END IF;
  IF p_status = 'rejected' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'A reason is required to reject a provider service request.' USING ERRCODE = '23514';
  END IF;

  SELECT status INTO v_old_status FROM public.provider_services WHERE id = p_id FOR UPDATE;

  PERFORM set_config('app.audit_reason', COALESCE(btrim(p_reason), ''), true);

  UPDATE public.provider_services AS ps
  SET status = p_status,
      rejection_reason = CASE WHEN p_status = 'rejected' THEN btrim(p_reason) ELSE NULL END
  WHERE ps.id = p_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Provider service not found.' USING ERRCODE = '42501';
  END IF;

  SELECT ps.status INTO v_stored_status
  FROM public.provider_services AS ps
  WHERE ps.id = p_id;

  IF v_stored_status IS DISTINCT FROM p_status THEN
    RAISE EXCEPTION 'Provider service status did not persist.' USING ERRCODE = '40001';
  END IF;

  SELECT ps.* INTO v_ps FROM public.provider_services ps WHERE ps.id = p_id;
  SELECT * INTO v_provider FROM public.providers WHERE id = v_ps.provider_id;
  SELECT name_en, name_ar INTO v_service_name, v_service_name_ar FROM public.services WHERE id = v_ps.service_id;

  -- No duplicate on retries. During application review the final notice summarizes approvals.
  IF v_old_status IS NOT DISTINCT FROM p_status THEN RETURN; END IF;
  IF p_status = 'approved' AND v_provider.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') THEN RETURN; END IF;

  IF p_status = 'approved' THEN
    v_body_en := 'Your service request for ' || COALESCE(v_service_name, 'a service') || ' has been approved.';
    v_body_ar := 'اتوافق على خدمة ' || COALESCE(NULLIF(btrim(v_service_name_ar), ''), 'الخدمة المطلوبة') || '.';
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'provider_service_approved', 'provider',
      'Service approved', v_body_en,
      'Service approved', 'اتوافق على الخدمة',
      v_body_en, v_body_ar,
      jsonb_build_object('provider_id', v_provider.id, 'provider_service_id', p_id, 'service_id', v_ps.service_id),
      '/pro/onboarding'
    );
  ELSE
    v_body_en := 'Your service request for ' || COALESCE(v_service_name, 'a service') || ' was not approved.'
      || CASE WHEN p_reason IS NOT NULL AND btrim(p_reason) <> '' THEN ' ' || btrim(p_reason) ELSE '' END;
    v_body_ar := 'ماتوافقش على خدمة ' || COALESCE(NULLIF(btrim(v_service_name_ar), ''), 'الخدمة المطلوبة') || '.'
      || CASE WHEN p_reason IS NOT NULL AND btrim(p_reason) <> '' THEN ' ' || btrim(p_reason) ELSE '' END;
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'provider_service_rejected', 'provider',
      'Service rejected', v_body_en,
      'Service rejected', 'الخدمة ماتقبلتش',
      v_body_en, v_body_ar,
      jsonb_build_object(
        'provider_id', v_provider.id,
        'provider_service_id', p_id,
        'service_id', v_ps.service_id,
        'reason', btrim(p_reason)
      ),
      '/pro/onboarding'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_teaching_group(
  p_ids uuid[], p_status text, p_review_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_count int;
  v_providers int;
  v_body_en text;
  v_body_ar text;
  v_changed boolean;
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Admin role required.' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('approved', 'rejected', 'suspended') THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Review status must be approved, rejected, or suspended.' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(cardinality(p_ids), 0) = 0 OR array_position(p_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Capability was not found.' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM public.provider_teaching_capabilities WHERE id = ANY(p_ids) ORDER BY id FOR UPDATE;
  SELECT count(*), count(DISTINCT provider_id) INTO v_count, v_providers
    FROM public.provider_teaching_capabilities WHERE id = ANY(p_ids);
  IF v_count <> cardinality(p_ids) OR v_providers <> 1 THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: All capabilities must exist and belong to one provider.' USING ERRCODE = '23514';
  END IF;
  SELECT p.* INTO v_provider FROM public.providers p
    JOIN public.provider_teaching_capabilities c ON c.provider_id = p.id WHERE c.id = p_ids[1];
  IF EXISTS (
    SELECT 1 FROM public.providers p
    WHERE p.id = v_provider.id AND p.profile_id = v_uid
  ) THEN
    RAISE EXCEPTION 'TEACHING_SELF_REVIEW: You cannot review your own teaching capability.' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.provider_teaching_capabilities WHERE id = ANY(p_ids) AND status IS DISTINCT FROM p_status) INTO v_changed;

  UPDATE public.provider_teaching_capabilities
  SET status = p_status, reviewed_by = v_uid, reviewed_at = now(),
      review_note = NULLIF(btrim(p_review_note), '')
  WHERE id = ANY(p_ids);

  IF NOT v_changed THEN RETURN; END IF;
  IF p_status = 'approved' AND v_provider.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') THEN RETURN; END IF;

  IF p_status = 'approved' THEN
    v_body_en := 'Your teaching capability has been approved.';
    v_body_ar := 'اتوافق على المادة والمراحل اللي اخترتها.';
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'teaching_capability_approved', 'provider',
      'Teaching capability approved', v_body_en,
      'Teaching capability approved', 'اتوافق على المادة',
      v_body_en, v_body_ar,
      jsonb_build_object('provider_id', v_provider.id, 'capability_ids', to_jsonb(p_ids)),
      '/pro/onboarding'
    );
  ELSIF p_status = 'rejected' THEN
    v_body_en := 'Your teaching capability was not approved. Contact support for details.';
    v_body_ar := 'المادة دي ماتقبلتش. كلم الدعم عشان تعرف السبب.';
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'teaching_capability_rejected', 'provider',
      'Teaching capability rejected', v_body_en,
      'Teaching capability rejected', 'المادة ماتقبلتش',
      v_body_en, v_body_ar,
      jsonb_build_object('provider_id', v_provider.id, 'capability_ids', to_jsonb(p_ids)),
      '/pro/onboarding'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_teaching_capability(
  p_id uuid,
  p_status text,
  p_review_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cap RECORD;
  v_provider public.providers;
  v_body_en text;
  v_body_ar text;
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Admin role required.' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('approved', 'rejected', 'suspended') THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Review status must be approved, rejected, or suspended.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_cap FROM public.provider_teaching_capabilities WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Capability was not found.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.providers p
    WHERE p.id = v_cap.provider_id AND p.profile_id = v_uid
  ) THEN
    RAISE EXCEPTION 'TEACHING_SELF_REVIEW: You cannot review your own teaching capability.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.provider_teaching_capabilities
  SET status = p_status,
      reviewed_by = v_uid,
      reviewed_at = now(),
      review_note = NULLIF(btrim(p_review_note), '')
  WHERE id = p_id;

  SELECT * INTO v_provider FROM public.providers WHERE id = v_cap.provider_id;

  IF v_cap.status IS NOT DISTINCT FROM p_status THEN RETURN; END IF;
  IF p_status = 'approved' AND v_provider.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') THEN RETURN; END IF;

  IF p_status = 'approved' THEN
    v_body_en := 'Your teaching capability has been approved.';
    v_body_ar := 'اتوافق على المادة والمراحل اللي اخترتها.';
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'teaching_capability_approved', 'provider',
      'Teaching capability approved', v_body_en,
      'Teaching capability approved', 'اتوافق على المادة',
      v_body_en, v_body_ar,
      jsonb_build_object('provider_id', v_provider.id, 'capability_id', p_id),
      '/pro/onboarding'
    );
  ELSIF p_status = 'rejected' THEN
    v_body_en := 'Your teaching capability was not approved. Contact support for details.';
    v_body_ar := 'المادة دي ماتقبلتش. كلم الدعم عشان تعرف السبب.';
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'teaching_capability_rejected', 'provider',
      'Teaching capability rejected', v_body_en,
      'Teaching capability rejected', 'المادة ماتقبلتش',
      v_body_en, v_body_ar,
      jsonb_build_object('provider_id', v_provider.id, 'capability_id', p_id),
      '/pro/onboarding'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.provider_save_teaching_group(
  p_service_id uuid,
  p_subject_id uuid,
  p_curriculum_id uuid,
  p_level_ids uuid[],
  p_session_duration_min int,
  p_session_price integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider_id uuid;
  v_level_id uuid;
  v_id uuid;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_changed boolean := false;
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'provider') IS NOT TRUE THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Provider role required.' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_provider_id FROM public.providers WHERE profile_id = v_uid FOR UPDATE;
  IF v_provider_id IS NULL THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Provider profile required.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(cardinality(p_level_ids), 0) = 0
     OR array_position(p_level_ids, NULL) IS NOT NULL
     OR cardinality(p_level_ids) <> (SELECT count(DISTINCT level_id) FROM unnest(p_level_ids) AS level_id) THEN
    RAISE EXCEPTION 'TEACHING_INVALID_LEVELS: Choose distinct non-empty levels.' USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM public.provider_teaching_capabilities
  WHERE provider_id = v_provider_id AND service_id = p_service_id
    AND subject_id = p_subject_id AND curriculum_id = p_curriculum_id
  ORDER BY id FOR UPDATE;

  FOREACH v_level_id IN ARRAY p_level_ids LOOP
    SELECT id INTO v_id FROM public.provider_teaching_capabilities
    WHERE provider_id = v_provider_id AND service_id = p_service_id
      AND subject_id = p_subject_id AND curriculum_id = p_curriculum_id
      AND level_id = v_level_id AND status = 'approved';
    -- The single-row upsert resets approval; never call it for an approved grade.
    IF v_id IS NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.provider_teaching_capabilities
        WHERE provider_id = v_provider_id AND service_id = p_service_id
          AND subject_id = p_subject_id AND curriculum_id = p_curriculum_id AND level_id = v_level_id
          AND status = 'pending' AND session_duration_min = p_session_duration_min AND session_price = p_session_price
      ) THEN v_changed := true; END IF;
      PERFORM public.provider_upsert_teaching_capability(
        p_service_id, p_subject_id, p_curriculum_id, v_level_id,
        p_session_duration_min, p_session_price
      );
      SELECT id INTO v_id FROM public.provider_teaching_capabilities
      WHERE provider_id = v_provider_id AND service_id = p_service_id
        AND subject_id = p_subject_id AND curriculum_id = p_curriculum_id AND level_id = v_level_id;
    END IF;
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  DELETE FROM public.provider_teaching_capabilities
  WHERE provider_id = v_provider_id AND service_id = p_service_id
    AND subject_id = p_subject_id AND curriculum_id = p_curriculum_id
    AND NOT (level_id = ANY(p_level_ids)) AND status <> 'approved';
  -- Emit only once for the group, never from the grade loop or unchanged retries.
  IF v_changed THEN
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_uid, 'teaching_capability_pending', 'provider',
      'Subject under review', 'We are reviewing the subject and grades you added.',
      'Subject under review', 'المادة قيد المراجعة',
      'We are reviewing the subject and grades you added.', 'بنراجع المادة والمراحل اللي ضفتها. هيوصلك إشعار لما نخلص.',
      jsonb_build_object('provider_id', v_provider_id, 'service_id', p_service_id, 'subject_id', p_subject_id, 'curriculum_id', p_curriculum_id, 'capability_ids', to_jsonb(v_ids)),
      '/pro/setup/subjects'
    );
  END IF;
  RETURN jsonb_build_object('ok', true, 'ids', to_jsonb(v_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_provider_onboarding_action(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_provider_onboarding_action(uuid, text, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_set_provider_service_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_provider_service_status(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_review_teaching_group(uuid[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_teaching_group(uuid[], text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_review_teaching_capability(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_teaching_capability(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.provider_save_teaching_group(uuid, uuid, uuid, uuid[], int, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_save_teaching_group(uuid, uuid, uuid, uuid[], int, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
