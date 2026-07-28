-- PATCH 6A: canonical create_booking RPC, idempotency, RPC-only customer inserts.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS request_fingerprint text;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_customer_idempotency_unique
  ON public.bookings (customer_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Force pending status on all non-service_role inserts (defense against status tampering).
CREATE OR REPLACE FUNCTION public.tg_bookings_normalize_insert_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    NEW.status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_bookings_normalize_insert_status() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_bookings_normalize_insert_status ON public.bookings;
CREATE TRIGGER trg_bookings_normalize_insert_status
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_bookings_normalize_insert_status();

-- Internal fingerprint for idempotency conflict detection.
CREATE OR REPLACE FUNCTION public.booking_request_fingerprint(
  p_provider_id uuid,
  p_service_id uuid,
  p_address_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_family_member_id uuid,
  p_notes text,
  p_promo_code_id uuid,
  p_requirement_selections jsonb
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT encode(extensions.digest(concat_ws('|',
    p_provider_id::text,
    p_service_id::text,
    p_address_id::text,
    p_start_at::text,
    p_end_at::text,
    coalesce(p_family_member_id::text, ''),
    coalesce(p_notes, ''),
    coalesce(p_promo_code_id::text, ''),
    coalesce(p_requirement_selections::text, '[]')
  ), 'sha256'), 'hex');
$$;
REVOKE ALL ON FUNCTION public.booking_request_fingerprint(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;

-- Extend authoritative pricing trigger to support RPC-only inserts (server computes prices).
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
  v_req RECORD;
  v_selection jsonb;
  v_extras_total numeric(10,2) := 0;
  v_promo RECORD;
  v_discount numeric(10,2);
  v_used_by_customer int;
  v_billing jsonb;
  v_platform_fee numeric(10,2);
  v_vat_percent numeric;
  v_vat numeric(10,2);
  v_travel_fee numeric(10,2);
  v_expected_total numeric(10,2);
  v_fm RECORD;
  v_rpc_insert boolean := current_setting('app.create_booking_in_progress', true) = 'on';
BEGIN
  SELECT * INTO v_service FROM public.services WHERE id = NEW.service_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_SERVICE_UNAVAILABLE: Selected service is not currently available.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_ps FROM public.provider_services
    WHERE provider_id = NEW.provider_id AND service_id = NEW.service_id AND status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: This provider is not approved to offer the selected service.' USING ERRCODE = '23514';
  END IF;

  IF NEW.address_id IS NULL THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: A saved address with a valid location is required to book.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_addr FROM public.addresses WHERE id = NEW.address_id;
  IF NOT FOUND OR v_addr.lat IS NULL OR v_addr.lng IS NULL THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Selected address has no valid location coordinates.' USING ERRCODE = '23514';
  END IF;

  IF v_addr.user_id IS DISTINCT FROM NEW.customer_id THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Address does not belong to this customer.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.zones z
    WHERE z.is_active AND (
      (z.boundary_type = 'polygon' AND public.point_in_polygon(v_addr.lat, v_addr.lng, z.polygon))
      OR (z.boundary_type = 'circle' AND 6371 * acos(LEAST(1, GREATEST(-1,
        cos(radians(v_addr.lat)) * cos(radians(z.center_lat)) * cos(radians(z.center_lng) - radians(v_addr.lng))
        + sin(radians(v_addr.lat)) * sin(radians(z.center_lat))))) <= z.radius_km)
    )
  ) THEN
    RAISE EXCEPTION 'BOOKING_ADDRESS_OUTSIDE_ZONE: This area is not currently served.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.zones z
    JOIN public.zone_services zs ON zs.zone_id = z.id AND zs.service_id = NEW.service_id
    JOIN public.zone_providers zp ON zp.zone_id = z.id AND zp.provider_id = NEW.provider_id
    WHERE z.is_active AND (
      (z.boundary_type = 'polygon' AND public.point_in_polygon(v_addr.lat, v_addr.lng, z.polygon))
      OR (z.boundary_type = 'circle' AND 6371 * acos(LEAST(1, GREATEST(-1,
        cos(radians(v_addr.lat)) * cos(radians(z.center_lat)) * cos(radians(z.center_lng) - radians(v_addr.lng))
        + sin(radians(v_addr.lat)) * sin(radians(z.center_lat))))) <= z.radius_km)
    )
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.zones z
      JOIN public.zone_services zs ON zs.zone_id = z.id AND zs.service_id = NEW.service_id
      WHERE z.is_active AND (
        (z.boundary_type = 'polygon' AND public.point_in_polygon(v_addr.lat, v_addr.lng, z.polygon))
        OR (z.boundary_type = 'circle' AND 6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(v_addr.lat)) * cos(radians(z.center_lat)) * cos(radians(z.center_lng) - radians(v_addr.lng))
          + sin(radians(v_addr.lat)) * sin(radians(z.center_lat))))) <= z.radius_km)
      )
    ) THEN
      RAISE EXCEPTION 'BOOKING_ADDRESS_OUTSIDE_ZONE: The selected service is not offered in this area.' USING ERRCODE = '23514';
    END IF;
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: This provider does not serve the selected area.' USING ERRCODE = '23514';
  END IF;

  IF NEW.family_member_id IS NOT NULL THEN
    SELECT * INTO v_fm FROM public.family_members WHERE id = NEW.family_member_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Selected family member was not found.' USING ERRCODE = '23514';
    END IF;
    IF v_fm.customer_id IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Selected family member does not belong to this customer.' USING ERRCODE = '42501';
    END IF;
    IF NOT v_fm.is_active THEN
      RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Selected family member is no longer active.' USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT hourly_rate INTO v_provider_hourly_rate FROM public.providers WHERE id = NEW.provider_id;
  v_rate := COALESCE(v_ps.price_override, v_provider_hourly_rate);
  IF v_ps.price_override IS NOT NULL THEN
    IF NOT v_service.provider_pricing_allowed
       OR (v_service.minimum_price IS NOT NULL AND v_rate < v_service.minimum_price)
       OR (v_service.maximum_price IS NOT NULL AND v_rate > v_service.maximum_price)
    THEN
      RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Provider price no longer meets pricing rules.' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_service.pricing_model = 'hourly' THEN
    v_hours := EXTRACT(EPOCH FROM (NEW.end_at - NEW.start_at)) / 3600.0;
    v_expected_subtotal := ROUND(v_rate * v_hours, 2);
  ELSE
    v_expected_subtotal := v_rate;
  END IF;

  IF NOT v_rpc_insert AND ABS(NEW.price_subtotal - v_expected_subtotal) > 0.01 THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Booking price does not match the current service price.' USING ERRCODE = '23514';
  END IF;

  FOR v_req IN
    SELECT * FROM public.service_requirements WHERE service_id = NEW.service_id AND is_active AND required_during_booking
  LOOP
    IF v_req.fulfillment_mode = 'provider' THEN
      v_extras_total := v_extras_total + v_req.provider_extra_fee;
    ELSIF v_req.fulfillment_mode = 'either' THEN
      SELECT elem INTO v_selection FROM jsonb_array_elements(COALESCE(NEW.requirement_selections, '[]'::jsonb)) elem
        WHERE (elem->>'requirement_id')::uuid = v_req.id LIMIT 1;
      IF v_selection IS NULL OR (v_selection->>'chosen_by') NOT IN ('customer', 'provider') THEN
        RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: A choice is required for: %', v_req.name_en USING ERRCODE = '23514';
      END IF;
      IF v_selection->>'chosen_by' = 'provider' THEN
        v_extras_total := v_extras_total + v_req.provider_extra_fee;
      END IF;
    END IF;
  END LOOP;

  IF v_service.maximum_extras_total IS NOT NULL AND v_extras_total > v_service.maximum_extras_total THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Selected extras exceed the maximum allowed.' USING ERRCODE = '23514';
  END IF;

  SELECT value INTO v_billing FROM public.settings WHERE key = 'billing';
  v_platform_fee := COALESCE((v_billing->>'platform_fee')::numeric, 25);
  v_vat_percent := COALESCE((v_billing->>'vat_percent')::numeric, 14);
  v_vat := ROUND(v_expected_subtotal * v_vat_percent / 100.0);

  SELECT * INTO v_zone FROM public.resolve_zone(v_addr.lat, v_addr.lng);
  v_travel_fee := COALESCE(v_zone.travel_fee, 0);

  IF NEW.promo_code_id IS NULL THEN
    v_discount := 0;
    IF NOT v_rpc_insert AND NEW.price_discount IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'BOOKING_INVALID_PROMO: A discount requires a valid promo code.' USING ERRCODE = '23514';
    END IF;
    NEW.promo_code := NULL;
    NEW.promo_discount_type := NULL;
    NEW.promo_discount_value := NULL;
    NEW.promo_description_en := NULL;
    NEW.promo_description_ar := NULL;
  ELSE
    SELECT * INTO v_promo FROM public.promo_codes WHERE id = NEW.promo_code_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BOOKING_INVALID_PROMO: Selected promo code no longer exists.' USING ERRCODE = '23514';
    END IF;
    IF NOT v_promo.is_active THEN
      RAISE EXCEPTION 'BOOKING_INVALID_PROMO: This promo code is no longer active.' USING ERRCODE = '23514';
    END IF;
    IF v_promo.starts_at IS NOT NULL AND now() < v_promo.starts_at THEN
      RAISE EXCEPTION 'BOOKING_INVALID_PROMO: This promo code is not active yet.' USING ERRCODE = '23514';
    END IF;
    IF v_promo.expires_at IS NOT NULL AND now() > v_promo.expires_at THEN
      RAISE EXCEPTION 'BOOKING_INVALID_PROMO: This promo code has expired.' USING ERRCODE = '23514';
    END IF;
    IF v_promo.total_usage_limit IS NOT NULL AND v_promo.usage_count >= v_promo.total_usage_limit THEN
      RAISE EXCEPTION 'BOOKING_INVALID_PROMO: This promo code has reached its usage limit.' USING ERRCODE = '23514';
    END IF;
    IF v_expected_subtotal < v_promo.minimum_booking_amount THEN
      RAISE EXCEPTION 'BOOKING_INVALID_PROMO: Booking does not meet promo minimum amount.' USING ERRCODE = '23514';
    END IF;
    IF v_promo.usage_limit_per_customer IS NOT NULL THEN
      SELECT count(*) INTO v_used_by_customer FROM public.promo_code_redemptions
        WHERE promo_code_id = v_promo.id AND customer_id = NEW.customer_id;
      IF v_used_by_customer >= v_promo.usage_limit_per_customer THEN
        RAISE EXCEPTION 'BOOKING_INVALID_PROMO: Promo customer usage limit reached.' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF v_promo.first_booking_only AND EXISTS (SELECT 1 FROM public.bookings WHERE customer_id = NEW.customer_id) THEN
      RAISE EXCEPTION 'BOOKING_INVALID_PROMO: Promo is first-booking only.' USING ERRCODE = '23514';
    END IF;
    IF v_promo.applicable_scope = 'services' THEN
      IF NOT EXISTS (SELECT 1 FROM public.promo_code_services WHERE promo_code_id = v_promo.id AND service_id = NEW.service_id) THEN
        RAISE EXCEPTION 'BOOKING_INVALID_PROMO: Promo does not apply to this service.' USING ERRCODE = '23514';
      END IF;
    ELSIF v_promo.applicable_scope = 'categories' THEN
      IF NOT EXISTS (SELECT 1 FROM public.promo_code_categories WHERE promo_code_id = v_promo.id AND category_id = v_service.category_id) THEN
        RAISE EXCEPTION 'BOOKING_INVALID_PROMO: Promo does not apply to this service.' USING ERRCODE = '23514';
      END IF;
    END IF;
    v_discount := CASE v_promo.discount_type
      WHEN 'fixed' THEN v_promo.discount_value
      ELSE ROUND(v_expected_subtotal * v_promo.discount_value / 100.0, 2)
    END;
    IF v_promo.maximum_discount IS NOT NULL THEN
      v_discount := LEAST(v_discount, v_promo.maximum_discount);
    END IF;
    v_discount := GREATEST(LEAST(v_discount, v_expected_subtotal), 0);
    IF NOT v_rpc_insert AND ABS(NEW.price_discount - v_discount) > 0.01 THEN
      RAISE EXCEPTION 'BOOKING_INVALID_PROMO: Promo discount does not match current terms.' USING ERRCODE = '23514';
    END IF;
    UPDATE public.promo_codes SET usage_count = usage_count + 1 WHERE id = v_promo.id;
    NEW.promo_code := v_promo.code;
    NEW.promo_discount_type := v_promo.discount_type;
    NEW.promo_discount_value := v_promo.discount_value;
    NEW.promo_description_en := v_promo.description_en;
    NEW.promo_description_ar := v_promo.description_ar;
  END IF;

  v_expected_total := GREATEST(
    v_expected_subtotal + v_platform_fee + v_vat + v_extras_total + v_travel_fee - v_discount,
    0
  );

  IF v_rpc_insert THEN
    NEW.price_subtotal := v_expected_subtotal;
    NEW.price_discount := v_discount;
    NEW.price_total := v_expected_total;
  ELSIF ABS(NEW.price_total - v_expected_total) > 0.01 THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Booking total does not match current price components.' USING ERRCODE = '23514';
  END IF;

  NEW.price_platform_fee := v_platform_fee;
  NEW.price_vat := v_vat;
  NEW.price_extras_total := v_extras_total;
  NEW.price_travel_fee := v_travel_fee;

  BEGIN
    PERFORM public.check_booking_slot(NEW.provider_id, NEW.start_at, NEW.end_at, NULL);
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'BOOKING_SLOT_UNAVAILABLE: That time slot is no longer available.' USING ERRCODE = '23514';
  END;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_validate_booking_service() FROM PUBLIC, anon, authenticated;

