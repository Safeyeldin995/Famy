-- Pre-launch write guards (Issue #94). Draft only — do not apply to QA or Production.
-- Closes authenticated self-service writes on reviews, profiles, providers, and payments.
-- Does not modify existing rows, commission, or pricing policy values.

-- ---------------------------------------------------------------------------
-- S1/S2: reviews — immutable ids; provider may write only provider_reply;
-- customer may write only rating and comment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_guard_review_writes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.booking_id IS DISTINCT FROM OLD.booking_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN
    RAISE EXCEPTION 'Review booking, customer, and provider cannot be changed.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.providers p
    WHERE p.id = OLD.provider_id AND p.profile_id = auth.uid()
  ) THEN
    IF NEW.rating IS DISTINCT FROM OLD.rating
       OR NEW.comment IS DISTINCT FROM OLD.comment
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Providers may only update the provider reply on a review.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.customer_id = auth.uid() THEN
    IF NEW.provider_reply IS DISTINCT FROM OLD.provider_reply
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Customers may only update rating and comment on their review.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Not allowed to update this review.' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.tg_guard_review_writes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_review_writes ON public.reviews;
CREATE TRIGGER trg_guard_review_writes
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_review_writes();

-- ---------------------------------------------------------------------------
-- S3: profiles.is_suspended is admin- or service_role-only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_guard_profile_admin_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_suspended IS DISTINCT FROM OLD.is_suspended
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Suspension status can only be changed by an admin.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_guard_profile_admin_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_profile_admin_fields ON public.profiles;
CREATE TRIGGER trg_guard_profile_admin_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_profile_admin_fields();

-- ---------------------------------------------------------------------------
-- S4/S5: extend onboarding field guard. is_verified, is_top_pro, and is_active
-- are writable only by admin, service_role (no JWT), or authorized GUC paths.
-- vacation_mode and other availability fields stay provider-writable.
-- Body is the current 20260928081021 definition plus the admin-flag check.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_guard_provider_onboarding_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.onboarding_status_transition', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- JWT clients, including provider-admins, cannot write this column except
  -- through provider_save_onboarding_section (which sets the GUC). Seed and
  -- service_role paths have no uid and are not PostgREST clients.
  IF NEW.max_children_per_booking IS DISTINCT FROM OLD.max_children_per_booking
     AND current_setting('app.max_children_declaration', true) IS DISTINCT FROM '1'
     AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Maximum children per booking can only be changed through the onboarding save function.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.onboarding_status IS DISTINCT FROM OLD.onboarding_status THEN
    RAISE EXCEPTION 'Onboarding status changes must use authorized server functions.' USING ERRCODE = '42501';
  END IF;

  IF OLD.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Provider application is read-only while under review.' USING ERRCODE = '42501';
  END IF;

  IF OLD.onboarding_status = 'APPROVED' AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.bio_en IS DISTINCT FROM OLD.bio_en
       OR NEW.bio_ar IS DISTINCT FROM OLD.bio_ar
       OR NEW.city IS DISTINCT FROM OLD.city
       OR NEW.years_experience IS DISTINCT FROM OLD.years_experience THEN
      RAISE EXCEPTION 'Verified identity data cannot be changed without review.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF (NEW.is_verified IS DISTINCT FROM OLD.is_verified
      OR NEW.is_top_pro IS DISTINCT FROM OLD.is_top_pro
      OR NEW.is_active IS DISTINCT FROM OLD.is_active)
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Provider verification and activation can only be changed by an admin or authorized server function.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_provider_onboarding_fields ON public.providers;
CREATE TRIGGER trg_guard_provider_onboarding_fields
  BEFORE UPDATE ON public.providers
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_provider_onboarding_fields();

-- ---------------------------------------------------------------------------
-- S6: apply min/max to the effective rate (price_override or hourly_rate).
-- provider_pricing_allowed still gates only an explicit price_override.
-- Error code BOOKING_PROVIDER_INELIGIBLE is unchanged.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- S7: non-admin, non-webhook capture is cash-on-completed only.
-- InstaPay/proof requires admin (or service_role). Paymob online requires webhook.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_validate_payment_capture()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking_status public.booking_status;
BEGIN
  IF NEW.status = 'captured' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'captured') THEN
    IF COALESCE(NEW.payment_method_code, '') = 'paymob'
       AND COALESCE(NEW.payment_method_type, '') = 'online' THEN
      IF EXISTS (
        SELECT 1
        FROM public.paymob_webhook_events e
        WHERE e.payment_id = NEW.id
          AND e.outcome = 'captured'
      ) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Paymob online payments can only be captured by the verified webhook.'
        USING ERRCODE = '42501';
    END IF;

    SELECT status INTO v_booking_status FROM public.bookings WHERE id = NEW.booking_id;
    IF v_booking_status IS DISTINCT FROM 'completed' THEN
      RAISE EXCEPTION 'Payment cannot be captured until the booking is completed (current booking status: %)', v_booking_status
        USING ERRCODE = '42501';
    END IF;

    IF COALESCE(NEW.payment_method_type, '') = 'cash' THEN
      RETURN NEW;
    END IF;

    IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'This payment method can only be captured after admin review.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- S8: bind Paymob webhook to the HMAC-covered order id stored at checkout.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.paymob_store_checkout_intention(
  p_payment_id uuid,
  p_intention_id text,
  p_checkout_url text,
  p_extra_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.payments
  SET
    provider_ref = p_intention_id,
    metadata = (
      COALESCE(metadata, '{}'::jsonb)
      - 'paymob_checkout_reservation'
      || jsonb_build_object(
        'paymob_intention_id', p_intention_id,
        'paymob_checkout_url', p_checkout_url,
        'paymob_checkout_started_at', to_jsonb(now())#>>'{}'
      )
      || COALESCE(p_extra_metadata, '{}'::jsonb)
    )
  WHERE id = p_payment_id
    AND status = 'pending';
