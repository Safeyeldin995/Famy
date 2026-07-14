-- Patch 3 / Module 1: Family Members.
-- Additive only. Customer-owned family member profiles, selectable at
-- booking time ("Myself" or a saved active member), with an immutable
-- per-booking snapshot so later edits/deactivation never rewrite history.

-- ============================================================
-- 1) family_members: customer-owned records. Sensitive fields (allergies,
-- medical_notes, access_notes, emergency contact) are never readable by a
-- provider through this table — only through the status-gated booking
-- snapshot below, same pattern as booking_locations.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (length(btrim(full_name)) > 0),
  relationship text NOT NULL CHECK (relationship IN ('spouse','son','daughter','father','mother','sibling','grandparent','other')),
  relationship_other text,
  date_of_birth date NOT NULL,
  gender text CHECK (gender IS NULL OR gender IN ('male','female','other')),
  phone text,
  allergies text,
  medical_notes text,
  access_notes text,
  emergency_contact_name text,
  emergency_contact_phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_family_members_customer ON public.family_members(customer_id) WHERE is_active;

GRANT SELECT, INSERT, UPDATE ON public.family_members TO authenticated;
GRANT ALL ON public.family_members TO service_role;
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;

-- Only the owning customer and admin may ever read this table directly.
-- A provider's only path to any of this data is the status-gated snapshot
-- captured on their own assigned booking (section 3 below).
DROP POLICY IF EXISTS "family_members_customer_all" ON public.family_members;
CREATE POLICY "family_members_customer_all" ON public.family_members FOR ALL TO authenticated
  USING (customer_id = auth.uid()) WITH CHECK (customer_id = auth.uid());
DROP POLICY IF EXISTS "family_members_admin_all" ON public.family_members;
CREATE POLICY "family_members_admin_all" ON public.family_members FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Field-level validation the client also enforces, kept here as the
-- authoritative backstop. No DELETE is granted above — soft-deactivation
-- (is_active = false) is the only removal path, since a member may already
-- be referenced by historical bookings.
CREATE OR REPLACE FUNCTION public.tg_validate_family_member()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.relationship = 'other' AND (NEW.relationship_other IS NULL OR length(btrim(NEW.relationship_other)) = 0) THEN
    RAISE EXCEPTION 'A custom relationship label is required when relationship is Other.' USING ERRCODE = '23514';
  END IF;
  IF NEW.relationship <> 'other' THEN
    NEW.relationship_other := NULL;
  END IF;
  IF NEW.date_of_birth > CURRENT_DATE THEN
    RAISE EXCEPTION 'Date of birth cannot be in the future.' USING ERRCODE = '23514';
  END IF;
  IF NEW.emergency_contact_name IS NOT NULL AND length(btrim(NEW.emergency_contact_name)) > 0
     AND (NEW.emergency_contact_phone IS NULL OR length(btrim(NEW.emergency_contact_phone)) = 0)
  THEN
    RAISE EXCEPTION 'Emergency contact phone is required when an emergency contact name is provided.' USING ERRCODE = '23514';
  END IF;
  IF NEW.phone IS NOT NULL AND NEW.phone !~ '^\+\d{8,15}$' THEN
    RAISE EXCEPTION 'Phone number must be in a valid international format.' USING ERRCODE = '23514';
  END IF;
  IF NEW.emergency_contact_phone IS NOT NULL AND NEW.emergency_contact_phone !~ '^\+\d{8,15}$' THEN
    RAISE EXCEPTION 'Emergency contact phone number must be in a valid international format.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_family_member ON public.family_members;
CREATE TRIGGER trg_validate_family_member BEFORE INSERT OR UPDATE ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_family_member();

DROP TRIGGER IF EXISTS trg_family_members_updated ON public.family_members;
CREATE TRIGGER trg_family_members_updated BEFORE UPDATE ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- 2) bookings: who the service is for. NULL means "Myself". Locked post-
-- creation alongside the rest of a booking's identity (section 4).
-- ============================================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS family_member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL;

