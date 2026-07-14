-- Patch 2 / Module 4: Secure Promo Codes.
-- Additive only. Introduces an admin-managed promo_codes table plus
-- category/service scoping and a concurrency-safe, server-authoritative
-- redemption path wired into booking creation. The legacy `coupons` /
-- `coupon_redemptions` tables (Module 0 scaffolding, never wired to booking
-- creation — client-only lookup, no server enforcement) are superseded and
-- left untouched/unused rather than dropped.

-- ============================================================
-- 1) promo_codes
-- ============================================================
CREATE TABLE IF NOT EXISTS public.promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (btrim(code) <> ''),
  description_en text,
  description_ar text,
  discount_type text NOT NULL CHECK (discount_type IN ('fixed','percentage')),
  discount_value numeric(10,2) NOT NULL CHECK (discount_value > 0),
  maximum_discount numeric(10,2) CHECK (maximum_discount IS NULL OR maximum_discount >= 0),
  minimum_booking_amount numeric(10,2) NOT NULL DEFAULT 0 CHECK (minimum_booking_amount >= 0),
  starts_at timestamptz,
  expires_at timestamptz,
  total_usage_limit int CHECK (total_usage_limit IS NULL OR total_usage_limit > 0),
  usage_limit_per_customer int CHECK (usage_limit_per_customer IS NULL OR usage_limit_per_customer > 0),
  usage_count int NOT NULL DEFAULT 0,
  first_booking_only boolean NOT NULL DEFAULT false,
  applicable_scope text NOT NULL DEFAULT 'all' CHECK (applicable_scope IN ('all','categories','services')),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promo_codes_percentage_range CHECK (discount_type <> 'percentage' OR discount_value <= 100),
  CONSTRAINT promo_codes_dates_order CHECK (starts_at IS NULL OR expires_at IS NULL OR expires_at > starts_at),
  CONSTRAINT promo_codes_code_unique UNIQUE (code)
);
CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON public.promo_codes(is_active);

GRANT SELECT ON public.promo_codes TO authenticated;
GRANT ALL ON public.promo_codes TO service_role;
ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

-- No customer-facing read policy at all: the full promo inventory (codes,
-- limits, remaining usage) is never exposed to authenticated users directly.
-- Customers can only learn about a single code through validate_promo_code().
DROP POLICY IF EXISTS "promo_codes_admin_all" ON public.promo_codes;
CREATE POLICY "promo_codes_admin_all" ON public.promo_codes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_promo_codes_updated BEFORE UPDATE ON public.promo_codes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_audit_promo_codes ON public.promo_codes;
CREATE TRIGGER trg_audit_promo_codes AFTER INSERT OR UPDATE OR DELETE ON public.promo_codes
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

-- Normalize the code (uppercase, trimmed) regardless of what the admin typed,
-- so lookups and the uniqueness constraint are case/whitespace-insensitive.
CREATE OR REPLACE FUNCTION public.tg_normalize_promo_code()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.code := upper(btrim(NEW.code));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_normalize_promo_code ON public.promo_codes;
CREATE TRIGGER trg_normalize_promo_code BEFORE INSERT OR UPDATE OF code ON public.promo_codes
  FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_promo_code();

