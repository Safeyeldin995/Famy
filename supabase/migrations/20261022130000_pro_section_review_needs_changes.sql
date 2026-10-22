-- Section review: human notifications, NEEDS_CHANGES on reject, optional reference exception.

ALTER TABLE public.provider_admin_section_reviews
  DROP CONSTRAINT IF EXISTS provider_admin_section_reviews_decision_check;

ALTER TABLE public.provider_admin_section_reviews
  ADD CONSTRAINT provider_admin_section_reviews_decision_check
  CHECK (decision IN ('approved', 'request_changes', 'rejected', 'rejected_optional'));

CREATE OR REPLACE FUNCTION public.admin_section_review_notification_copy(
  p_section text,
  p_reason text DEFAULT NULL
) RETURNS TABLE (
  label_en text,
  label_ar text,
  body_en text,
  body_ar text,
  deep_link text
) LANGUAGE sql IMMUTABLE AS $$
  SELECT
    CASE p_section
      WHEN 'identity_documents' THEN 'Identity documents'
      WHEN 'personal_details' THEN 'Personal details'
      WHEN 'references' THEN 'References'
      WHEN 'services_prices' THEN 'Services and prices'
      WHEN 'babysitting_ages' THEN 'Babysitting ages'
      WHEN 'teaching_groups' THEN 'Teaching subject groups'
      WHEN 'hours_zones' THEN 'Working hours and areas'
      ELSE 'Application section'
    END,
    CASE p_section
      WHEN 'identity_documents' THEN 'البطاقة والمستندات'
      WHEN 'personal_details' THEN 'البيانات الشخصية'
      WHEN 'references' THEN 'الاشخاص اللي نسألهم عن شغلك'
      WHEN 'services_prices' THEN 'الخدمات والأسعار'
      WHEN 'babysitting_ages' THEN 'فئات اعمار رعاية الاطفال'
      WHEN 'teaching_groups' THEN 'مجموعات مواد التدريس'
      WHEN 'hours_zones' THEN 'مواعيد الشغل والمناطق'
      ELSE 'جزء من الطلب'
    END,
    'We need you to update: ' ||
      CASE p_section
        WHEN 'identity_documents' THEN 'identity documents'
        WHEN 'personal_details' THEN 'personal details'
        WHEN 'references' THEN 'references'
        WHEN 'services_prices' THEN 'services and prices'
        WHEN 'babysitting_ages' THEN 'babysitting age groups'
        WHEN 'teaching_groups' THEN 'teaching subject groups'
        WHEN 'hours_zones' THEN 'working hours and service areas'
        ELSE p_section
      END ||
      CASE WHEN p_reason IS NOT NULL AND btrim(p_reason) <> '' THEN '. Reason: ' || btrim(p_reason) ELSE '' END ||
      CASE p_section
        WHEN 'references' THEN ' Open the references step to add or fix a contact.'
        WHEN 'teaching_groups' THEN ' Open the subjects step to update your teaching groups.'
        WHEN 'identity_documents' THEN ' Open documents to upload replacements.'
        ELSE ' Open the linked step to fix this.'
      END,
    'محتاجين تعديل: ' ||
      CASE p_section
        WHEN 'identity_documents' THEN 'البطاقة والمستندات'
        WHEN 'personal_details' THEN 'البيانات الشخصية'
        WHEN 'references' THEN 'الاشخاص اللي نسألهم عن شغلك'
        WHEN 'services_prices' THEN 'الخدمات والأسعار'
        WHEN 'babysitting_ages' THEN 'فئات اعمار رعاية الاطفال'
        WHEN 'teaching_groups' THEN 'مجموعات مواد التدريس'
        WHEN 'hours_zones' THEN 'مواعيد الشغل والمناطق'
        ELSE p_section
      END ||
      CASE WHEN p_reason IS NOT NULL AND btrim(p_reason) <> '' THEN '. السبب: ' || btrim(p_reason) ELSE '' END ||
      CASE p_section
        WHEN 'references' THEN ' دوس هنا علشان تضيف شخص تاني او تعدل المراجع.'
        WHEN 'teaching_groups' THEN ' دوس هنا علشان تعدل مواد التدريس.'
        WHEN 'identity_documents' THEN ' دوس هنا علشان ترفع المستندات من جديد.'
        ELSE ' دوس هنا علشان تكمل التعديل.'
      END,
    CASE p_section
      WHEN 'identity_documents' THEN '/pro/documents'
      WHEN 'personal_details' THEN '/pro/setup/personal'
      WHEN 'references' THEN '/pro/setup/reference'
      WHEN 'services_prices' THEN '/pro/profile'
      WHEN 'babysitting_ages' THEN '/pro/setup/babysitting'
      WHEN 'teaching_groups' THEN '/pro/setup/subjects'
      WHEN 'hours_zones' THEN '/pro/setup/hours'
      ELSE '/pro/onboarding'
    END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_provider_section(
  p_provider_id uuid, p_section text, p_decision text, p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile_id uuid;
  v_status text;
  v_provider public.providers;
  v_copy record;
  v_ref_count int;
  v_stored_decision text;
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_section IS NULL OR p_section NOT IN (
    'identity_documents', 'personal_details', 'references', 'services_prices',
    'babysitting_ages', 'teaching_groups', 'hours_zones'
  ) OR p_decision IS NULL OR p_decision NOT IN (
    'approved', 'request_changes', 'rejected', 'rejected_optional', 'clear'
  ) THEN
    RAISE EXCEPTION 'Invalid section review.' USING ERRCODE = '23514';
  END IF;
  IF p_decision NOT IN ('approved', 'clear') AND NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required.' USING ERRCODE = '23514';
  END IF;
  IF p_decision = 'rejected_optional' AND p_section <> 'references' THEN
    RAISE EXCEPTION 'Optional rejection is only valid for references.' USING ERRCODE = '23514';
  END IF;

  SELECT p.profile_id, p.onboarding_status::text INTO v_profile_id, v_status
    FROM public.providers p WHERE p.id = p_provider_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider not found.' USING ERRCODE = '42501'; END IF;
  IF v_profile_id = v_uid THEN
    RAISE EXCEPTION 'Administrators cannot review their own provider application.' USING ERRCODE = '42501';
  END IF;
  IF v_status NOT IN ('SUBMITTED', 'UNDER_REVIEW', 'NEEDS_CHANGES') THEN
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
    v_stored_decision := 'request_changes';
  ELSIF p_decision = 'rejected' THEN
    PERFORM public.admin_provider_onboarding_action(
      p_provider_id, 'request_changes', p_section, btrim(p_reason), NULL
    );
    v_stored_decision := 'rejected';
  ELSIF p_decision = 'rejected_optional' THEN
    SELECT count(*) INTO v_ref_count FROM public.provider_references WHERE provider_id = p_provider_id;
    IF v_ref_count < 1 THEN
      RAISE EXCEPTION 'At least one reference is required before optional reference review.' USING ERRCODE = '23514';
    END IF;
    v_stored_decision := 'rejected_optional';
  ELSE
    v_stored_decision := p_decision;
  END IF;

  INSERT INTO public.provider_admin_section_reviews
    (provider_id, section, decision, reason, reviewed_by, reviewed_at)
  VALUES (p_provider_id, p_section, v_stored_decision, NULLIF(btrim(p_reason), ''), v_uid, now())
  ON CONFLICT (provider_id, section) DO UPDATE
    SET decision = EXCLUDED.decision, reason = EXCLUDED.reason,
        reviewed_by = EXCLUDED.reviewed_by, reviewed_at = EXCLUDED.reviewed_at;

  IF p_decision IN ('rejected', 'rejected_optional') THEN
    SELECT * INTO v_copy
    FROM public.admin_section_review_notification_copy(p_section, p_reason);
    SELECT * INTO v_provider FROM public.providers WHERE id = p_provider_id;
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id,
      CASE WHEN p_decision = 'rejected_optional' THEN 'provider_reference_optional_rejected' ELSE 'provider_section_rejected' END,
      'provider',
      v_copy.label_en, v_copy.body_en,
      v_copy.label_en, v_copy.label_ar,
      v_copy.body_en, v_copy.body_ar,
      jsonb_build_object(
        'provider_id', p_provider_id,
        'section', p_section,
        'reason', btrim(p_reason),
        'optional_reference', p_decision = 'rejected_optional'
      ),
      v_copy.deep_link
    );
  END IF;
END;
$$;
