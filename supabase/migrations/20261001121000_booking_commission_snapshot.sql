-- Issue #91: snapshotted Famy commission per booking + immutable-price guard.
-- Additive only. Do not backfill. Do not UPDATE existing bookings.
-- This migration must not be applied to QA or Production from this PR.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS price_commission_percent numeric(5,2) NULL,
  ADD COLUMN IF NOT EXISTS price_commission_amount numeric(10,2) NULL,
  ADD COLUMN IF NOT EXISTS price_provider_net numeric(10,2) NULL;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_price_commission_percent_nonneg,
  DROP CONSTRAINT IF EXISTS bookings_price_commission_amount_nonneg,
  DROP CONSTRAINT IF EXISTS bookings_price_provider_net_nonneg;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_price_commission_percent_nonneg
    CHECK (price_commission_percent IS NULL OR price_commission_percent >= 0),
  ADD CONSTRAINT bookings_price_commission_amount_nonneg
    CHECK (price_commission_amount IS NULL OR price_commission_amount >= 0),
  ADD CONSTRAINT bookings_price_provider_net_nonneg
    CHECK (price_provider_net IS NULL OR price_provider_net >= 0);

-- Clients cannot write snapshot columns. The BEFORE INSERT trigger (table owner)
-- computes them. Authenticated INSERT listing these columns is rejected.
-- Column-level REVOKE UPDATE is defense-in-depth only: table-level UPDATE remains
-- granted, so the real protection against changing these columns after insert is
-- tg_validate_booking_transition.
REVOKE INSERT (price_commission_percent, price_commission_amount, price_provider_net)
  ON public.bookings FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (price_commission_percent, price_commission_amount, price_provider_net)
  ON public.bookings FROM PUBLIC, anon, authenticated;

