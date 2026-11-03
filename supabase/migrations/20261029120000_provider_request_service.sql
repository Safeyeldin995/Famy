-- Approved providers add services via provider_request_service (atomic capabilities + requirements).
-- Additive only. Review-only; do not apply to Production from this PR.

ALTER TABLE public.provider_services
  ADD COLUMN IF NOT EXISTS request_idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS provider_services_request_idempotency_unique
  ON public.provider_services (provider_id, request_idempotency_key)
  WHERE request_idempotency_key IS NOT NULL;

-- Block bare INSERT for approved providers (must use provider_request_service).
CREATE OR REPLACE FUNCTION public.tg_guard_provider_service_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_onboarding text;
BEGIN
  SELECT p.onboarding_status::text INTO v_onboarding
  FROM public.providers p WHERE p.id = NEW.provider_id;
  IF v_onboarding = 'APPROVED'
     AND current_setting('app.provider_service_request', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Approved providers must submit a service request through provider_request_service.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_provider_service_insert ON public.provider_services;
CREATE TRIGGER trg_guard_provider_service_insert
  BEFORE INSERT ON public.provider_services
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_provider_service_insert();

-- Gate tutoring approvals on at least one teaching capability for the service.
CREATE OR REPLACE FUNCTION public.tg_guard_provider_services()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin');
  v_becoming_approved boolean;
  v_category_slug text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending' AND NOT v_is_admin THEN
      RAISE EXCEPTION 'New service requests must start pending.' USING ERRCODE = '42501';
    END IF;
    v_becoming_approved := (NEW.status = 'approved');
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT v_is_admin THEN
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
    IF v_category_slug = 'tutoring'
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

CREATE OR REPLACE FUNCTION public.provider_cancel_service_request(p_service_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_ps public.provider_services;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;

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

  IF v_ps.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending service requests can be cancelled.' USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.provider_teaching_capabilities
  WHERE provider_id = v_provider.id
    AND service_id = p_service_id
    AND status = 'pending';

  DELETE FROM public.provider_services
  WHERE id = v_ps.id;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_cancel_service_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_cancel_service_request(uuid) TO authenticated;

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
    ELSIF v_ps.status = 'rejected' THEN
      DELETE FROM public.provider_teaching_capabilities
      WHERE provider_id = v_provider.id AND service_id = p_service_id AND status IN ('pending', 'rejected');
      UPDATE public.provider_services
      SET status = 'pending', rejection_reason = NULL, request_idempotency_key = p_idempotency_key
      WHERE id = v_ps.id;
    END IF;
  ELSE
    PERFORM set_config('app.provider_service_request', '1', true);
    INSERT INTO public.provider_services (provider_id, service_id, status, request_idempotency_key)
    VALUES (v_provider.id, p_service_id, 'pending', p_idempotency_key)
    RETURNING * INTO v_ps;
  END IF;

  IF v_service.category_slug = 'tutoring' THEN
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

REVOKE ALL ON FUNCTION public.provider_request_service(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_request_service(uuid, jsonb, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_provider_service_request(p_provider_service_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ps public.provider_services;
  v_provider public.providers;
  v_profile public.profiles;
  v_service public.services;
  v_category public.categories;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ps FROM public.provider_services WHERE id = p_provider_service_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider service not found.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE id = v_ps.provider_id;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_provider.profile_id;
  SELECT * INTO v_service FROM public.services WHERE id = v_ps.service_id;
  SELECT * INTO v_category FROM public.categories WHERE id = v_service.category_id;

  RETURN jsonb_build_object(
    'provider_service', to_jsonb(v_ps),
    'provider', jsonb_build_object(
      'id', v_provider.id,
      'onboarding_status', v_provider.onboarding_status,
      'max_children_per_booking', v_provider.max_children_per_booking,
      'profile', jsonb_build_object('full_name', v_profile.full_name, 'phone', v_profile.phone)
    ),
    'service', jsonb_build_object(
      'id', v_service.id,
      'name_en', v_service.name_en,
      'name_ar', v_service.name_ar,
      'category_slug', v_category.slug,
      'minimum_price', v_service.minimum_price,
      'maximum_price', v_service.maximum_price,
      'provider_pricing_allowed', v_service.provider_pricing_allowed
    ),
    'teaching_capabilities', COALESCE((
      SELECT jsonb_agg(to_jsonb(tc) ORDER BY tc.created_at)
      FROM public.provider_teaching_capabilities tc
      WHERE tc.provider_id = v_ps.provider_id AND tc.service_id = v_ps.service_id
    ), '[]'::jsonb),
    'requirement_fulfillments', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'fulfillment', to_jsonb(prf),
          'requirement', to_jsonb(sr)
        ) ORDER BY sr.sort_order
      )
      FROM public.service_requirements sr
      LEFT JOIN public.provider_requirement_fulfillments prf
        ON prf.requirement_id = sr.id AND prf.provider_id = v_ps.provider_id
      WHERE sr.service_id = v_ps.service_id AND sr.is_active AND sr.required_for_provider_approval
    ), '[]'::jsonb),
    'age_group_capabilities', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.age_group_code)
      FROM public.provider_age_group_capabilities c
      WHERE c.provider_id = v_ps.provider_id
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_provider_service_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_provider_service_request(uuid) TO authenticated;

-- Approve pending teaching groups when a post-approval service request is approved.
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
  v_old_reason text;
  v_body_en text;
  v_body_ar text;
  v_group record;
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

  SELECT status, rejection_reason INTO v_old_status, v_old_reason FROM public.provider_services WHERE id = p_id FOR UPDATE;

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

  IF p_status = 'rejected' THEN
    UPDATE public.provider_teaching_capabilities tc
    SET status = 'rejected',
        review_note = COALESCE(btrim(p_reason), tc.review_note),
        reviewed_at = now(),
        reviewed_by = auth.uid()
    WHERE tc.provider_id = v_ps.provider_id
      AND tc.service_id = v_ps.service_id
      AND tc.status IN ('pending', 'approved');
  ELSIF p_status = 'approved' THEN
    IF v_old_status = 'rejected' THEN
      UPDATE public.provider_teaching_capabilities tc
      SET status = 'pending',
          review_note = NULL,
          reviewed_at = NULL,
          reviewed_by = NULL
      WHERE tc.provider_id = v_ps.provider_id
        AND tc.service_id = v_ps.service_id
        AND tc.status = 'rejected';
    END IF;
    IF v_provider.onboarding_status = 'APPROVED' THEN
      FOR v_group IN
        SELECT array_agg(c.id ORDER BY c.id) AS ids
        FROM public.provider_teaching_capabilities c
        WHERE c.provider_id = v_ps.provider_id
          AND c.service_id = v_ps.service_id
          AND c.status = 'pending'
        GROUP BY c.provider_id, c.service_id, c.subject_id, c.curriculum_id,
          c.session_duration_min, c.session_price
      LOOP
        PERFORM public.admin_review_teaching_group(v_group.ids, 'approved', NULL);
      END LOOP;
    END IF;
  END IF;

  IF v_old_status IS NOT DISTINCT FROM p_status
     AND (p_status <> 'rejected' OR v_old_reason IS NOT DISTINCT FROM v_ps.rejection_reason) THEN RETURN; END IF;
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
      '/pro/profile#service-' || v_ps.service_id::text
    );
  ELSE
    v_body_en := 'Your service request for ' || COALESCE(v_service_name, 'a service') || ' was not approved.'
      || CASE WHEN p_reason IS NOT NULL AND btrim(p_reason) <> '' THEN ' Reason: ' || btrim(p_reason) ELSE '' END;
    v_body_ar := 'ماتوافقش على خدمة ' || COALESCE(NULLIF(btrim(v_service_name_ar), ''), 'الخدمة المطلوبة') || '.'
      || CASE WHEN p_reason IS NOT NULL AND btrim(p_reason) <> '' THEN ' السبب: ' || btrim(p_reason) ELSE '' END;
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
      '/pro/profile#service-' || v_ps.service_id::text
    );
  END IF;
END;
$$;

-- Work queue: pending service on already-approved providers (post-approval add-ons).
CREATE OR REPLACE FUNCTION public.admin_work_queue_counts()
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
  SELECT 'new_service_requests'::text, count(*) FROM public.provider_services ps
    JOIN public.providers p ON p.id = ps.provider_id
    WHERE ps.status = 'pending' AND p.onboarding_status = 'APPROVED'
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
  SELECT 'bookings_needing_action'::text, count(*) FROM public.bookings b
    WHERE b.status IN ('disputed', 'no_show')
  UNION ALL
  SELECT 'payments_pending_review'::text, count(*) FROM public.payments pay
    WHERE pay.status = 'pending_review';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_work_queue_provider_ids(p_queue text)
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
  ELSIF p_queue = 'new_service_requests' THEN
    RETURN QUERY SELECT DISTINCT ps.provider_id FROM public.provider_services ps
      JOIN public.providers p ON p.id = ps.provider_id
      WHERE ps.status = 'pending' AND p.onboarding_status = 'APPROVED'
        AND ps.provider_id IN (SELECT identity.provider_id FROM public.admin_provider_identity_ids() identity);
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

NOTIFY pgrst, 'reload schema';
