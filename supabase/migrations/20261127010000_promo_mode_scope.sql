-- Promo codes scoped by lesson mode.
--
-- Admin can now limit a promo to online lessons, to at-home bookings, or keep
-- it for every booking. The mode combines with the existing category/service
-- scope, e.g. "online lessons, Quran only".
--
-- * promo_codes.applicable_mode: 'all' (default, so every existing code keeps
--   working exactly as before), 'online' or 'in_person'.
-- * validate_promo_code() (the customer preflight) gets p_service_mode and
--   returns reason 'mode_online_only' / 'mode_in_person_only' so the customer
--   sees a clear message. The 3-arg signature is dropped so named-argument
--   RPC calls stay unambiguous; old clients that send 3 named arguments still
--   resolve to the new function through the DEFAULT, and the booking insert
--   below is the authoritative check for them.
-- * A separate BEFORE INSERT trigger on bookings refuses a promo whose mode
--   does not match NEW.service_mode. Kept separate from
--   tg_validate_booking_service on purpose: that function is large and
--   recently redefined; a RAISE here aborts the whole insert (including the
--   usage_count increment made by the other trigger), so firing order does
--   not matter.
-- * get_active_featured_promo_codes() also returns applicable_mode so the
--   checkout sheet only lists codes that fit the booking's mode.

-- ---------------------------------------------------------------------------
-- 1. Column
-- ---------------------------------------------------------------------------
ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS applicable_mode text NOT NULL DEFAULT 'all';

ALTER TABLE public.promo_codes
  DROP CONSTRAINT IF EXISTS promo_codes_applicable_mode_check;
ALTER TABLE public.promo_codes
  ADD CONSTRAINT promo_codes_applicable_mode_check
  CHECK (applicable_mode IN ('all', 'online', 'in_person'));

COMMENT ON COLUMN public.promo_codes.applicable_mode IS
  'Which bookings the code applies to: all, online (live online lessons) or in_person (at home). Combines with applicable_scope.';

-- ---------------------------------------------------------------------------
-- 2. Customer preflight: validate_promo_code with the booking mode
--    Re-derived from 20260714150000_secure_promo_codes.sql (latest definition)
--    plus the mode check.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.validate_promo_code(text, uuid, numeric);

CREATE OR REPLACE FUNCTION public.validate_promo_code(
  p_code text,
  p_service_id uuid,
  p_subtotal numeric,
  p_service_mode text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promo RECORD;
  v_service RECORD;
  v_discount numeric(10,2);
  v_customer uuid := auth.uid();
  v_used_by_customer int;
  v_mode text := CASE
    WHEN p_service_mode IN ('online', 'in_person') THEN p_service_mode
    ELSE NULL
  END;
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

  -- Mode before amount/service: it is the most specific reason a code does
  -- not fit this booking. An unknown mode (old clients) is left to the
  -- authoritative booking insert check.
  IF v_mode IS NOT NULL AND v_promo.applicable_mode <> 'all' AND v_promo.applicable_mode <> v_mode THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', CASE v_promo.applicable_mode
        WHEN 'online' THEN 'mode_online_only'
        ELSE 'mode_in_person_only'
      END
    );
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
    'description_ar', v_promo.description_ar,
    'applicable_mode', v_promo.applicable_mode
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_promo_code(text, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_promo_code(text, uuid, numeric, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Authoritative check on every booking insert (create_booking, checkout)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_booking_promo_mode_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text;
BEGIN
  IF NEW.promo_code_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT applicable_mode INTO v_mode
  FROM public.promo_codes
  WHERE id = NEW.promo_code_id;

  -- A missing promo is reported by tg_validate_booking_service.
  IF v_mode IS NULL OR v_mode = 'all' THEN
    RETURN NEW;
  END IF;

  IF v_mode IS DISTINCT FROM COALESCE(NEW.service_mode, 'in_person') THEN
    RAISE EXCEPTION
      'BOOKING_INVALID_PROMO: This promo code does not apply to this booking type.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_booking_promo_mode_scope() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS booking_promo_mode_scope ON public.bookings;
CREATE TRIGGER booking_promo_mode_scope
  BEFORE INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_booking_promo_mode_scope();

-- ---------------------------------------------------------------------------
-- 4. Featured codes carry their mode so checkout lists only codes that fit.
--    Re-derived from the latest definition; the return type gains a column,
--    so the function is dropped and recreated with the same grants.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_active_featured_promo_codes();

CREATE FUNCTION public.get_active_featured_promo_codes()
RETURNS TABLE (
  id uuid,
  code text,
  description_en text,
  description_ar text,
  discount_type text,
  discount_value numeric,
  minimum_booking_amount numeric,
  expires_at timestamptz,
  applicable_mode text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer uuid := auth.uid();
BEGIN
  IF v_customer IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    pc.id,
    pc.code,
    pc.description_en,
    pc.description_ar,
    pc.discount_type,
    pc.discount_value,
    pc.minimum_booking_amount,
    pc.expires_at,
    pc.applicable_mode
  FROM public.promo_codes pc
  WHERE pc.is_featured = true
    AND pc.is_active = true
    AND (pc.starts_at IS NULL OR now() >= pc.starts_at)
    AND (pc.expires_at IS NULL OR now() <= pc.expires_at)
    AND (pc.total_usage_limit IS NULL OR pc.usage_count < pc.total_usage_limit)
    AND (
      pc.usage_limit_per_customer IS NULL
      OR (
        SELECT count(*)::int
        FROM public.promo_code_redemptions pcr
        WHERE pcr.promo_code_id = pc.id
          AND pcr.customer_id = v_customer
      ) < pc.usage_limit_per_customer
    )
    AND (
      NOT pc.first_booking_only
      OR NOT EXISTS (
        SELECT 1 FROM public.bookings b WHERE b.customer_id = v_customer
      )
    )
  ORDER BY pc.expires_at NULLS LAST, pc.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_featured_promo_codes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_featured_promo_codes() TO authenticated;
