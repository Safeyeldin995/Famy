-- Issue #216: service rejection cascade, approval rules, marketplace reasons, provider service lifecycle.

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
  ELSIF p_status = 'approved' AND v_old_status = 'rejected' THEN
    UPDATE public.provider_teaching_capabilities tc
    SET status = 'pending',
        review_note = NULL,
        reviewed_at = NULL,
        reviewed_by = NULL
    WHERE tc.provider_id = v_ps.provider_id
      AND tc.service_id = v_ps.service_id
      AND tc.status = 'rejected';
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

CREATE OR REPLACE FUNCTION public.admin_review_provider_section(
  p_provider_id uuid, p_section text, p_decision text, p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile_id uuid;
  v_status text;
  v_provider public.providers;
  v_body_en text;
  v_body_ar text;
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
  END IF;

  INSERT INTO public.provider_admin_section_reviews
    (provider_id, section, decision, reason, reviewed_by, reviewed_at)
  VALUES (p_provider_id, p_section, p_decision, NULLIF(btrim(p_reason), ''), v_uid, now())
  ON CONFLICT (provider_id, section) DO UPDATE
    SET decision = EXCLUDED.decision, reason = EXCLUDED.reason,
        reviewed_by = EXCLUDED.reviewed_by, reviewed_at = EXCLUDED.reviewed_at;

  IF p_decision = 'rejected' THEN
    SELECT * INTO v_provider FROM public.providers WHERE id = p_provider_id;
    v_body_en := 'Part of your application needs attention: ' || p_section || '.'
      || CASE WHEN p_reason IS NOT NULL AND btrim(p_reason) <> '' THEN ' ' || btrim(p_reason) ELSE '' END;
    v_body_ar := 'جزء من طلبك محتاج تعديل: ' || p_section || '.'
      || CASE WHEN p_reason IS NOT NULL AND btrim(p_reason) <> '' THEN ' ' || btrim(p_reason) ELSE '' END;
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'provider_section_rejected', 'provider',
      'Review update', v_body_en,
      'Review update', 'تحديث المراجعة',
      v_body_en, v_body_ar,
      jsonb_build_object('provider_id', p_provider_id, 'section', p_section, 'reason', btrim(p_reason)),
      CASE p_section
        WHEN 'references' THEN '/pro/setup/references'
        WHEN 'services_prices' THEN '/pro/profile'
        WHEN 'teaching_groups' THEN '/pro/setup/subjects'
        ELSE '/pro/onboarding'
      END
    );
  END IF;
END;
$$;

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

  SELECT * INTO v_ps
  FROM public.provider_services
  WHERE provider_id = v_provider.id AND service_id = p_service_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider service not found.' USING ERRCODE = '42501';
  END IF;

  IF v_provider.onboarding_status = 'APPROVED' THEN
    IF v_ps.status <> 'rejected' THEN
      RAISE EXCEPTION 'Only rejected services can be removed after approval.' USING ERRCODE = '23514';
    END IF;
  ELSIF v_provider.onboarding_status NOT IN ('DRAFT', 'NEEDS_CHANGES') THEN
    RAISE EXCEPTION 'Application is not editable in the current status.' USING ERRCODE = '42501';
  ELSIF v_ps.status = 'approved' THEN
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
    AND status IN ('pending', 'rejected');

  DELETE FROM public.provider_services
  WHERE provider_id = v_provider.id AND service_id = p_service_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'Provider service not found.' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.provider_resubmit_rejected_service(p_service_id uuid)
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

  IF v_ps.status <> 'rejected' THEN
    RAISE EXCEPTION 'Only rejected services can be resubmitted.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.provider_services
  SET status = 'pending', rejection_reason = NULL
  WHERE id = v_ps.id;

  UPDATE public.provider_teaching_capabilities
  SET status = 'pending', review_note = NULL, reviewed_at = NULL, reviewed_by = NULL
  WHERE provider_id = v_provider.id
    AND service_id = p_service_id
    AND status = 'rejected';
END;
$$;