-- ============================================================
-- 3) Immutable per-booking snapshot. Same status-windowed provider access
-- as booking_locations / booking_requirement_selections; admin always has
-- access (covers the disputed-status support case, same as those tables).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.booking_family_member_snapshots (
  booking_id uuid PRIMARY KEY REFERENCES public.bookings(id) ON DELETE CASCADE,
  family_member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  relationship text NOT NULL,
  relationship_other text,
  date_of_birth date,
  gender text,
  phone text,
  allergies text,
  medical_notes text,
  access_notes text,
  emergency_contact_name text,
  emergency_contact_phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.tg_block_booking_family_member_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'booking_family_member_snapshots rows are immutable' USING ERRCODE = '42501';
END; $$;
DROP TRIGGER IF EXISTS trg_booking_family_member_snapshots_immutable ON public.booking_family_member_snapshots;
CREATE TRIGGER trg_booking_family_member_snapshots_immutable
  BEFORE UPDATE ON public.booking_family_member_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_booking_family_member_mutation();

GRANT SELECT ON public.booking_family_member_snapshots TO authenticated;
GRANT ALL ON public.booking_family_member_snapshots TO service_role;
ALTER TABLE public.booking_family_member_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bfms_customer_read" ON public.booking_family_member_snapshots;
CREATE POLICY "bfms_customer_read" ON public.booking_family_member_snapshots FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.customer_id = auth.uid()));

DROP POLICY IF EXISTS "bfms_provider_read" ON public.booking_family_member_snapshots;
CREATE POLICY "bfms_provider_read" ON public.booking_family_member_snapshots FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b JOIN public.providers p ON p.id = b.provider_id
      WHERE b.id = booking_id AND p.profile_id = auth.uid()
        AND b.status IN ('confirmed','on_the_way','arrived','arrival_confirmed','in_progress','completion_requested')
    )
  );

DROP POLICY IF EXISTS "bfms_admin_all" ON public.booking_family_member_snapshots;
CREATE POLICY "bfms_admin_all" ON public.booking_family_member_snapshots FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Captured server-side, atomically, at booking creation. For "Myself"
-- (family_member_id NULL) this snapshots the customer's own profile
-- name/phone with relationship 'self' — no medical/emergency data exists
-- for the account holder, so those fields stay NULL rather than invented.
CREATE OR REPLACE FUNCTION public.tg_booking_family_member_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fm RECORD;
  v_full_name text;
  v_phone text;
