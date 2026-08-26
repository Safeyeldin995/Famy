-- Customer-facing featured promo codes: admin flag + narrow SECURITY DEFINER RPC.
-- Does NOT add a customer SELECT policy on promo_codes — same security model as
-- validate_promo_code(), exposing only featured/active codes through the RPC.

ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_promo_codes_featured_active
  ON public.promo_codes (is_featured, is_active)
  WHERE is_featured = true AND is_active = true;

CREATE OR REPLACE FUNCTION public.get_active_featured_promo_codes()
RETURNS TABLE (
  id uuid,
  code text,
  description_en text,
  description_ar text,
  discount_type text,
  discount_value numeric,
  minimum_booking_amount numeric,
  expires_at timestamptz
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
    pc.expires_at
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