END;
$$;

DROP FUNCTION IF EXISTS public.paymob_apply_transaction_webhook(bigint, uuid, boolean, boolean, bigint, text, jsonb);

CREATE OR REPLACE FUNCTION public.paymob_apply_transaction_webhook(
  p_paymob_transaction_id bigint,
  p_payment_id uuid,
  p_success boolean,
  p_pending boolean,
  p_amount_cents bigint,
  p_provider_ref text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_paymob_order_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_expected_cents bigint;
  v_outcome text;
  v_new_status public.payment_status;
  v_inserted boolean := false;
  v_ignored_reason text;
  v_stored_order_id text;
  v_incoming_order_id text;
BEGIN
  IF p_paymob_transaction_id IS NULL OR p_paymob_transaction_id <= 0 THEN
    RAISE EXCEPTION 'Invalid Paymob transaction id' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found for Paymob webhook' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_payment.payment_method_code, '') <> 'paymob'
     OR COALESCE(v_payment.payment_method_type, '') <> 'online' THEN
    RAISE EXCEPTION 'Payment is not a Paymob online payment' USING ERRCODE = '42501';
  END IF;

  v_stored_order_id := NULLIF(btrim(COALESCE(v_payment.metadata->>'paymob_order_id', '')), '');
  v_incoming_order_id := NULLIF(btrim(COALESCE(p_paymob_order_id, '')), '');
  IF v_stored_order_id IS NULL
     OR v_incoming_order_id IS NULL
     OR v_stored_order_id IS DISTINCT FROM v_incoming_order_id THEN
    -- Do not INSERT an ignored webhook event: that would consume the
    -- transaction id and block the legitimate matching webhook.
    RAISE EXCEPTION 'Paymob order id mismatch' USING ERRCODE = '42501';
  END IF;

  v_expected_cents := ROUND(v_payment.amount * 100)::bigint;
  IF ABS(v_expected_cents - p_amount_cents) > 1 THEN
    RAISE EXCEPTION 'Paymob amount mismatch for payment %', p_payment_id USING ERRCODE = '23514';
  END IF;

  IF p_pending THEN
    v_outcome := 'pending';
    v_new_status := 'pending';
  ELSIF p_success THEN
    v_outcome := 'captured';
    v_new_status := 'captured';
  ELSE
    v_outcome := 'rejected';
    v_new_status := 'rejected';
  END IF;

  IF v_payment.status = 'captured' THEN
    v_ignored_reason := 'already_captured';
  ELSIF v_payment.status = 'rejected' AND v_new_status <> 'rejected' THEN
    v_ignored_reason := 'already_rejected';
  END IF;

  INSERT INTO public.paymob_webhook_events (paymob_transaction_id, payment_id, outcome)
  VALUES (
    p_paymob_transaction_id,
    p_payment_id,
    CASE WHEN v_ignored_reason IS NOT NULL THEN 'ignored' ELSE v_outcome END
  )
  ON CONFLICT (paymob_transaction_id) DO NOTHING
  RETURNING true INTO v_inserted;

  IF NOT COALESCE(v_inserted, false) THEN
    RETURN jsonb_build_object('duplicate', true);
  END IF;

  IF v_ignored_reason IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'ignored', true,
      'reason', v_ignored_reason,
      'payment_id', p_payment_id,
      'status', v_payment.status
    );
  END IF;

  UPDATE public.payments
  SET
    status = v_new_status,
    provider_ref = COALESCE(NULLIF(p_provider_ref, ''), provider_ref),
    metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
    captured_at = CASE WHEN v_new_status = 'captured' THEN now() ELSE captured_at END,
    reviewed_at = CASE WHEN v_new_status IN ('captured', 'rejected') THEN now() ELSE reviewed_at END,
    rejection_reason = CASE WHEN v_new_status = 'rejected' THEN 'Paymob payment failed or was declined.' ELSE rejection_reason END
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'ok', true,
    'payment_id', p_payment_id,
    'status', v_new_status,
    'outcome', v_outcome
  );
END;
$$;

REVOKE ALL ON FUNCTION public.paymob_store_checkout_intention(uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paymob_store_checkout_intention(uuid, text, text, jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.paymob_apply_transaction_webhook(bigint, uuid, boolean, boolean, bigint, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paymob_apply_transaction_webhook(bigint, uuid, boolean, boolean, bigint, text, jsonb, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- S9: claim_password_setup_authorization is server-only. Sweep other
-- SECURITY DEFINER functions whose EXECUTE was revoked only from PUBLIC,
-- leaving default-privilege EXECUTE for anon/authenticated.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.claim_password_setup_authorization(uuid, uuid, text, public.otp_purpose)
  FROM anon, authenticated;

DO $$
DECLARE
  r record;
  v_public_execute boolean;
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure AS fn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
      WHERE p.oid = r.oid
        AND acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    ) INTO v_public_execute;

    IF NOT COALESCE(v_public_execute, false)
       AND has_function_privilege('anon', r.oid, 'EXECUTE')
       AND has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', r.fn);
    END IF;
  END LOOP;
END
$$;
