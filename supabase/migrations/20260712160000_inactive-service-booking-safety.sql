-- Services Phase 4B.1: inactive-service booking safety.
--
-- Confirmed gap: a service deactivated by admin could still be booked via
-- an existing, already-approved provider_services record, because nothing
-- validated service.is_active (or provider_services.status) at booking
-- INSERT time — the UI's own filtering was the only guard.
--
-- Deeper gap found while fixing the above: "services_public_read" used
-- USING (is_active). PostgREST enforces RLS on embedded/joined resources
-- independently of the outer row — so once a service went inactive, EVERY
-- booking that referenced it (including completed/cancelled/disputed ones)
-- would silently get service: null in its joined result, breaking
-- historical booking detail display. Selection-time filtering already
-- happens at the query layer (useAllServices / useProviderServices) and is
-- now also enforced below at INSERT time, so this policy can safely become
-- fully public — identical in shape to provider_services' own
-- "ps_public_read" (already USING (true)).

DROP POLICY IF EXISTS "services_public_read" ON public.services;
CREATE POLICY "services_public_read" ON public.services FOR SELECT TO anon, authenticated USING (true);

-- DB-level enforcement for NEW bookings only. Fires on INSERT alone, so
-- every existing booking record is left completely untouched regardless of
-- any later service/provider_services state change.
CREATE OR REPLACE FUNCTION public.tg_validate_booking_service()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.services s WHERE s.id = NEW.service_id AND s.is_active = true
  ) THEN
    RAISE EXCEPTION 'Selected service is not currently available.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.provider_services ps
    WHERE ps.provider_id = NEW.provider_id
      AND ps.service_id = NEW.service_id
      AND ps.status = 'approved'
  ) THEN
    RAISE EXCEPTION 'This provider is not approved to offer the selected service.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_validate_booking_service() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validate_booking_service ON public.bookings;
CREATE TRIGGER trg_validate_booking_service
BEFORE INSERT ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.tg_validate_booking_service();