REVOKE ALL ON FUNCTION public.provider_resubmit_rejected_service(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_resubmit_rejected_service(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.marketplace_eligibility_internal(
  p_provider_id uuid, p_service_id uuid DEFAULT NULL, p_address_id uuid DEFAULT NULL
)
RETURNS TABLE (
  provider_id uuid, service_id uuid, service_name_en text, service_name_ar text,
  identity_valid boolean, account_active boolean, verified boolean,
  service_approved boolean, service_active boolean, effective_price numeric,
  minimum_price numeric, maximum_price numeric, price_valid boolean,
  requirements_complete boolean, evidence_approved boolean, zone_covered boolean,
  address_covered boolean, availability_valid boolean, operational_clear boolean,
  is_eligible boolean, failure_reasons text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH candidates AS (
    SELECT p.*, ps.service_id, ps.status AS ps_status, ps.price_override,
           s.name_en AS service_name_en, s.name_ar AS service_name_ar,
           s.is_active AS service_is_active, s.minimum_price, s.maximum_price,
           s.fixed_start_time AS service_fixed_start_time, s.duration_min AS service_duration_min,
           EXISTS (SELECT 1 FROM public.categories cat
             WHERE cat.id = s.category_id AND cat.slug = 'tutoring') AS is_tutoring,
           CASE WHEN EXISTS (SELECT 1 FROM public.categories cat
             WHERE cat.id = s.category_id AND cat.slug = 'tutoring') THEN (
               SELECT MIN(tc.session_price)
               FROM public.provider_teaching_capabilities tc
               WHERE tc.provider_id = p.id AND tc.service_id = s.id AND tc.status = 'approved'
                 AND ps.status = 'approved'
                 AND tc.session_price >= COALESCE(s.minimum_price, 0)
                 AND (s.maximum_price IS NULL OR tc.session_price <= s.maximum_price)
             ) ELSE COALESCE(ps.price_override, p.hourly_rate) END AS effective_price
    FROM public.providers p
    JOIN public.provider_services ps ON ps.provider_id = p.id
    JOIN public.services s ON s.id = ps.service_id
    WHERE p.id = p_provider_id AND (p_service_id IS NULL OR ps.service_id = p_service_id)
  ), checks AS (
    SELECT c.*,
      EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = c.profile_id AND r.role = 'provider')
        AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = c.profile_id AND r.role = 'customer') AS identity_valid,
      (c.is_active AND c.deleted_at IS NULL AND NOT c.vacation_mode AND c.onboarding_status = 'APPROVED') AS account_active,
      (c.is_verified AND c.onboarding_status = 'APPROVED') AS provider_verified,
      (c.ps_status = 'approved') AS service_approved,
      c.service_is_active AS service_active,
      CASE WHEN c.is_tutoring THEN c.effective_price IS NOT NULL ELSE
        (c.effective_price > 0 AND c.effective_price >= COALESCE(c.minimum_price, 0)
          AND (c.maximum_price IS NULL OR c.effective_price <= c.maximum_price)) END AS price_valid,
      NOT EXISTS (
        SELECT 1 FROM public.service_requirements sr
        WHERE sr.service_id = c.service_id AND sr.is_active AND sr.required_for_provider_approval
          AND NOT EXISTS (SELECT 1 FROM public.provider_requirement_fulfillments f
            WHERE f.provider_id = c.id AND f.requirement_id = sr.id AND f.status IN ('passed','waived'))
      ) AS requirements_complete,
      NOT EXISTS (
        SELECT 1 FROM public.service_requirements sr
        WHERE sr.service_id = c.service_id AND sr.is_active AND sr.required_for_provider_approval AND sr.evidence_required
          AND NOT EXISTS (SELECT 1 FROM public.provider_requirement_fulfillments f
            WHERE f.provider_id = c.id AND f.requirement_id = sr.id
              AND (f.status = 'waived' OR (f.status = 'passed' AND f.evidence_storage_path IS NOT NULL)))
      ) AS evidence_approved,
      EXISTS (
        SELECT 1 FROM public.zones z
        JOIN public.zone_services zs ON zs.zone_id = z.id AND zs.service_id = c.service_id
        JOIN public.zone_providers zp ON zp.zone_id = z.id AND zp.provider_id = c.id
        WHERE z.is_active
      ) AS zone_covered,
      CASE WHEN p_address_id IS NULL THEN false ELSE EXISTS (
        SELECT 1 FROM public.addresses a
        JOIN public.zones z ON z.is_active AND (
          (z.boundary_type = 'polygon' AND public.point_in_polygon(a.lat, a.lng, z.polygon))
          OR (z.boundary_type = 'circle' AND 6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(a.lat)) * cos(radians(z.center_lat)) * cos(radians(z.center_lng) - radians(a.lng))
            + sin(radians(a.lat)) * sin(radians(z.center_lat))))) <= z.radius_km)
        )
        JOIN public.zone_services zs ON zs.zone_id = z.id AND zs.service_id = c.service_id
        JOIN public.zone_providers zp ON zp.zone_id = z.id AND zp.provider_id = c.id
        WHERE a.id = p_address_id AND a.lat IS NOT NULL AND a.lng IS NOT NULL
      ) END AS address_covered,
      EXISTS (
        SELECT 1 FROM public.availability_rules ar
        WHERE ar.provider_id = c.id AND ar.end_time > ar.start_time
          AND (
            c.service_fixed_start_time IS NULL
            OR (
              ar.start_time <= c.service_fixed_start_time
              AND ar.end_time::interval >= c.service_fixed_start_time::interval
                + make_interval(mins => COALESCE(c.service_duration_min, 0))
            )
          )
      ) AS availability_valid,
      NOT EXISTS (
        SELECT 1 FROM public.provider_incidents pi
        WHERE pi.provider_id = c.id AND pi.status IN ('open','investigating') AND pi.severity IN ('high','critical')
      ) AS operational_clear,
      (c.onboarding_status <> 'SUSPENDED') AS not_suspended,
      (
        NOT EXISTS (
          SELECT 1
          FROM public.services s_bs
          JOIN public.categories cat_bs ON cat_bs.id = s_bs.category_id
          WHERE s_bs.id = c.service_id AND cat_bs.slug = 'babysitting'
        )
        OR (
          c.max_children_per_booking IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.provider_age_group_capabilities ag
            WHERE ag.provider_id = c.id
          )
        )
      ) AS babysitting_bookable
    FROM candidates c
  ), final AS (
    SELECT x.*,
      (x.identity_valid AND x.account_active AND x.provider_verified AND x.service_approved AND x.service_active
       AND x.price_valid AND x.requirements_complete AND x.evidence_approved AND x.zone_covered
       AND (p_address_id IS NULL OR x.address_covered) AND x.availability_valid AND x.operational_clear AND x.not_suspended
       AND x.babysitting_bookable) AS eligible
    FROM checks x
  )
  SELECT f.id, f.service_id, f.service_name_en, f.service_name_ar,
    f.identity_valid, f.account_active, f.provider_verified AS verified, f.service_approved, f.service_active,
    f.effective_price, f.minimum_price, f.maximum_price, f.price_valid,
    f.requirements_complete, f.evidence_approved, f.zone_covered, f.address_covered,
    f.availability_valid, f.operational_clear, f.eligible,
    array_remove(ARRAY[
      CASE WHEN NOT f.identity_valid THEN 'Identity conflict or missing Provider role' END,
      CASE WHEN NOT f.account_active THEN 'Provider account is inactive, not approved, deleted, or in vacation mode' END,
      CASE WHEN NOT f.provider_verified THEN 'Provider is not verified or onboarding is not approved' END,
      CASE WHEN NOT f.not_suspended THEN 'Provider is suspended' END,
      CASE WHEN f.ps_status = 'rejected' THEN 'Provider-service relationship was rejected by admin' END,
      CASE WHEN f.ps_status = 'pending' THEN 'Provider-service relationship is pending admin approval' END,
      CASE WHEN f.ps_status NOT IN ('approved', 'pending', 'rejected') THEN 'Provider-service relationship is not approved' END,
      CASE WHEN NOT f.service_active THEN 'Service is inactive or hidden from Customers' END,
      CASE WHEN NOT f.price_valid THEN CASE WHEN f.is_tutoring
        THEN 'No approved teaching subject with a valid session price'
        ELSE 'Provider price is missing or outside Admin limits' END END,
      CASE WHEN NOT f.requirements_complete THEN 'Mandatory Provider requirements are incomplete' END,
      CASE WHEN NOT f.evidence_approved THEN 'Required evidence is missing or not approved' END,
      CASE WHEN NOT f.zone_covered THEN 'Active Provider and Service zone coverage is missing' END,
      CASE WHEN p_address_id IS NOT NULL AND NOT f.address_covered THEN 'Customer address is outside applicable active coverage' END,
      CASE WHEN NOT f.availability_valid THEN CASE WHEN f.service_fixed_start_time IS NOT NULL
        THEN 'Working hours do not cover this package''s fixed time'
        ELSE 'Provider has no valid availability' END END,
      CASE WHEN NOT f.operational_clear THEN 'Provider has a blocking operational incident' END,
      CASE WHEN NOT f.babysitting_bookable THEN 'Babysitting maximum children or age-group capabilities are not declared' END
    ], NULL)::text[]
  FROM final f;
$$;

REVOKE ALL ON FUNCTION public.marketplace_eligibility_internal(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
