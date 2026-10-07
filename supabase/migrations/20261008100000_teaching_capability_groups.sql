-- Group operations preserve the existing per-level catalog and validation.
CREATE FUNCTION public.provider_save_teaching_group(
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
  RETURN jsonb_build_object('ok', true, 'ids', to_jsonb(v_ids));
END;
$$;

CREATE FUNCTION public.admin_review_teaching_group(
  p_ids uuid[], p_status text, p_review_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_count int;
  v_providers int;
  v_body_en text;
  v_body_ar text;
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

  UPDATE public.provider_teaching_capabilities
  SET status = p_status, reviewed_by = v_uid, reviewed_at = now(),
      review_note = NULLIF(btrim(p_review_note), '')
  WHERE id = ANY(p_ids);

  IF p_status = 'approved' THEN
    v_body_en := 'Your teaching capability has been approved.';
    v_body_ar := 'تمت الموافقة على قدرتك التعليمية.';
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'teaching_capability_approved', 'provider',
      'Teaching capability approved', v_body_en,
      'Teaching capability approved', 'تمت الموافقة على القدرة التعليمية',
      v_body_en, v_body_ar,
      jsonb_build_object('provider_id', v_provider.id, 'capability_ids', to_jsonb(p_ids)),
      '/pro/onboarding'
    );
  ELSIF p_status = 'rejected' THEN
    v_body_en := 'Your teaching capability was not approved. Contact support for details.';
    v_body_ar := 'لم تتم الموافقة على قدرتك التعليمية. تواصل مع الدعم لمعرفة التفاصيل.';
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'teaching_capability_rejected', 'provider',
      'Teaching capability rejected', v_body_en,
      'Teaching capability rejected', 'تم رفض القدرة التعليمية',
      v_body_en, v_body_ar,
      jsonb_build_object('provider_id', v_provider.id, 'capability_ids', to_jsonb(p_ids)),
      '/pro/onboarding'
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_save_teaching_group(uuid, uuid, uuid, uuid[], int, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_save_teaching_group(uuid, uuid, uuid, uuid[], int, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_review_teaching_group(uuid[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_teaching_group(uuid[], text, text) TO authenticated;
