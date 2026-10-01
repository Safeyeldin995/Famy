-- Provider review notifications, post-approval bio edits, language/subject split,
-- and draft onboarding service removal. Additive only.

-- ---------------------------------------------------------------------------
-- 1) Allow category = provider for in-app notifications (push outbox uses ELSE true).
-- ---------------------------------------------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_category_check
  CHECK (category IN ('booking', 'chat', 'reminder', 'support', 'campaign', 'system', 'provider'));

-- ---------------------------------------------------------------------------
-- 2) Post-approval bio edits: drop bio_en/bio_ar from APPROVED identity lock.
-- Body from 20261001110000_security_write_guards.sql with scoped removal only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_guard_provider_onboarding_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.onboarding_status_transition', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- JWT clients, including provider-admins, cannot write this column except
  -- through provider_save_onboarding_section (which sets the GUC). Seed and
  -- service_role paths have no uid and are not PostgREST clients.
  IF NEW.max_children_per_booking IS DISTINCT FROM OLD.max_children_per_booking
     AND current_setting('app.max_children_declaration', true) IS DISTINCT FROM '1'
     AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Maximum children per booking can only be changed through the onboarding save function.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.onboarding_status IS DISTINCT FROM OLD.onboarding_status THEN
    RAISE EXCEPTION 'Onboarding status changes must use authorized server functions.' USING ERRCODE = '42501';
  END IF;

  IF OLD.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Provider application is read-only while under review.' USING ERRCODE = '42501';
  END IF;

  IF OLD.onboarding_status = 'APPROVED' AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.city IS DISTINCT FROM OLD.city
       OR NEW.years_experience IS DISTINCT FROM OLD.years_experience THEN
      RAISE EXCEPTION 'Verified identity data cannot be changed without review.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF (NEW.is_verified IS DISTINCT FROM OLD.is_verified
      OR NEW.is_top_pro IS DISTINCT FROM OLD.is_top_pro
      OR NEW.is_active IS DISTINCT FROM OLD.is_active)
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Provider verification and activation can only be changed by an admin or authorized server function.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_provider_onboarding_fields ON public.providers;
CREATE TRIGGER trg_guard_provider_onboarding_fields
  BEFORE UPDATE ON public.providers
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_provider_onboarding_fields();

-- ---------------------------------------------------------------------------
-- 3) Languages only under language-tutoring (stop offering school-subject pairs).
-- ---------------------------------------------------------------------------
DELETE FROM public.teaching_subject_services tss
USING public.teaching_subjects sub, public.services svc
WHERE tss.subject_id = sub.id
  AND tss.service_id = svc.id
  AND svc.slug = 'school-subject-tutoring'
  AND sub.code IN ('arabic', 'english', 'french', 'german');

