-- Patch 2 / Module 1: Service Pricing Limits.
-- Additive only. pricing_model, duration_min (the "default duration"), and
-- is_active already existed and are reused as-is.

-- ============================================================
-- 1) Per-service pricing limits
-- ============================================================
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS minimum_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS maximum_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS maximum_extras_total numeric(10,2),
  ADD COLUMN IF NOT EXISTS provider_pricing_allowed boolean NOT NULL DEFAULT false;

ALTER TABLE public.services DROP CONSTRAINT IF EXISTS services_price_limits_check;
ALTER TABLE public.services ADD CONSTRAINT services_price_limits_check CHECK (
  (minimum_price IS NULL OR minimum_price >= 0) AND
  (maximum_price IS NULL OR maximum_price >= 0) AND
  (maximum_extras_total IS NULL OR maximum_extras_total >= 0) AND
  (minimum_price IS NULL OR maximum_price IS NULL OR maximum_price >= minimum_price)
);

-- ============================================================
-- 2) Provider-set price must respect the service's current rules —
-- enforced at the database level regardless of caller (provider, admin, or
-- a direct API request), not just in the UI.
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_validate_provider_price()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_service RECORD;
BEGIN
  IF NEW.price_override IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_service FROM public.services WHERE id = NEW.service_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NOT v_service.provider_pricing_allowed THEN
    RAISE EXCEPTION 'This service does not allow provider-set pricing.' USING ERRCODE = '23514';
  END IF;
  IF v_service.minimum_price IS NOT NULL AND NEW.price_override < v_service.minimum_price THEN
    RAISE EXCEPTION 'Price is below the minimum allowed for this service.' USING ERRCODE = '23514';
  END IF;
  IF v_service.maximum_price IS NOT NULL AND NEW.price_override > v_service.maximum_price THEN
    RAISE EXCEPTION 'Price is above the maximum allowed for this service.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_provider_price ON public.provider_services;
CREATE TRIGGER trg_validate_provider_price
  BEFORE INSERT OR UPDATE OF price_override ON public.provider_services
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_provider_price();

-- Admin visibility when tightened limits leave an existing provider price
-- out of range — flagged for review, never silently changed or deactivated.
ALTER TABLE public.provider_services
  ADD COLUMN IF NOT EXISTS flagged_for_review boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.tg_flag_provider_services_on_limit_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.minimum_price IS DISTINCT FROM OLD.minimum_price
     OR NEW.maximum_price IS DISTINCT FROM OLD.maximum_price
     OR NEW.provider_pricing_allowed IS DISTINCT FROM OLD.provider_pricing_allowed
  THEN
    UPDATE public.provider_services ps
      SET flagged_for_review = true
      WHERE ps.service_id = NEW.id
        AND ps.price_override IS NOT NULL
        AND (
          NOT NEW.provider_pricing_allowed
          OR (NEW.minimum_price IS NOT NULL AND ps.price_override < NEW.minimum_price)
          OR (NEW.maximum_price IS NOT NULL AND ps.price_override > NEW.maximum_price)
        );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_flag_provider_services_on_limit_change ON public.services;
CREATE TRIGGER trg_flag_provider_services_on_limit_change
  AFTER UPDATE OF minimum_price, maximum_price, provider_pricing_allowed ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.tg_flag_provider_services_on_limit_change();

-- ============================================================
-- 3) Booking creation must validate the provider's *current* effective
-- price against the service's *current* rules and against the submitted
-- price_subtotal — a client can no longer submit an arbitrary subtotal.
-- Extends the existing BEFORE INSERT guard (tg_validate_booking_service).
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_validate_booking_service()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_addr RECORD;
  v_zone RECORD;
  v_service RECORD;
  v_ps RECORD;
  v_provider_hourly_rate numeric(10,2);
  v_rate numeric(10,2);
  v_hours numeric;
  v_expected_subtotal numeric(10,2);
BEGIN
  SELECT * INTO v_service FROM public.services WHERE id = NEW.service_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected service is not currently available.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_ps FROM public.provider_services
    WHERE provider_id = NEW.provider_id AND service_id = NEW.service_id AND status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This provider is not approved to offer the selected service.' USING ERRCODE = '23514';
  END IF;

  IF NEW.address_id IS NULL THEN
    RAISE EXCEPTION 'A saved address with a valid location is required to book.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_addr FROM public.addresses WHERE id = NEW.address_id;
  IF NOT FOUND OR v_addr.lat IS NULL OR v_addr.lng IS NULL THEN
    RAISE EXCEPTION 'Selected address has no valid location coordinates.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_zone FROM public.resolve_zone(v_addr.lat, v_addr.lng);
  IF v_zone.zone_id IS NULL THEN
    RAISE EXCEPTION 'This area is not currently served.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.zone_services zs WHERE zs.zone_id = v_zone.zone_id AND zs.service_id = NEW.service_id) THEN
    RAISE EXCEPTION 'The selected service is not offered in this area.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.zone_providers zp WHERE zp.zone_id = v_zone.zone_id AND zp.provider_id = NEW.provider_id) THEN
    RAISE EXCEPTION 'This provider does not serve the selected area.' USING ERRCODE = '23514';
  END IF;

  -- ---- Provider price validation ----
  -- Actual booking pricing has always come from provider_services.price_override,
  -- falling back to the provider's own hourly_rate (services.base_price is not
  -- used for pricing — see supabase/migrations/20260712150000, unchanged here).
  -- minimum_price/maximum_price only ever bound an explicit price_override.
  SELECT hourly_rate INTO v_provider_hourly_rate FROM public.providers WHERE id = NEW.provider_id;
  v_rate := COALESCE(v_ps.price_override, v_provider_hourly_rate);
  IF v_ps.price_override IS NOT NULL THEN
    IF NOT v_service.provider_pricing_allowed
       OR (v_service.minimum_price IS NOT NULL AND v_rate < v_service.minimum_price)
       OR (v_service.maximum_price IS NOT NULL AND v_rate > v_service.maximum_price)
    THEN
      RAISE EXCEPTION 'This provider''s price for the selected service no longer meets current pricing rules.' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_service.pricing_model = 'hourly' THEN
    v_hours := EXTRACT(EPOCH FROM (NEW.end_at - NEW.start_at)) / 3600.0;
    v_expected_subtotal := ROUND(v_rate * v_hours, 2);
  ELSE
    v_expected_subtotal := v_rate;
  END IF;

  IF ABS(NEW.price_subtotal - v_expected_subtotal) > 0.01 THEN
    RAISE EXCEPTION 'Booking price does not match the current service price.' USING ERRCODE = '23514';
  END IF;

  PERFORM public.check_booking_slot(NEW.provider_id, NEW.start_at, NEW.end_at, NULL);

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_validate_booking_service() FROM PUBLIC, anon, authenticated;