-- ============================================================
-- 2) Category / service scoping (only consulted when applicable_scope
-- requires it; harmless if populated regardless of scope).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.promo_code_categories (
  promo_code_id uuid NOT NULL REFERENCES public.promo_codes(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  PRIMARY KEY (promo_code_id, category_id)
);
GRANT SELECT ON public.promo_code_categories TO authenticated;
GRANT ALL ON public.promo_code_categories TO service_role;
ALTER TABLE public.promo_code_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pcc_admin_all" ON public.promo_code_categories;
CREATE POLICY "pcc_admin_all" ON public.promo_code_categories FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.promo_code_services (
  promo_code_id uuid NOT NULL REFERENCES public.promo_codes(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  PRIMARY KEY (promo_code_id, service_id)
);
GRANT SELECT ON public.promo_code_services TO authenticated;
GRANT ALL ON public.promo_code_services TO service_role;
ALTER TABLE public.promo_code_services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pcs_admin_all" ON public.promo_code_services;
CREATE POLICY "pcs_admin_all" ON public.promo_code_services FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 3) Redemptions — one row per booking that used a code. booking_id is
-- UNIQUE so a booking can never be double-redeemed against, and existence
-- of this row is what "usage" means (never trust promo_codes.usage_count
-- alone for audit — it is a race-safe counter, this table is the ledger).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.promo_code_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id uuid NOT NULL REFERENCES public.promo_codes(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
  discount_amount numeric(10,2) NOT NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_promo ON public.promo_code_redemptions(promo_code_id);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_customer ON public.promo_code_redemptions(promo_code_id, customer_id);

GRANT SELECT ON public.promo_code_redemptions TO authenticated;
GRANT ALL ON public.promo_code_redemptions TO service_role;
ALTER TABLE public.promo_code_redemptions ENABLE ROW LEVEL SECURITY;

-- Customers see only their own redemption history; never another
-- customer's usage. Rows are only ever created by the SECURITY DEFINER
-- booking trigger below (no INSERT grant to authenticated), so this is
-- read-only for everyone but admin/service_role.
DROP POLICY IF EXISTS "pcr_self_read" ON public.promo_code_redemptions;
CREATE POLICY "pcr_self_read" ON public.promo_code_redemptions FOR SELECT TO authenticated
  USING (customer_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 4) Immutable promo snapshot on bookings. price_discount already exists
-- (Module 0) and is reused as the discount-amount snapshot.
-- ============================================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS promo_code_id uuid REFERENCES public.promo_codes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS promo_code text,
  ADD COLUMN IF NOT EXISTS promo_discount_type text,
  ADD COLUMN IF NOT EXISTS promo_discount_value numeric(10,2),
  ADD COLUMN IF NOT EXISTS promo_description_en text,
  ADD COLUMN IF NOT EXISTS promo_description_ar text;

-- ============================================================
-- 5) Server-side pre-flight validation, callable by any authenticated
-- customer. UX-only — like the slot-clash pre-check in book.$providerId.tsx,
-- this never mutates state and must never be treated as authoritative; the
-- BEFORE INSERT trigger on bookings (below) is the sole authoritative guard
-- and independently re-derives everything this function checks. Runs as
-- SECURITY DEFINER specifically so it can read promo_codes/redemptions
-- despite neither having a customer-facing SELECT policy — the full promo
-- inventory is never exposed, only the single requested code's outcome.
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_promo_code(
  p_code text,
  p_service_id uuid,
  p_subtotal numeric
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_promo RECORD;
  v_service RECORD;
  v_discount numeric(10,2);
  v_customer uuid := auth.uid();
  v_used_by_customer int;
BEGIN
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'auth_required');
  END IF;
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT * INTO v_promo FROM public.promo_codes WHERE code = upper(btrim(p_code));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF NOT v_promo.is_active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive');
  END IF;
  IF v_promo.starts_at IS NOT NULL AND now() < v_promo.starts_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_started');
  END IF;
  IF v_promo.expires_at IS NOT NULL AND now() > v_promo.expires_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;
  IF v_promo.total_usage_limit IS NOT NULL AND v_promo.usage_count >= v_promo.total_usage_limit THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'exhausted');
  END IF;
  IF p_subtotal IS NULL OR p_subtotal < v_promo.minimum_booking_amount THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'min_total');
  END IF;

  IF v_promo.usage_limit_per_customer IS NOT NULL THEN
    SELECT count(*) INTO v_used_by_customer FROM public.promo_code_redemptions
      WHERE promo_code_id = v_promo.id AND customer_id = v_customer;
    IF v_used_by_customer >= v_promo.usage_limit_per_customer THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'customer_limit');
    END IF;
  END IF;

  IF v_promo.first_booking_only AND EXISTS (SELECT 1 FROM public.bookings WHERE customer_id = v_customer) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'first_booking_only');
  END IF;

  IF v_promo.applicable_scope = 'services' THEN
    IF p_service_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.promo_code_services WHERE promo_code_id = v_promo.id AND service_id = p_service_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_applicable');
    END IF;
  ELSIF v_promo.applicable_scope = 'categories' THEN
    IF p_service_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_applicable');
    END IF;
    SELECT * INTO v_service FROM public.services WHERE id = p_service_id;
    IF NOT FOUND OR NOT EXISTS (
      SELECT 1 FROM public.promo_code_categories WHERE promo_code_id = v_promo.id AND category_id = v_service.category_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_applicable');
    END IF;
  END IF;

  v_discount := CASE v_promo.discount_type
    WHEN 'fixed' THEN v_promo.discount_value
    ELSE round(p_subtotal * v_promo.discount_value / 100.0, 2)
  END;
  IF v_promo.maximum_discount IS NOT NULL THEN
    v_discount := LEAST(v_discount, v_promo.maximum_discount);
  END IF;
  v_discount := GREATEST(LEAST(v_discount, p_subtotal), 0);

  RETURN jsonb_build_object(
    'ok', true,
    'promo_code_id', v_promo.id,
    'code', v_promo.code,
    'discount_type', v_promo.discount_type,
    'discount_value', v_promo.discount_value,
    'discount_amount', v_discount,
    'description_en', v_promo.description_en,
    'description_ar', v_promo.description_ar
  );
END;
$$;
REVOKE ALL ON FUNCTION public.validate_promo_code(text, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_promo_code(text, uuid, numeric) TO authenticated;

-- ============================================================
-- 6) Booking creation: re-validate the promo from scratch (never trusting
-- the pre-flight call above or any client-supplied discount) and reserve
-- usage atomically. Extends tg_validate_booking_service (BEFORE INSERT) —
-- same function signature/trigger as Modules 1-2, once more.
--
-- Concurrency: `SELECT ... FOR UPDATE` locks the promo_codes row for the
-- duration of this transaction. Any other booking insert using the same
-- code blocks here until this transaction commits or rolls back, so the
-- total-usage check, the per-customer-usage check, and the usage_count
-- increment all observe a consistent, up-to-date state — two concurrent
-- bookings can never both win the last remaining redemption.
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

  PERFORM public.check_booking_slot(NEW.provider_id, NEW.start_at, NEW.end_at, NULL);

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_validate_booking_service() FROM PUBLIC, anon, authenticated;

-- Records the redemption ledger row once the booking id exists. Runs only
-- when the BEFORE trigger above accepted a promo_code_id, so this never
-- fails for a booking that was actually created — and never runs at all
-- for a booking whose creating transaction rolled back (nothing to record).
CREATE OR REPLACE FUNCTION public.tg_booking_promo_redemption()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.promo_code_id IS NOT NULL THEN
    INSERT INTO public.promo_code_redemptions (promo_code_id, customer_id, booking_id, discount_amount)
    VALUES (NEW.promo_code_id, NEW.customer_id, NEW.id, NEW.price_discount);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_booking_promo_redemption ON public.bookings;
CREATE TRIGGER trg_booking_promo_redemption
  AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_promo_redemption();

-- ============================================================
-- 7) Historical immutability: promo snapshot fields can never be changed
-- after creation, same guarantee already given to price_subtotal/
-- price_discount/price_total. Extends tg_validate_booking_transition
-- (BEFORE UPDATE) once more — identical body to 20260713180000 with the
-- promo columns added to the locked field list.
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
     OR NEW.price_subtotal IS DISTINCT FROM OLD.price_subtotal
     OR NEW.price_discount IS DISTINCT FROM OLD.price_discount
     OR NEW.price_total IS DISTINCT FROM OLD.price_total
     OR NEW.promo_code_id IS DISTINCT FROM OLD.promo_code_id
     OR NEW.promo_code IS DISTINCT FROM OLD.promo_code
     OR NEW.promo_discount_type IS DISTINCT FROM OLD.promo_discount_type
     OR NEW.promo_discount_value IS DISTINCT FROM OLD.promo_discount_value
     OR NEW.promo_description_en IS DISTINCT FROM OLD.promo_description_en
     OR NEW.promo_description_ar IS DISTINCT FROM OLD.promo_description_ar
  THEN
    RAISE EXCEPTION 'Booking customer, provider, service, address, and pricing cannot be changed after creation.'
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