BEGIN
  IF NEW.family_member_id IS NULL THEN
    SELECT full_name, phone INTO v_full_name, v_phone FROM public.profiles WHERE id = NEW.customer_id;
    INSERT INTO public.booking_family_member_snapshots (
      booking_id, family_member_id, full_name, relationship, phone
    ) VALUES (
      NEW.id, NULL, COALESCE(v_full_name, 'Customer'), 'self', v_phone
    );
    RETURN NEW;
  END IF;

  SELECT * INTO v_fm FROM public.family_members WHERE id = NEW.family_member_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.booking_family_member_snapshots (
    booking_id, family_member_id, full_name, relationship, relationship_other, date_of_birth,
    gender, phone, allergies, medical_notes, access_notes, emergency_contact_name, emergency_contact_phone
  ) VALUES (
    NEW.id, v_fm.id, v_fm.full_name, v_fm.relationship, v_fm.relationship_other, v_fm.date_of_birth,
    v_fm.gender, v_fm.phone, v_fm.allergies, v_fm.medical_notes, v_fm.access_notes,
    v_fm.emergency_contact_name, v_fm.emergency_contact_phone
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_booking_family_member_snapshot ON public.bookings;
CREATE TRIGGER trg_booking_family_member_snapshot
  AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_family_member_snapshot();

-- ============================================================
-- 4) Booking creation: validate the selected family member belongs to this
-- customer and is active. Extends tg_validate_booking_service (BEFORE
-- INSERT) once more — identical to the 20260714180000 body, with the new
-- family-member check added before the slot check.
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

  -- ---- Family member: must belong to this customer and be active ----
  IF NEW.family_member_id IS NOT NULL THEN
    SELECT * INTO v_fm FROM public.family_members WHERE id = NEW.family_member_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected family member was not found.' USING ERRCODE = '23514';
    END IF;
    IF v_fm.customer_id IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'Selected family member does not belong to this customer.' USING ERRCODE = '23514';
    END IF;
    IF NOT v_fm.is_active THEN
      RAISE EXCEPTION 'Selected family member is no longer active.' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- ---- Provider price validation ----
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

  -- ---- Requirements: mandatory choices + extras cap ----
  FOR v_req IN
    SELECT * FROM public.service_requirements WHERE service_id = NEW.service_id AND is_active AND required_during_booking
  LOOP
    IF v_req.fulfillment_mode = 'provider' THEN
      v_extras_total := v_extras_total + v_req.provider_extra_fee;
    ELSIF v_req.fulfillment_mode = 'either' THEN
      SELECT elem INTO v_selection FROM jsonb_array_elements(COALESCE(NEW.requirement_selections, '[]'::jsonb)) elem
        WHERE (elem->>'requirement_id')::uuid = v_req.id LIMIT 1;
      IF v_selection IS NULL OR (v_selection->>'chosen_by') NOT IN ('customer', 'provider') THEN
        RAISE EXCEPTION 'A choice is required for: %', v_req.name_en USING ERRCODE = '23514';
      END IF;
      IF v_selection->>'chosen_by' = 'provider' THEN
        v_extras_total := v_extras_total + v_req.provider_extra_fee;
      END IF;
    END IF;
  END LOOP;

  IF v_service.maximum_extras_total IS NOT NULL AND v_extras_total > v_service.maximum_extras_total THEN
    RAISE EXCEPTION 'Selected extras exceed the maximum allowed for this service.' USING ERRCODE = '23514';
  END IF;

  -- ---- Platform fee / VAT (admin-configured, settings.billing — same
  -- keys/defaults the client already reads via useBillingSettings) ----
  SELECT value INTO v_billing FROM public.settings WHERE key = 'billing';
  v_platform_fee := COALESCE((v_billing->>'platform_fee')::numeric, 25);
  v_vat_percent := COALESCE((v_billing->>'vat_percent')::numeric, 14);
  v_vat := ROUND(v_expected_subtotal * v_vat_percent / 100.0);

  -- ---- Zone travel fee (already resolved above from the address; never
  -- accepted from the client) ----
  v_travel_fee := COALESCE(v_zone.travel_fee, 0);

  -- ---- Promo code: authoritative revalidation + atomic redemption ----
  IF NEW.promo_code_id IS NULL THEN
    IF NEW.price_discount IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'A discount requires a valid promo code.' USING ERRCODE = '23514';
    END IF;
    NEW.promo_code := NULL;
    NEW.promo_discount_type := NULL;
    NEW.promo_discount_value := NULL;
    NEW.promo_description_en := NULL;
    NEW.promo_description_ar := NULL;
  ELSE
    SELECT * INTO v_promo FROM public.promo_codes WHERE id = NEW.promo_code_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected promo code no longer exists.' USING ERRCODE = '23514';
    END IF;
    IF NOT v_promo.is_active THEN
      RAISE EXCEPTION 'This promo code is no longer active.' USING ERRCODE = '23514';
    END IF;
    IF v_promo.starts_at IS NOT NULL AND now() < v_promo.starts_at THEN
      RAISE EXCEPTION 'This promo code is not active yet.' USING ERRCODE = '23514';
    END IF;
    IF v_promo.expires_at IS NOT NULL AND now() > v_promo.expires_at THEN
      RAISE EXCEPTION 'This promo code has expired.' USING ERRCODE = '23514';
    END IF;
    IF v_promo.total_usage_limit IS NOT NULL AND v_promo.usage_count >= v_promo.total_usage_limit THEN
      RAISE EXCEPTION 'This promo code has reached its usage limit.' USING ERRCODE = '23514';
    END IF;
    IF NEW.price_subtotal < v_promo.minimum_booking_amount THEN
      RAISE EXCEPTION 'This booking does not meet the promo code''s minimum amount.' USING ERRCODE = '23514';
    END IF;

    IF v_promo.usage_limit_per_customer IS NOT NULL THEN
      SELECT count(*) INTO v_used_by_customer FROM public.promo_code_redemptions
        WHERE promo_code_id = v_promo.id AND customer_id = NEW.customer_id;
      IF v_used_by_customer >= v_promo.usage_limit_per_customer THEN
        RAISE EXCEPTION 'You have already used this promo code the maximum number of times.' USING ERRCODE = '23514';
      END IF;
    END IF;

    IF v_promo.first_booking_only AND EXISTS (SELECT 1 FROM public.bookings WHERE customer_id = NEW.customer_id) THEN
      RAISE EXCEPTION 'This promo code is only valid on a first booking.' USING ERRCODE = '23514';
    END IF;

    IF v_promo.applicable_scope = 'services' THEN
      IF NOT EXISTS (SELECT 1 FROM public.promo_code_services WHERE promo_code_id = v_promo.id AND service_id = NEW.service_id) THEN
        RAISE EXCEPTION 'This promo code does not apply to the selected service.' USING ERRCODE = '23514';
      END IF;
    ELSIF v_promo.applicable_scope = 'categories' THEN
      IF NOT EXISTS (SELECT 1 FROM public.promo_code_categories WHERE promo_code_id = v_promo.id AND category_id = v_service.category_id) THEN
        RAISE EXCEPTION 'This promo code does not apply to the selected service.' USING ERRCODE = '23514';
      END IF;
    END IF;

    v_discount := CASE v_promo.discount_type
      WHEN 'fixed' THEN v_promo.discount_value
      ELSE ROUND(NEW.price_subtotal * v_promo.discount_value / 100.0, 2)
    END;
    IF v_promo.maximum_discount IS NOT NULL THEN
      v_discount := LEAST(v_discount, v_promo.maximum_discount);
    END IF;
    v_discount := GREATEST(LEAST(v_discount, NEW.price_subtotal), 0);

    IF ABS(NEW.price_discount - v_discount) > 0.01 THEN
      RAISE EXCEPTION 'Promo discount does not match the current promo code terms.' USING ERRCODE = '23514';
    END IF;

    UPDATE public.promo_codes SET usage_count = usage_count + 1 WHERE id = v_promo.id;

    NEW.promo_code := v_promo.code;
    NEW.promo_discount_type := v_promo.discount_type;
    NEW.promo_discount_value := v_promo.discount_value;
    NEW.promo_description_en := v_promo.description_en;
    NEW.promo_description_ar := v_promo.description_ar;
  END IF;

  -- ---- price_total: the sole authoritative sum. NEW.price_discount is
  -- guaranteed correct at this point (validated above, either 0 or the
  -- re-derived promo discount) ----
  v_expected_total := GREATEST(
    v_expected_subtotal + v_platform_fee + v_vat + v_extras_total + v_travel_fee - NEW.price_discount,
    0
  );
  IF ABS(NEW.price_total - v_expected_total) > 0.01 THEN
    RAISE EXCEPTION 'Booking total does not match the current price of its components.' USING ERRCODE = '23514';
  END IF;

  NEW.price_platform_fee := v_platform_fee;
  NEW.price_vat := v_vat;
  NEW.price_extras_total := v_extras_total;
  NEW.price_travel_fee := v_travel_fee;

  PERFORM public.check_booking_slot(NEW.provider_id, NEW.start_at, NEW.end_at, NULL);

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_validate_booking_service() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 5) Lock family_member_id post-creation, same guarantee already given to
-- address_id/provider_id/service_id/pricing. Extends
-- tg_validate_booking_transition (BEFORE UPDATE) once more — identical to
-- 20260714180000 with family_member_id added to the locked field list.
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_validate_booking_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_customer boolean := false;
  v_is_provider boolean := false;
  v_is_admin boolean := false;
  v_allowed boolean := false;
  v_changing boolean := (NEW.status IS DISTINCT FROM OLD.status);
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

  IF v_changing THEN
    v_is_customer := (OLD.customer_id = v_uid);
    v_is_provider := EXISTS (SELECT 1 FROM public.providers p WHERE p.id = OLD.provider_id AND p.profile_id = v_uid);
    v_is_admin := public.has_role(v_uid, 'admin');

    IF v_is_admin AND (
         (OLD.status = 'disputed' AND NEW.status IN ('completed', 'cancelled'))
      OR (OLD.status = 'no_show' AND NEW.status IN ('completed', 'cancelled'))
    ) THEN
      v_allowed := true;
    END IF;

    IF NOT v_allowed AND v_is_provider AND (
         (OLD.status = 'pending' AND NEW.status = 'confirmed')
      OR (OLD.status = 'pending' AND NEW.status = 'cancelled')
      OR (OLD.status = 'confirmed' AND NEW.status = 'on_the_way')
      OR (OLD.status = 'confirmed' AND NEW.status = 'cancelled')
      OR (OLD.status = 'on_the_way' AND NEW.status = 'arrived')
      OR (OLD.status = 'on_the_way' AND NEW.status = 'no_show' AND NEW.no_show_party = 'customer')
      OR (OLD.status = 'arrived' AND NEW.status = 'no_show' AND NEW.no_show_party = 'customer')
      OR (OLD.status = 'arrival_confirmed' AND NEW.status = 'in_progress')
      OR (OLD.status = 'in_progress' AND NEW.status = 'completion_requested')
    ) THEN
      v_allowed := true;
    END IF;

    IF NOT v_allowed AND v_is_customer AND (
         (OLD.status = 'pending' AND NEW.status = 'cancelled')
      OR (OLD.status = 'confirmed' AND NEW.status = 'cancelled')
      OR (OLD.status = 'on_the_way' AND NEW.status = 'no_show' AND NEW.no_show_party = 'provider')
      OR (OLD.status = 'arrived' AND NEW.status = 'arrival_confirmed')
      OR (OLD.status = 'arrived' AND NEW.status = 'no_show' AND NEW.no_show_party = 'provider')
      OR (OLD.status = 'completion_requested' AND NEW.status = 'completed')
      OR (OLD.status = 'completion_requested' AND NEW.status = 'disputed')
    ) THEN
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
