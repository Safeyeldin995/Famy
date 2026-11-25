-- Block admin self-approval of own pending online price changes (#403).

CREATE OR REPLACE FUNCTION public.admin_review_online_price_change(
  p_provider_service_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ps public.provider_services;
  v_provider public.providers;
  v_service RECORD;
  v_service_name text;
  v_service_name_ar text;
  v_pending numeric(10,2);
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
  IF v_ps.pending_online_price_override IS NULL THEN
    RAISE EXCEPTION 'No pending online price change for this service.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE id = v_ps.provider_id;
  IF v_provider.profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Administrators cannot review their own price change request.' USING ERRCODE = '42501';
  END IF;

  SELECT name_en, name_ar INTO v_service_name, v_service_name_ar FROM public.services WHERE id = v_ps.service_id;
  v_pending := v_ps.pending_online_price_override;

  IF p_decision = 'approved' THEN
    SELECT s.* INTO v_service FROM public.services s WHERE s.id = v_ps.service_id AND s.is_active;
    IF NOT FOUND OR NOT v_service.online_allowed THEN
      RAISE EXCEPTION 'This service does not support online lessons.' USING ERRCODE = '23514';
    END IF;
    IF v_service.minimum_price IS NOT NULL AND v_pending < v_service.minimum_price THEN
      RAISE EXCEPTION 'Online price is below the allowed minimum.' USING ERRCODE = '23514';
    END IF;
    IF v_service.maximum_price IS NOT NULL AND v_pending > v_service.maximum_price THEN
      RAISE EXCEPTION 'Online price is above the allowed maximum.' USING ERRCODE = '23514';
    END IF;

    PERFORM set_config('app.admin_price_change_review', '1', true);
    UPDATE public.provider_services
    SET online_price_override = pending_online_price_override,
        pending_online_price_override = NULL,
        online_price_change_requested_at = NULL,
        online_price_change_reason = NULL
    WHERE id = v_ps.id;

    v_body_en := 'Your online lesson price for ' || COALESCE(v_service_name, 'a service')
      || ' was approved. Customers now see ' || v_pending::text || ' EGP.';
    v_body_ar := 'اتوافق على سعر الحصة الأونلاين لـ '
      || COALESCE(NULLIF(btrim(v_service_name_ar), ''), 'الخدمة')
      || '. السعر الجديد: ' || v_pending::text || ' ج.م.';
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'provider_online_price_change_approved', 'provider',
      'Online price change approved', v_body_en,
      'Online price change approved', 'اتوافق على تغيير السعر الأونلاين',
      v_body_en, v_body_ar,
      jsonb_build_object(
        'provider_id', v_provider.id,
        'provider_service_id', p_provider_service_id,
        'service_id', v_ps.service_id,
        'price', v_pending
      ),
      '/pro/online-lessons'
    );
  ELSE
    UPDATE public.provider_services
    SET pending_online_price_override = NULL,
        online_price_change_requested_at = NULL,
        online_price_change_reason = btrim(p_reason)
    WHERE id = v_ps.id;

    v_body_en := 'Your online price change for ' || COALESCE(v_service_name, 'a service')
      || ' was not approved. Reason: ' || btrim(p_reason);
    v_body_ar := 'ماتوافقش على تغيير سعر الحصة الأونلاين لـ '
      || COALESCE(NULLIF(btrim(v_service_name_ar), ''), 'الخدمة') || '. السبب: ' || btrim(p_reason);
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_provider.profile_id, 'provider_online_price_change_rejected', 'provider',
      'Online price change rejected', v_body_en,
      'Online price change rejected', 'تغيير السعر الأونلاين ماتوافقش عليه',
      v_body_en, v_body_ar,
      jsonb_build_object(
        'provider_id', v_provider.id,
        'provider_service_id', p_provider_service_id,
        'service_id', v_ps.service_id,
        'reason', btrim(p_reason)
      ),
      '/pro/online-lessons'
    );
  END IF;
END;
$$;