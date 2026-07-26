-- PATCH 5 hardening: marketplace onboarding_status gate, document review, signed URLs.

CREATE OR REPLACE FUNCTION public.provider_required_documents_approved(p_provider_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.provider_documents d
    WHERE d.provider_id = p_provider_id
      AND d.type IN ('id_card_front', 'id_card_back')
      AND d.status <> 'approved'
  )
  AND EXISTS (
    SELECT 1 FROM public.provider_documents d
    WHERE d.provider_id = p_provider_id AND d.type = 'id_card_front' AND d.status = 'approved'
  )
  AND EXISTS (
    SELECT 1 FROM public.provider_documents d
    WHERE d.provider_id = p_provider_id AND d.type = 'id_card_back' AND d.status = 'approved'
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_review_provider_document(
  p_document_id uuid,
  p_status public.verification_status,
  p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = p_document_id;

  PERFORM public.log_provider_onboarding_event(
    v_doc.provider_id, auth.uid(), 'admin',
    CASE WHEN p_status = 'approved' THEN 'document_approved' ELSE 'document_rejected' END,
    NULL, NULL,
    jsonb_build_object('document_id', p_document_id, 'document_type', v_doc.type::text)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_provider_document(uuid, public.verification_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_provider_document(uuid, public.verification_status, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.provider_onboarding_completion(p_provider_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider public.providers;
  v_profile public.profiles;
  v_details public.provider_onboarding_details;
  v_service_count int;
  v_zone_count int;
  v_ref_count int;
  v_errors jsonb := '{}'::jsonb;
  v_complete boolean := true;
BEGIN
  SELECT * INTO v_provider FROM public.providers WHERE id = p_provider_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_provider.profile_id;
  SELECT * INTO v_details FROM public.provider_onboarding_details WHERE provider_id = p_provider_id;

  IF v_profile.full_name IS NULL OR btrim(v_profile.full_name) = '' THEN
    v_errors := v_errors || jsonb_build_object('personal', 'legal_name_required'); v_complete := false;
  END IF;
  IF v_profile.phone IS NULL OR btrim(v_profile.phone) = '' THEN
    v_errors := v_errors || jsonb_build_object('personal', 'phone_required'); v_complete := false;
  END IF;
  IF v_details.provider_id IS NULL OR v_details.date_of_birth IS NULL OR v_details.governorate IS NULL OR btrim(v_details.governorate) = ''
     OR v_details.area IS NULL OR btrim(v_details.area) = '' OR v_details.full_address IS NULL OR btrim(v_details.full_address) = '' THEN
    v_errors := v_errors || jsonb_build_object('personal', 'personal_details_incomplete'); v_complete := false;
  END IF;
  IF v_profile.avatar_url IS NULL OR btrim(v_profile.avatar_url) = '' THEN
    v_errors := v_errors || jsonb_build_object('personal', 'profile_photo_required'); v_complete := false;
  END IF;

  SELECT count(*) INTO v_service_count
  FROM public.provider_services ps
  JOIN public.services s ON s.id = ps.service_id
  JOIN public.categories c ON c.id = s.category_id
  WHERE ps.provider_id = p_provider_id AND s.is_active AND c.is_active AND public.is_phase1_category_slug(c.slug);
  IF v_service_count < 1 THEN v_errors := v_errors || jsonb_build_object('services', 'service_required'); v_complete := false; END IF;

  IF COALESCE(v_provider.years_experience, 0) < 0 OR (COALESCE(v_provider.bio_en, '') = '' AND COALESCE(v_provider.bio_ar, '') = '') THEN
    v_errors := v_errors || jsonb_build_object('experience', 'experience_incomplete'); v_complete := false;
  END IF;

  SELECT count(*) INTO v_zone_count FROM public.zone_providers zp JOIN public.zones z ON z.id = zp.zone_id
  WHERE zp.provider_id = p_provider_id AND z.is_active;
  IF v_zone_count < 1 THEN v_errors := v_errors || jsonb_build_object('coverage', 'zone_required'); v_complete := false; END IF;

  SELECT count(*) INTO v_ref_count FROM public.provider_references WHERE provider_id = p_provider_id;
  IF v_ref_count < 2 THEN v_errors := v_errors || jsonb_build_object('references', 'two_references_required'); v_complete := false; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.provider_documents d WHERE d.provider_id = p_provider_id AND d.type = 'id_card_front') THEN
    v_errors := v_errors || jsonb_build_object('documents', 'national_id_required'); v_complete := false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.provider_documents d WHERE d.provider_id = p_provider_id AND d.type = 'id_card_back') THEN
    v_errors := v_errors || jsonb_build_object('documents', 'national_id_required'); v_complete := false;
  END IF;

  IF v_details.accuracy_confirmed_at IS NULL THEN
    v_errors := v_errors || jsonb_build_object('review', 'accuracy_confirmation_required'); v_complete := false;
  END IF;

  RETURN jsonb_build_object('ok', true, 'complete', v_complete, 'errors', v_errors);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_provider_onboarding_action(
  p_provider_id uuid, p_action text,
  p_reason_code text DEFAULT NULL, p_reason_public text DEFAULT NULL, p_notes_internal text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_new_status public.provider_onboarding_status;
  v_completion jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE id = p_provider_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider not found.' USING ERRCODE = '42501'; END IF;

  IF p_action = 'start_review' THEN
    IF v_provider.onboarding_status <> 'SUBMITTED' THEN RAISE EXCEPTION 'Only submitted applications can enter review.' USING ERRCODE = '23514'; END IF;
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
    IF v_provider.onboarding_status NOT IN ('SUBMITTED', 'UNDER_REVIEW') THEN RAISE EXCEPTION 'Invalid status for requesting changes.' USING ERRCODE = '23514'; END IF;
    IF p_reason_code IS NULL OR btrim(p_reason_code) = '' OR p_reason_public IS NULL OR btrim(p_reason_public) = '' THEN
      RAISE EXCEPTION 'A reason is required to request changes.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'NEEDS_CHANGES';
  ELSIF p_action = 'reject' THEN
    IF v_provider.onboarding_status NOT IN ('SUBMITTED', 'UNDER_REVIEW', 'NEEDS_CHANGES') THEN RAISE EXCEPTION 'Invalid status for rejection.' USING ERRCODE = '23514'; END IF;
    IF p_reason_code IS NULL OR btrim(p_reason_code) = '' OR p_reason_public IS NULL OR btrim(p_reason_public) = '' THEN
      RAISE EXCEPTION 'A reason is required to reject an application.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'REJECTED';
  ELSIF p_action = 'suspend' THEN
    IF v_provider.onboarding_status <> 'APPROVED' THEN RAISE EXCEPTION 'Only approved providers can be suspended.' USING ERRCODE = '23514'; END IF;
    IF p_reason_code IS NULL OR btrim(p_reason_code) = '' OR p_reason_public IS NULL OR btrim(p_reason_public) = '' THEN
      RAISE EXCEPTION 'A reason is required to suspend a provider.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'SUSPENDED';
  ELSIF p_action = 'unsuspend' THEN
    IF v_provider.onboarding_status <> 'SUSPENDED' THEN RAISE EXCEPTION 'Provider is not suspended.' USING ERRCODE = '23514'; END IF;
    v_new_status := 'APPROVED';
  ELSE
    RAISE EXCEPTION 'Unknown admin action.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.audit_reason', COALESCE(btrim(p_reason_public), ''), true);
  PERFORM public.apply_provider_onboarding_status(p_provider_id, v_new_status, v_uid, 'admin', p_action, p_reason_code, p_reason_public, p_notes_internal, '{}'::jsonb);
END;
$$;

-- Marketplace eligibility: require onboarding_status APPROVED and not suspended.
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
           COALESCE(ps.price_override, p.hourly_rate) AS effective_price
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
      (c.effective_price > 0 AND c.effective_price >= COALESCE(c.minimum_price, 0)
        AND (c.maximum_price IS NULL OR c.effective_price <= c.maximum_price)) AS price_valid,
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
      EXISTS (SELECT 1 FROM public.availability_rules ar WHERE ar.provider_id = c.id AND ar.end_time > ar.start_time) AS availability_valid,
      NOT EXISTS (
        SELECT 1 FROM public.provider_incidents pi
        WHERE pi.provider_id = c.id AND pi.status IN ('open','investigating') AND pi.severity IN ('high','critical')
      ) AS operational_clear,
      (c.onboarding_status <> 'SUSPENDED') AS not_suspended
    FROM candidates c
  ), final AS (
    SELECT x.*,
      (x.identity_valid AND x.account_active AND x.provider_verified AND x.service_approved AND x.service_active
       AND x.price_valid AND x.requirements_complete AND x.evidence_approved AND x.zone_covered
       AND (p_address_id IS NULL OR x.address_covered) AND x.availability_valid AND x.operational_clear AND x.not_suspended) AS eligible
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
      CASE WHEN NOT f.service_approved THEN 'Provider-service relationship is not approved' END,
      CASE WHEN NOT f.service_active THEN 'Service is inactive or hidden from Customers' END,
      CASE WHEN NOT f.price_valid THEN 'Provider price is missing or outside Admin limits' END,
      CASE WHEN NOT f.requirements_complete THEN 'Mandatory Provider requirements are incomplete' END,
      CASE WHEN NOT f.evidence_approved THEN 'Required evidence is missing or not approved' END,
      CASE WHEN NOT f.zone_covered THEN 'Active Provider and Service zone coverage is missing' END,
      CASE WHEN p_address_id IS NOT NULL AND NOT f.address_covered THEN 'Customer address is outside applicable active coverage' END,
      CASE WHEN NOT f.availability_valid THEN 'Provider has no valid availability' END,
      CASE WHEN NOT f.operational_clear THEN 'Provider has a blocking operational incident' END
    ], NULL)::text[]
  FROM final f;
$$;