-- Pricing path: latest live body is 20261001110000 (S6 effective-rate check:
-- provider_pricing_allowed gates only an explicit price_override; min/max apply
-- to COALESCE(price_override, hourly_rate)). Keep every existing check; add only
-- the commission snapshot after the other price components are written.

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
  v_commission_percent numeric(5,2);
  v_commission_base numeric(10,2);
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

  PERFORM public.assert_babysitting_booking_eligible(
    NEW.provider_id,
    NEW.service_id,
    NEW.customer_id,
    NEW.family_member_id,
    NEW.start_at
  );

  SELECT hourly_rate INTO v_provider_hourly_rate FROM public.providers WHERE id = NEW.provider_id;
  v_rate := COALESCE(v_ps.price_override, v_provider_hourly_rate);
  IF v_ps.price_override IS NOT NULL AND NOT v_service.provider_pricing_allowed THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Provider price no longer meets pricing rules.' USING ERRCODE = '23514';
  END IF;
  IF (v_service.minimum_price IS NOT NULL AND v_rate < v_service.minimum_price)
     OR (v_service.maximum_price IS NOT NULL AND v_rate > v_service.maximum_price)
  THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Provider price no longer meets pricing rules.' USING ERRCODE = '23514';
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

  -- Famy commission snapshot (Issue #91).
  -- Commission base = provider service price: subtotal + provider-fulfilled extras.
  -- Platform fee, VAT and discount are never part of the provider base.
  -- Travel fee goes to the provider in full and is not commissioned.
  -- commission_amount = ROUND(base × percent / 100, 2)
  -- provider_net = base + travel_fee − commission_amount
  -- When settings.billing.commission_percent is null, all three snapshot columns stay NULL.
  -- Client-supplied values are ignored; only this trigger writes the snapshot.
  v_commission_percent := (v_billing->>'commission_percent')::numeric;
  IF v_commission_percent IS NULL THEN
    NEW.price_commission_percent := NULL;
    NEW.price_commission_amount := NULL;
    NEW.price_provider_net := NULL;
  ELSE
    v_commission_base := v_expected_subtotal + v_extras_total;
    NEW.price_commission_percent := v_commission_percent;
    NEW.price_commission_amount := ROUND(v_commission_base * v_commission_percent / 100.0, 2);
    NEW.price_provider_net := v_commission_base + v_travel_fee - NEW.price_commission_amount;
  END IF;

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

-- Immutable-price guard: latest live body is 20260716010000. Add the three
-- snapshot columns to the existing UPDATE lock list.

CREATE OR REPLACE FUNCTION public.tg_validate_booking_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_customer boolean := false;
  v_is_provider boolean := false;
  v_is_admin boolean := false;
  v_allowed boolean := false;
  v_changing boolean := (NEW.status IS DISTINCT FROM OLD.status);
  v_dispute_eligible CONSTANT public.booking_status[] := ARRAY[
    'on_the_way', 'arrived', 'arrival_confirmed', 'in_progress', 'completion_requested'
  ]::public.booking_status[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
     OR NEW.service_id IS DISTINCT FROM OLD.service_id
     OR NEW.address_id IS DISTINCT FROM OLD.address_id
     OR NEW.family_member_id IS DISTINCT FROM OLD.family_member_id
     OR NEW.price_subtotal IS DISTINCT FROM OLD.price_subtotal
     OR NEW.price_discount IS DISTINCT FROM OLD.price_discount
     OR NEW.price_total IS DISTINCT FROM OLD.price_total
     OR NEW.price_platform_fee IS DISTINCT FROM OLD.price_platform_fee
     OR NEW.price_vat IS DISTINCT FROM OLD.price_vat
     OR NEW.price_extras_total IS DISTINCT FROM OLD.price_extras_total
     OR NEW.price_travel_fee IS DISTINCT FROM OLD.price_travel_fee
     OR NEW.price_commission_percent IS DISTINCT FROM OLD.price_commission_percent
     OR NEW.price_commission_amount IS DISTINCT FROM OLD.price_commission_amount
     OR NEW.price_provider_net IS DISTINCT FROM OLD.price_provider_net
     OR NEW.promo_code_id IS DISTINCT FROM OLD.promo_code_id
     OR NEW.promo_code IS DISTINCT FROM OLD.promo_code
     OR NEW.promo_discount_type IS DISTINCT FROM OLD.promo_discount_type
     OR NEW.promo_discount_value IS DISTINCT FROM OLD.promo_discount_value
     OR NEW.promo_description_en IS DISTINCT FROM OLD.promo_description_en
     OR NEW.promo_description_ar IS DISTINCT FROM OLD.promo_description_ar
  THEN
    RAISE EXCEPTION 'Booking customer, provider, service, address, family member, and pricing cannot be changed after creation.'
      USING ERRCODE = '42501';
  END IF;

  IF (NEW.start_at IS DISTINCT FROM OLD.start_at OR NEW.end_at IS DISTINCT FROM OLD.end_at)
     AND current_setting('app.reschedule_in_progress', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Booking schedule can only be changed through an accepted reschedule request.'
      USING ERRCODE = '42501';
  END IF;

  -- Normal cancellation (pending/confirmed) must go through cancel_booking().
  IF v_changing AND NEW.status = 'cancelled' AND OLD.status IN ('pending', 'confirmed')
     AND current_setting('app.cancellation_in_progress', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Bookings can only be cancelled through the cancel_booking function.'
      USING ERRCODE = '42501';
  END IF;

  IF v_changing THEN
    v_is_customer := (OLD.customer_id = v_uid);
    v_is_provider := EXISTS (SELECT 1 FROM public.providers p WHERE p.id = OLD.provider_id AND p.profile_id = v_uid);
    v_is_admin := public.has_role(v_uid, 'admin');

    IF v_is_admin AND (
         (OLD.status = 'disputed' AND NEW.status IN ('completed', 'cancelled') AND current_setting('app.dispute_resolution_in_progress', true) = 'on')
      OR (OLD.status = 'no_show' AND NEW.status IN ('completed', 'cancelled') AND current_setting('app.no_show_resolution_in_progress', true) = 'on')
      OR (OLD.status IN ('pending', 'confirmed') AND NEW.status = 'cancelled')
    ) THEN
      v_allowed := true;
    END IF;

    IF NOT v_allowed AND v_is_provider AND (
         (OLD.status = 'pending' AND NEW.status = 'confirmed')
      OR (OLD.status = 'pending' AND NEW.status = 'cancelled')
      OR (OLD.status = 'confirmed' AND NEW.status = 'on_the_way')
      OR (OLD.status = 'confirmed' AND NEW.status = 'cancelled')
      OR (OLD.status = 'on_the_way' AND NEW.status = 'arrived')
      OR (OLD.status = 'arrival_confirmed' AND NEW.status = 'in_progress')
      OR (OLD.status = 'in_progress' AND NEW.status = 'completion_requested')
    ) THEN
      v_allowed := true;
    END IF;

    IF NOT v_allowed AND v_is_customer AND (
         (OLD.status = 'pending' AND NEW.status = 'cancelled')
      OR (OLD.status = 'confirmed' AND NEW.status = 'cancelled')
      OR (OLD.status = 'arrived' AND NEW.status = 'arrival_confirmed')
      OR (OLD.status = 'completion_requested' AND NEW.status = 'completed')
    ) THEN
      v_allowed := true;
    END IF;

    -- Dispute: customer or provider, from anywhere in the active lifecycle
    -- through completion_requested, only via open_booking_dispute().
    IF NOT v_allowed AND (v_is_customer OR v_is_provider) AND NEW.status = 'disputed'
       AND OLD.status = ANY(v_dispute_eligible)
       AND current_setting('app.dispute_in_progress', true) = 'on'
    THEN
      v_allowed := true;
    END IF;

    -- No-show: customer reports provider, provider reports customer, only
    -- via report_no_show(). Eligible states unchanged from the pre-Module-1
    -- lifecycle (on_the_way, arrived).
    IF NOT v_allowed AND (
         (v_is_customer AND NEW.no_show_party = 'provider')
      OR (v_is_provider AND NEW.no_show_party = 'customer')
       )
       AND NEW.status = 'no_show'
       AND OLD.status IN ('on_the_way', 'arrived')
       AND current_setting('app.no_show_in_progress', true) = 'on'
    THEN
      v_allowed := true;
    END IF;

    IF NOT v_allowed THEN
      RAISE EXCEPTION 'Booking transition % -> % is not permitted for this user', OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.status_changed_at := CASE WHEN v_changing THEN now() ELSE OLD.status_changed_at END;
  NEW.status_changed_by := CASE WHEN v_changing THEN v_uid ELSE OLD.status_changed_by END;
  NEW.completion_requested_at := CASE WHEN v_changing AND NEW.status = 'completion_requested' THEN now() ELSE OLD.completion_requested_at END;
  NEW.completed_at := CASE WHEN v_changing AND NEW.status = 'completed' THEN now() ELSE OLD.completed_at END;

  IF v_changing AND NEW.status = 'arrival_confirmed' THEN
    NEW.arrival_confirmed_at := now(); NEW.arrival_confirmed_by := v_uid;
  ELSE
    NEW.arrival_confirmed_at := OLD.arrival_confirmed_at; NEW.arrival_confirmed_by := OLD.arrival_confirmed_by;
  END IF;

  IF v_changing AND NEW.status = 'cancelled' THEN
    NEW.cancelled_at := now(); NEW.cancelled_by := v_uid;
  ELSE
    NEW.cancelled_at := OLD.cancelled_at; NEW.cancelled_by := OLD.cancelled_by; NEW.cancellation_reason := OLD.cancellation_reason;
  END IF;

  IF v_changing AND NEW.status = 'no_show' THEN
    NEW.no_show_reported_by := v_uid;
  ELSE
    NEW.no_show_party := OLD.no_show_party; NEW.no_show_reported_by := OLD.no_show_reported_by; NEW.no_show_reason := OLD.no_show_reason;
  END IF;

  IF v_changing AND NEW.status = 'disputed' THEN
    NEW.disputed_at := now();
  ELSE
    NEW.disputed_at := OLD.disputed_at; NEW.dispute_reason := OLD.dispute_reason;
  END IF;

  IF v_changing AND v_is_admin AND OLD.status = 'disputed' AND NEW.status IN ('completed', 'cancelled') THEN
    NEW.dispute_resolved_at := now(); NEW.dispute_resolved_by := v_uid;
  ELSE
    NEW.dispute_resolved_at := OLD.dispute_resolved_at; NEW.dispute_resolved_by := OLD.dispute_resolved_by;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_validate_booking_transition() FROM PUBLIC, anon, authenticated;

-- Reject invalid billing.commission_percent at write time so booking-create
-- never sees a non-numeric or out-of-range value. Null / missing remains "not set".
CREATE OR REPLACE FUNCTION public.tg_validate_billing_settings()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_raw jsonb;
  v_percent numeric;
BEGIN
  IF NEW.key IS DISTINCT FROM 'billing' THEN
    RETURN NEW;
  END IF;

  v_raw := NEW.value->'commission_percent';
  IF v_raw IS NULL OR v_raw = 'null'::jsonb THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(v_raw) IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'BILLING_INVALID_COMMISSION: commission_percent must be null or a number from 0 to 50 with at most 2 decimal places.'
      USING ERRCODE = '23514';
  END IF;

  BEGIN
    v_percent := (NEW.value->>'commission_percent')::numeric;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'BILLING_INVALID_COMMISSION: commission_percent must be null or a number from 0 to 50 with at most 2 decimal places.'
        USING ERRCODE = '23514';
  END;

  IF v_percent < 0 OR v_percent > 50 OR v_percent <> round(v_percent, 2) THEN
    RAISE EXCEPTION 'BILLING_INVALID_COMMISSION: commission_percent must be null or a number from 0 to 50 with at most 2 decimal places.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_validate_billing_settings() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validate_billing_settings ON public.settings;
CREATE TRIGGER trg_validate_billing_settings
  BEFORE INSERT OR UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_billing_settings();

NOTIFY pgrst, 'reload schema';