-- Canonical customer booking creation path.
CREATE OR REPLACE FUNCTION public.create_booking(
  p_provider_id uuid,
  p_service_id uuid,
  p_address_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_idempotency_key uuid,
  p_family_member_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_promo_code_id uuid DEFAULT NULL,
  p_requirement_selections jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_fingerprint text;
  v_existing RECORD;
  v_booking_id uuid;
  v_created boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF public.is_not_suspended(v_uid) IS NOT TRUE THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Account is suspended.' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Idempotency key is required.' USING ERRCODE = '23514';
  END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Invalid booking time range.' USING ERRCODE = '23514';
  END IF;

  v_fingerprint := public.booking_request_fingerprint(
    p_provider_id, p_service_id, p_address_id, p_start_at, p_end_at,
    p_family_member_id, p_notes, p_promo_code_id, coalesce(p_requirement_selections, '[]'::jsonb)
  );

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_idempotency_key::text, 0));

  SELECT id, request_fingerprint INTO v_existing
  FROM public.bookings
  WHERE customer_id = v_uid AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'BOOKING_DUPLICATE_REQUEST_CONFLICT: Idempotency key reused with different booking details.' USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object(
      'booking_id', v_existing.id,
      'created', false,
      'idempotent_replay', true
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.marketplace_eligibility_internal(p_provider_id, p_service_id, p_address_id) e
    WHERE e.is_eligible
  ) THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Provider is not eligible for this service and address.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.create_booking_in_progress', 'on', true);

  BEGIN
    INSERT INTO public.bookings (
      customer_id, provider_id, service_id, address_id,
      start_at, end_at, status, notes, family_member_id,
      requirement_selections, promo_code_id,
      price_subtotal, price_discount, price_total,
      price_platform_fee, price_vat, price_extras_total, price_travel_fee,
      idempotency_key, request_fingerprint, currency
    ) VALUES (
      v_uid, p_provider_id, p_service_id, p_address_id,
      p_start_at, p_end_at, 'pending', NULLIF(btrim(p_notes), ''), p_family_member_id,
      coalesce(p_requirement_selections, '[]'::jsonb), p_promo_code_id,
      0, 0, 0, 0, 0, 0, 0,
      p_idempotency_key, v_fingerprint, 'EGP'
    ) RETURNING id INTO v_booking_id;
    v_created := true;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id, request_fingerprint INTO v_existing
      FROM public.bookings
      WHERE customer_id = v_uid AND idempotency_key = p_idempotency_key;
      IF FOUND AND v_existing.request_fingerprint = v_fingerprint THEN
        RETURN jsonb_build_object(
          'booking_id', v_existing.id,
          'created', false,
          'idempotent_replay', true
        );
      END IF;
      RAISE EXCEPTION 'BOOKING_DUPLICATE_REQUEST_CONFLICT: Concurrent duplicate booking request.' USING ERRCODE = '23514';
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'BOOKING_SLOT_UNAVAILABLE: That time slot is no longer available.' USING ERRCODE = '23514';
    WHEN SQLSTATE '23514' THEN
      RAISE;
    WHEN SQLSTATE '42501' THEN
      RAISE;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'BOOKING_%' THEN
        RAISE;
      END IF;
      RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Unable to create booking.' USING ERRCODE = '23514';
  END;

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'created', v_created,
    'idempotent_replay', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.create_booking(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,text,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,text,uuid,jsonb) TO authenticated;

-- Customers must use create_booking; service_role retains direct insert for QA fixtures.
DROP POLICY IF EXISTS "bookings_customer_insert" ON public.bookings;

NOTIFY pgrst, 'reload schema';
