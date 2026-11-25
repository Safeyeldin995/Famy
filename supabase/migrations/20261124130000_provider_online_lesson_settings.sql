-- Provider mobile: lesson delivery mode (offering_mode) and online pricing (#403).

ALTER TABLE public.provider_services
  ADD COLUMN IF NOT EXISTS pending_online_price_override numeric(10,2),
  ADD COLUMN IF NOT EXISTS online_price_change_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS online_price_change_reason text;

CREATE OR REPLACE FUNCTION public.tg_guard_provider_service_price_override()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_onboarding text;
  v_pending_fields_changed boolean;
  v_pending_online_fields_changed boolean;
  v_online_price_changed boolean;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.admin_price_change_review', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_pending_fields_changed :=
      NEW.pending_price_override IS DISTINCT FROM OLD.pending_price_override
      OR NEW.price_change_requested_at IS DISTINCT FROM OLD.price_change_requested_at
      OR NEW.price_change_reason IS DISTINCT FROM OLD.price_change_reason;
    v_pending_online_fields_changed :=
      NEW.pending_online_price_override IS DISTINCT FROM OLD.pending_online_price_override
      OR NEW.online_price_change_requested_at IS DISTINCT FROM OLD.online_price_change_requested_at
      OR NEW.online_price_change_reason IS DISTINCT FROM OLD.online_price_change_reason;
    v_online_price_changed :=
      NEW.online_price_override IS DISTINCT FROM OLD.online_price_override;
  ELSE
    v_pending_fields_changed :=
      NEW.pending_price_override IS NOT NULL
      OR NEW.price_change_requested_at IS NOT NULL
      OR NEW.price_change_reason IS NOT NULL;
    v_pending_online_fields_changed :=
      NEW.pending_online_price_override IS NOT NULL
      OR NEW.online_price_change_requested_at IS NOT NULL
      OR NEW.online_price_change_reason IS NOT NULL;
    v_online_price_changed := NEW.online_price_override IS NOT NULL;
  END IF;

  IF v_pending_fields_changed
     AND current_setting('app.provider_price_change_request', true)
       IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION
      'Price change pending fields must be updated through provider_request_price_change or provider_cancel_price_change.'
      USING ERRCODE = '42501';
  END IF;

  IF v_pending_online_fields_changed
     AND current_setting('app.provider_online_price_change_request', true)
       IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION
      'Online price change pending fields must be updated through provider_request_online_price_change or provider_cancel_online_price_change.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT'
     OR NEW.price_override IS DISTINCT FROM OLD.price_override
     OR v_online_price_changed THEN
    SELECT p.onboarding_status::text INTO v_onboarding
    FROM public.providers p
    WHERE p.id = NEW.provider_id;

    IF v_onboarding = 'APPROVED' AND NEW.status = 'approved' THEN
      IF v_online_price_changed THEN
        RAISE EXCEPTION
          'Approved providers must have online price changes reviewed by an admin.'
          USING ERRCODE = '42501';
      END IF;
      IF NEW.price_override IS DISTINCT FROM OLD.price_override THEN
        RAISE EXCEPTION
          'Approved providers must request price changes through provider_request_price_change.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_guard_provider_service_price_override()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.provider_update_offering_mode(p_offering_mode text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_mode text := lower(btrim(p_offering_mode));
  v_online_service_count int;
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'provider') IS NOT TRUE THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;

  IF v_mode NOT IN ('in_person', 'online', 'both') THEN
    RAISE EXCEPTION 'Invalid lesson mode.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501';
  END IF;

  IF v_mode IN ('online', 'both') THEN
    IF v_provider.onboarding_status <> 'APPROVED' OR v_provider.is_verified IS NOT TRUE THEN
      RAISE EXCEPTION
        'Only verified approved providers can enable online lessons.'
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*) INTO v_online_service_count
    FROM public.provider_services ps
    JOIN public.services s ON s.id = ps.service_id
    JOIN public.categories c ON c.id = s.category_id
    WHERE ps.provider_id = v_provider.id
      AND ps.status = 'approved'
      AND s.is_active
      AND c.is_active
      AND s.online_allowed
      AND c.online_allowed;

    IF v_online_service_count < 1 THEN
      RAISE EXCEPTION
        'Add and get approval for at least one service that supports online lessons first.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.providers
  SET offering_mode = v_mode
  WHERE id = v_provider.id;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_update_offering_mode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_update_offering_mode(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.provider_set_online_service_price(
  p_service_id uuid,
  p_price numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT * INTO v_ps
  FROM public.provider_services
  WHERE provider_id = v_provider.id AND service_id = p_service_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider service not found.' USING ERRCODE = '42501';
  END IF;

  SELECT s.*, c.slug AS category_slug, c.online_allowed AS category_online_allowed
  INTO v_service
  FROM public.services s
  JOIN public.categories c ON c.id = s.category_id
  WHERE s.id = p_service_id
    AND s.is_active;

  IF NOT FOUND OR NOT v_service.online_allowed OR NOT v_service.category_online_allowed THEN
    RAISE EXCEPTION 'This service does not support online lessons.' USING ERRCODE = '23514';
  END IF;
  IF v_service.category_slug = 'tutoring' THEN
    RAISE EXCEPTION 'Use teaching capability settings for online tutoring prices.'
      USING ERRCODE = '23514';
  END IF;

  IF v_price <= 0
     OR (v_service.minimum_price IS NOT NULL AND v_price < v_service.minimum_price)
     OR (v_service.maximum_price IS NOT NULL AND v_price > v_service.maximum_price) THEN
    RAISE EXCEPTION 'Online price must be within the allowed minimum and maximum.'
      USING ERRCODE = '23514';
  END IF;

  IF v_provider.onboarding_status = 'APPROVED' AND v_ps.status = 'approved' THEN
    RAISE EXCEPTION
      'Approved providers must request online price changes through provider_request_online_price_change.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.provider_services
  SET online_price_override = v_price
  WHERE id = v_ps.id;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_set_online_service_price(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_set_online_service_price(uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.provider_request_online_price_change(
  p_service_id uuid,
  p_price numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    RAISE EXCEPTION 'Online price change requests are only for approved providers.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ps
  FROM public.provider_services
  WHERE provider_id = v_provider.id AND service_id = p_service_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider service not found.' USING ERRCODE = '42501';
  END IF;
  IF v_ps.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved services can request an online price change.'
      USING ERRCODE = '23514';
  END IF;

  SELECT s.*, c.online_allowed AS category_online_allowed
  INTO v_service
  FROM public.services s
  JOIN public.categories c ON c.id = s.category_id
  WHERE s.id = p_service_id AND s.is_active;
  IF NOT FOUND OR NOT v_service.online_allowed OR NOT v_service.category_online_allowed THEN
    RAISE EXCEPTION 'This service does not support online lessons.' USING ERRCODE = '23514';
  END IF;

  IF v_price <= 0
     OR (v_service.minimum_price IS NOT NULL AND v_price < v_service.minimum_price)
     OR (v_service.maximum_price IS NOT NULL AND v_price > v_service.maximum_price) THEN
    RAISE EXCEPTION 'Online price must be within the allowed minimum and maximum.'
      USING ERRCODE = '23514';
  END IF;

  IF v_ps.online_price_override IS NOT DISTINCT FROM v_price THEN
    RAISE EXCEPTION 'Requested online price matches the current live price.' USING ERRCODE = '23514';
  END IF;
  IF v_ps.pending_online_price_override IS NOT DISTINCT FROM v_price THEN
    RETURN;
  END IF;

  PERFORM set_config('app.provider_online_price_change_request', '1', true);
  UPDATE public.provider_services
  SET pending_online_price_override = v_price,
      online_price_change_requested_at = now(),
      online_price_change_reason = NULL
  WHERE id = v_ps.id;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_request_online_price_change(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_request_online_price_change(uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.provider_cancel_online_price_change(p_service_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF v_ps.pending_online_price_override IS NULL THEN
    RETURN;
  END IF;

  PERFORM set_config('app.provider_online_price_change_request', '1', true);
  UPDATE public.provider_services
  SET pending_online_price_override = NULL,
      online_price_change_requested_at = NULL,
      online_price_change_reason = NULL
  WHERE id = v_ps.id;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_cancel_online_price_change(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_cancel_online_price_change(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.provider_update_teaching_online_session_price(
  p_capability_id uuid,
  p_price numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider_id uuid;
  v_cap public.provider_teaching_capabilities;
  v_service RECORD;
  v_price numeric(10,2);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_provider_id FROM public.providers WHERE profile_id = v_uid;
  IF v_provider_id IS NULL THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Provider profile required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cap
  FROM public.provider_teaching_capabilities
  WHERE id = p_capability_id AND provider_id = v_provider_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEACHING_UNAUTHORIZED: Capability does not belong to this provider.'
      USING ERRCODE = '42501';
  END IF;
  IF v_cap.status <> 'approved' THEN
    RAISE EXCEPTION
      'Only approved teaching capabilities can set an online session price.'
      USING ERRCODE = '23514';
  END IF;

  IF p_price IS NULL THEN
    UPDATE public.provider_teaching_capabilities
    SET online_session_price = NULL
    WHERE id = v_cap.id;
    RETURN;
  END IF;

  v_price := round(p_price::numeric, 2);
  IF v_price <= 0 THEN
    RAISE EXCEPTION 'TEACHING_INVALID_PRICE: Online price must be positive.'
      USING ERRCODE = '23514';
  END IF;

  SELECT s.* INTO v_service
  FROM public.services s
  WHERE s.id = v_cap.service_id;
  IF v_service.minimum_price IS NOT NULL AND v_price < v_service.minimum_price THEN
    RAISE EXCEPTION 'TEACHING_INVALID_PRICE: Online price is below the allowed minimum.'
      USING ERRCODE = '23514';
  END IF;
  IF v_service.maximum_price IS NOT NULL AND v_price > v_service.maximum_price THEN
    RAISE EXCEPTION 'TEACHING_INVALID_PRICE: Online price is above the allowed maximum.'
      USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.provider_online_price_update', '1', true);
  UPDATE public.provider_teaching_capabilities
  SET online_session_price = v_price
  WHERE id = v_cap.id;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_update_teaching_online_session_price(uuid, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_update_teaching_online_session_price(uuid, numeric)
  TO authenticated;

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

REVOKE ALL ON FUNCTION public.admin_review_online_price_change(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_online_price_change(uuid, text, text) TO authenticated;