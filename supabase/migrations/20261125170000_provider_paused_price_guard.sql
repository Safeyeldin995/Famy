-- Block direct price edits while a service is paused (same rules as approved).

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

    IF v_onboarding = 'APPROVED' AND NEW.status IN ('approved', 'paused') THEN
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