-- Only allow customer wallet release after a declined checkout, never during an active pending Paymob order.

CREATE OR REPLACE FUNCTION public.customer_release_booking_checkout_wallet(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_customer_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  SELECT customer_id INTO v_customer_id FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_customer_id <> v_uid AND NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.booking_id = p_booking_id
      AND p.status IN ('pending', 'captured', 'partially_refunded', 'pending_review')
  ) THEN
    RAISE EXCEPTION 'Wallet cannot be released while a payment is still active for this booking.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.booking_id = p_booking_id
      AND p.status = 'rejected'
      AND COALESCE((p.metadata->>'wallet_applied')::numeric, 0) > 0
      AND COALESCE((p.metadata->>'wallet_checkout_released')::numeric, 0) <= 0.009
  ) THEN
    RETURN;
  END IF;

  PERFORM public.restore_customer_wallet_checkout_debit(p_booking_id);
END;
$$;

NOTIFY pgrst, 'reload schema';