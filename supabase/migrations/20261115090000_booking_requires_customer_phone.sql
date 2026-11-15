-- Every new booking needs a customer contact phone (Google/Apple sign-ups add it at setup).
-- Additive guard: applies to new inserts only; existing bookings are untouched.

CREATE OR REPLACE FUNCTION public.tg_booking_requires_customer_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = NEW.customer_id AND btrim(coalesce(p.phone, '')) <> ''
  ) THEN
    RAISE EXCEPTION 'BOOKING_PHONE_REQUIRED: Add your mobile number before booking.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_booking_requires_customer_phone() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS booking_requires_customer_phone ON public.bookings;
CREATE TRIGGER booking_requires_customer_phone
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_requires_customer_phone();
