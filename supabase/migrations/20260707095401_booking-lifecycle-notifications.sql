-- Booking Lifecycle Audit fix: complete the existing notifications system.
-- The `notifications` table, RLS, and read/mark-read UI already exist and
-- are fully wired — this was never a new feature, just an incomplete
-- implementation (nothing anywhere ever INSERTed a row). Per the audit's
-- correction: notification creation is a bug fix completing an existing
-- system, not new architecture.
--
-- Follows the exact same pattern already proven correct in
-- tg_booking_create_conversation() (migration 20260628223929) — a
-- SECURITY DEFINER trigger function, since a customer's own session must
-- never be able to INSERT directly into another user's notifications
-- (there is deliberately no client-reachable INSERT grant on this table —
-- see notif_self policy / GRANT SELECT, UPDATE only). This trigger runs
-- server-side and is the one legitimate way a notification gets created.

CREATE OR REPLACE FUNCTION public.tg_booking_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider_user uuid;
  v_customer_name text;
  v_service_name text;
BEGIN
  SELECT profile_id INTO v_provider_user FROM public.providers WHERE id = NEW.provider_id;
  SELECT full_name INTO v_customer_name FROM public.profiles WHERE id = NEW.customer_id;
  SELECT name_en INTO v_service_name FROM public.services WHERE id = NEW.service_id;

  -- New request → notify the PROVIDER (this is the exact gap that caused
  -- "provider never receives booking request" — the request was always
  -- correctly visible via useProviderBookings/pending filter once status
  -- was correct, but no notification row ever told them it existed).
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, payload)
      VALUES (
        v_provider_user, 'booking_request',
        'New booking request',
        COALESCE(v_customer_name, 'A customer') || ' requested ' || COALESCE(v_service_name, 'a service'),
        jsonb_build_object('booking_id', NEW.id)
      );
    END IF;
  END IF;

  -- Provider accepted → notify the CUSTOMER.
  IF TG_OP = 'UPDATE' AND NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed' THEN
    INSERT INTO public.notifications (user_id, type, title, body, payload)
    VALUES (
      NEW.customer_id, 'booking_confirmed',
      'Booking confirmed',
      'Your booking has been accepted.',
      jsonb_build_object('booking_id', NEW.id)
    );
  END IF;

  -- Provider declined/cancelled a still-pending request → notify the CUSTOMER.
  IF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status = 'pending' THEN
    INSERT INTO public.notifications (user_id, type, title, body, payload)
    VALUES (
      NEW.customer_id, 'booking_declined',
      'Booking declined',
      'Your booking request was not accepted. Please try another provider or time.',
      jsonb_build_object('booking_id', NEW.id)
    );
  END IF;

  -- Provider started the job → notify the CUSTOMER (this is the correct,
  -- real trigger point for the tracking experience — see Issue #20).
  IF TG_OP = 'UPDATE' AND NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM 'in_progress' THEN
    INSERT INTO public.notifications (user_id, type, title, body, payload)
    VALUES (
      NEW.customer_id, 'booking_in_progress',
      'Your provider is on the way',
      COALESCE(v_customer_name, '') || ' your service is starting.',
      jsonb_build_object('booking_id', NEW.id)
    );
  END IF;

  -- Completed → notify the CUSTOMER.
  IF TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    INSERT INTO public.notifications (user_id, type, title, body, payload)
    VALUES (
      NEW.customer_id, 'booking_completed',
      'Service completed',
      'Your booking is complete. We hope everything went well!',
      jsonb_build_object('booking_id', NEW.id)
    );
  END IF;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_booking_notify() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_booking_notify ON public.bookings;
CREATE TRIGGER trg_booking_notify
AFTER INSERT OR UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.tg_booking_notify();