-- ---------------------------------------------------------------------------
-- 4) Legacy approved tutoring capabilities remain bookable after catalog unlink.
-- Drop the teaching_subject_services gate here; upsert still enforces links for new rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_tutoring_capability(
  p_provider_id uuid,
  p_service_id uuid,
  p_capability_id uuid,
  p_subject_code text,
  p_curriculum_code text,
  p_level_code text,
  p_start_at timestamptz,
  p_end_at timestamptz
) RETURNS TABLE (
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

  IF v_service.category_slug IS DISTINCT FROM 'tutoring' THEN
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
     OR v_cap.curriculum_active IS NOT TRUE
     OR v_cap.level_active IS NOT TRUE
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

REVOKE ALL ON FUNCTION public.assert_tutoring_capability(uuid, uuid, uuid, text, text, text, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) Provider removes a draft onboarding service (own provider only).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provider_remove_onboarding_service(p_service_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_ps public.provider_services;
  v_deleted int;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501';
  END IF;

  IF v_provider.onboarding_status NOT IN ('DRAFT', 'NEEDS_CHANGES') THEN
    RAISE EXCEPTION 'Application is not editable in the current status.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ps
  FROM public.provider_services
  WHERE provider_id = v_provider.id AND service_id = p_service_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider service not found.' USING ERRCODE = '42501';
  END IF;

  IF v_ps.status = 'approved' THEN
    RAISE EXCEPTION 'Approved services cannot be removed.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.provider_id = v_provider.id AND b.service_id = p_service_id
  ) THEN
    RAISE EXCEPTION 'Services with bookings cannot be removed.' USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.provider_teaching_capabilities
  WHERE provider_id = v_provider.id
    AND service_id = p_service_id
    AND status = 'pending';

  DELETE FROM public.provider_services
  WHERE provider_id = v_provider.id AND service_id = p_service_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'Provider service not found.' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_remove_onboarding_service(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_remove_onboarding_service(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Admin onboarding action — body from 20260928093002 + provider notifications.
-- ---------------------------------------------------------------------------
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
    v_body_en := 'Your provider application has been approved.';
    v_body_ar := 'تمت الموافقة على طلب الانضمام كمقدم خدمة.';
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'provider_onboarding_approved', 'provider',
      'Application approved', v_body_en,
      'Application approved', 'تمت الموافقة على الطلب',
      v_body_en, v_body_ar,
      jsonb_build_object('provider_id', p_provider_id, 'action', p_action),
      '/pro/onboarding'
    );
  ELSIF p_action = 'reject' THEN
    v_body_en := 'Your provider application was not approved.'
      || CASE WHEN p_reason_public IS NOT NULL AND btrim(p_reason_public) <> '' THEN ' ' || btrim(p_reason_public) ELSE '' END;
    v_body_ar := 'لم تتم الموافقة على طلب الانضمام كمقدم خدمة.'
      || CASE WHEN p_reason_public IS NOT NULL AND btrim(p_reason_public) <> '' THEN ' ' || btrim(p_reason_public) ELSE '' END;
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'provider_onboarding_rejected', 'provider',
      'Application rejected', v_body_en,
      'Application rejected', 'تم رفض الطلب',
      v_body_en, v_body_ar,
      jsonb_build_object('provider_id', p_provider_id, 'action', p_action, 'reason_public', btrim(p_reason_public)),
      '/pro/onboarding'
    );
  ELSIF p_action = 'request_changes' THEN
    v_body_en := 'Your provider application needs changes.'
      || CASE WHEN p_reason_public IS NOT NULL AND btrim(p_reason_public) <> '' THEN ' ' || btrim(p_reason_public) ELSE '' END;
    v_body_ar := 'طلب الانضمام كمقدم خدمة يحتاج إلى تعديلات.'
      || CASE WHEN p_reason_public IS NOT NULL AND btrim(p_reason_public) <> '' THEN ' ' || btrim(p_reason_public) ELSE '' END;
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'provider_onboarding_needs_changes', 'provider',
      'Changes requested', v_body_en,
      'Changes requested', 'مطلوب تعديلات',
      v_body_en, v_body_ar,
      jsonb_build_object('provider_id', p_provider_id, 'action', p_action, 'reason_public', btrim(p_reason_public)),
      '/pro/onboarding'
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_provider_onboarding_action(uuid, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_provider_onboarding_action(uuid, text, text, text, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) Admin provider service status — body from 20260716090000 + notification.
-- ---------------------------------------------------------------------------
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
  SELECT name_en INTO v_service_name FROM public.services WHERE id = v_ps.service_id;

  IF p_status = 'approved' THEN
    v_body_en := 'Your service request for ' || COALESCE(v_service_name, 'a service') || ' has been approved.';
    v_body_ar := 'تمت الموافقة على طلب إضافة خدمة ' || COALESCE(v_service_name, 'خدمة') || '.';
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'provider_service_approved', 'provider',
      'Service approved', v_body_en,
      'Service approved', 'تمت الموافقة على الخدمة',
      v_body_en, v_body_ar,
      jsonb_build_object('provider_id', v_provider.id, 'provider_service_id', p_id, 'service_id', v_ps.service_id),
      '/pro/onboarding'
    );
  ELSE
    v_body_en := 'Your service request for ' || COALESCE(v_service_name, 'a service') || ' was not approved.'
      || CASE WHEN p_reason IS NOT NULL AND btrim(p_reason) <> '' THEN ' ' || btrim(p_reason) ELSE '' END;
    v_body_ar := 'لم تتم الموافقة على طلب إضافة خدمة ' || COALESCE(v_service_name, 'خدمة') || '.'
      || CASE WHEN p_reason IS NOT NULL AND btrim(p_reason) <> '' THEN ' ' || btrim(p_reason) ELSE '' END;
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'provider_service_rejected', 'provider',
      'Service rejected', v_body_en,
      'Service rejected', 'تم رفض الخدمة',
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

REVOKE ALL ON FUNCTION public.admin_set_provider_service_status(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_provider_service_status(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8) Admin teaching capability review — body from 20261001130000 + notification.
-- ---------------------------------------------------------------------------
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
      jsonb_build_object('provider_id', v_provider.id, 'capability_id', p_id),
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
      jsonb_build_object('provider_id', v_provider.id, 'capability_id', p_id),
      '/pro/onboarding'
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_teaching_capability(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_teaching_capability(uuid, text, text) TO authenticated;
