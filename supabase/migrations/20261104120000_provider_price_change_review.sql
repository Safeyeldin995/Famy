-- Provider price changes after approval require admin review before customers see them.
-- Review-only migration: do not apply to Production from this PR.

ALTER TABLE public.provider_services
  ADD COLUMN IF NOT EXISTS pending_price_override numeric(10,2),
  ADD COLUMN IF NOT EXISTS price_change_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS price_change_reason text;

COMMENT ON COLUMN public.provider_services.price_change_reason IS
  'Admin rejection reason for the most recent price change request; cleared when a new request is submitted.';

CREATE OR REPLACE FUNCTION public.tg_guard_provider_service_price_override()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_onboarding text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.price_override IS NOT DISTINCT FROM OLD.price_override THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.admin_price_change_review', true) = '1' THEN
    RETURN NEW;
  END IF;

  SELECT p.onboarding_status::text INTO v_onboarding
  FROM public.providers p WHERE p.id = NEW.provider_id;

  IF v_onboarding = 'APPROVED' AND NEW.status = 'approved' THEN
    RAISE EXCEPTION 'Approved providers must request price changes through provider_request_price_change.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_guard_provider_service_price_override() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_provider_service_price_override ON public.provider_services;
CREATE TRIGGER trg_guard_provider_service_price_override
  BEFORE INSERT OR UPDATE OF price_override ON public.provider_services
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_provider_service_price_override();

CREATE OR REPLACE FUNCTION public.provider_request_price_change(
  p_service_id uuid,
  p_price numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_ps public.provider_services;
  v_service RECORD;
  v_price numeric(10,2);
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'provider') IS NOT TRUE THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;

  v_price := round(p_price::numeric, 2);

  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501';
  END IF;
  IF v_provider.onboarding_status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Price change requests are only for approved providers.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ps
  FROM public.provider_services
  WHERE provider_id = v_provider.id AND service_id = p_service_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider service not found.' USING ERRCODE = '42501';
  END IF;
  IF v_ps.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved services can request a price change.' USING ERRCODE = '23514';
  END IF;

  SELECT s.* INTO v_service FROM public.services s WHERE s.id = p_service_id AND s.is_active;
  IF NOT FOUND OR NOT v_service.provider_pricing_allowed THEN
    RAISE EXCEPTION 'This service does not allow provider-set pricing.' USING ERRCODE = '23514';
  END IF;
  IF v_service.minimum_price IS NOT NULL AND v_price < v_service.minimum_price THEN
    RAISE EXCEPTION 'Price is below the allowed minimum.' USING ERRCODE = '23514';
  END IF;
  IF v_service.maximum_price IS NOT NULL AND v_price > v_service.maximum_price THEN
    RAISE EXCEPTION 'Price is above the allowed maximum.' USING ERRCODE = '23514';
  END IF;

  IF v_ps.price_override IS NOT DISTINCT FROM v_price THEN
    RAISE EXCEPTION 'Requested price matches the current live price.' USING ERRCODE = '23514';
  END IF;

  IF v_ps.pending_price_override IS NOT DISTINCT FROM v_price THEN
    RETURN;
  END IF;

  UPDATE public.provider_services
  SET pending_price_override = v_price,
      price_change_requested_at = now(),
      price_change_reason = NULL
  WHERE id = v_ps.id;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_request_price_change(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_request_price_change(uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.provider_cancel_price_change(p_service_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_ps public.provider_services;
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'provider') IS NOT TRUE THEN
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
  IF v_ps.pending_price_override IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.provider_services
  SET pending_price_override = NULL,
      price_change_requested_at = NULL,
      price_change_reason = NULL
  WHERE id = v_ps.id;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_cancel_price_change(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_cancel_price_change(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_price_change(
  p_provider_service_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ps public.provider_services;
  v_provider public.providers;
  v_service_name text;
  v_service_name_ar text;
  v_body_en text;
  v_body_ar text;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid price change decision.' USING ERRCODE = '23514';
  END IF;
  IF p_decision = 'rejected' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'A reason is required to reject a price change request.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_ps FROM public.provider_services WHERE id = p_provider_service_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider service not found.' USING ERRCODE = '42501';
  END IF;
  IF v_ps.pending_price_override IS NULL THEN
    RAISE EXCEPTION 'No pending price change for this service.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE id = v_ps.provider_id;
  SELECT name_en, name_ar INTO v_service_name, v_service_name_ar FROM public.services WHERE id = v_ps.service_id;

  IF p_decision = 'approved' THEN
    PERFORM set_config('app.admin_price_change_review', '1', true);
    UPDATE public.provider_services
    SET price_override = pending_price_override,
        pending_price_override = NULL,
        price_change_requested_at = NULL,
        price_change_reason = NULL
    WHERE id = v_ps.id;

    v_body_en := 'Your price change for ' || COALESCE(v_service_name, 'a service')
      || ' was approved. Customers now see ' || v_ps.pending_price_override::text || ' EGP.';
    v_body_ar := 'اتوافق على تغيير سعر ' || COALESCE(NULLIF(btrim(v_service_name_ar), ''), 'الخدمة')
      || '. السعر الجديد للعملاء: ' || v_ps.pending_price_override::text || ' ج.م.';
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'provider_price_change_approved', 'provider',
      'Price change approved', v_body_en,
      'Price change approved', 'اتوافق على تغيير السعر',
      v_body_en, v_body_ar,
      jsonb_build_object(
        'provider_id', v_provider.id,
        'provider_service_id', p_provider_service_id,
        'service_id', v_ps.service_id,
        'price', v_ps.pending_price_override
      ),
      '/pro/profile#price-' || v_ps.service_id::text
    );
  ELSE
    UPDATE public.provider_services
    SET pending_price_override = NULL,
        price_change_requested_at = NULL,
        price_change_reason = btrim(p_reason)
    WHERE id = v_ps.id;

    v_body_en := 'Your price change for ' || COALESCE(v_service_name, 'a service') || ' was not approved.'
      || ' Reason: ' || btrim(p_reason);
    v_body_ar := 'ماتوافقش على تغيير سعر ' || COALESCE(NULLIF(btrim(v_service_name_ar), ''), 'الخدمة') || '.'
      || ' السبب: ' || btrim(p_reason);
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'provider_price_change_rejected', 'provider',
      'Price change rejected', v_body_en,
      'Price change rejected', 'تغيير السعر ماتوافقش عليه',
      v_body_en, v_body_ar,
      jsonb_build_object(
        'provider_id', v_provider.id,
        'provider_service_id', p_provider_service_id,
        'service_id', v_ps.service_id,
        'reason', btrim(p_reason)
      ),
      '/pro/profile#price-' || v_ps.service_id::text
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_price_change(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_price_change(uuid, text, text) TO authenticated;

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
  SELECT 'price_change_requests'::text, count(*) FROM public.provider_services ps
    WHERE ps.pending_price_override IS NOT NULL AND ps.status = 'approved'
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
  ELSIF p_queue = 'price_change_requests' THEN
    RETURN QUERY SELECT DISTINCT ps.provider_id FROM public.provider_services ps
      WHERE ps.pending_price_override IS NOT NULL AND ps.status = 'approved'
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
