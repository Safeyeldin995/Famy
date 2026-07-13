-- Patch 1 / Module 3: Provider Availability and Double-Booking Prevention.
-- Additive only. Reuses existing schema: availability_rules (weekly hours),
-- provider_vacations (date-range blocks), availability_exceptions (revived —
-- was dead code, now wired up for single-day/partial blocks), and the
-- providers.buffer_minutes / min_notice_hours / max_advance_days /
-- vacation_mode columns (already present since 20260627164621, previously
-- unused anywhere).

-- ============================================================
-- 1) bookings_no_overlap was stale against the current booking_status enum
-- (only covered pending/confirmed/in_progress). Extend to every
-- active-lifecycle status so the DB itself — not just client filtering —
-- rejects a second overlapping booking while the first is on_the_way,
-- arrived, arrival_confirmed, or completion_requested.
-- ============================================================
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_no_overlap;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
  provider_id WITH =,
  tstzrange(start_at, end_at, '[)') WITH &&
) WHERE (status IN ('pending','confirmed','on_the_way','arrived','arrival_confirmed','in_progress','completion_requested'));

-- ============================================================
-- 2) Admin visibility/override on availability tables. Read was already
-- public; these add admin WRITE so an admin can block a provider period.
-- Every write here is automatically audited by the existing generic
-- tg_audit_changes() trigger (supabase/migrations/20260627164829_...sql),
-- which already runs on bookings/providers/verification_records — reused
-- as-is rather than inventing a parallel audit mechanism.
-- ============================================================
DROP POLICY IF EXISTS "avail_admin_all" ON public.availability_rules;
CREATE POLICY "avail_admin_all" ON public.availability_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "avail_exc_admin_all" ON public.availability_exceptions;
CREATE POLICY "avail_exc_admin_all" ON public.availability_exceptions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_audit_availability_exceptions ON public.availability_exceptions;
CREATE TRIGGER trg_audit_availability_exceptions AFTER INSERT OR UPDATE OR DELETE ON public.availability_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

DROP TRIGGER IF EXISTS trg_audit_provider_vacations ON public.provider_vacations;
CREATE TRIGGER trg_audit_provider_vacations AFTER INSERT OR UPDATE OR DELETE ON public.provider_vacations
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

-- ============================================================
-- 3) Atomic booking-creation validation — extends the existing BEFORE
-- INSERT guard (trg_validate_booking_service / tg_validate_booking_service,
-- supabase/migrations/20260712160000 and 20260713120000) with the full
-- availability rule set. All times are compared in the provider's
-- operating timezone (Africa/Cairo — the only timezone this app supports
-- today, already hardcoded the same way in useReplaceAvailability).
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_validate_booking_service()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_addr RECORD;
  v_zone RECORD;
  v_provider RECORD;
  v_local_date date;
  v_local_start time;
  v_local_end time;
  v_weekday smallint;
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

  IF NOT EXISTS (
    SELECT 1 FROM public.zone_services zs WHERE zs.zone_id = v_zone.zone_id AND zs.service_id = NEW.service_id
  ) THEN
    RAISE EXCEPTION 'The selected service is not offered in this area.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.zone_providers zp WHERE zp.zone_id = v_zone.zone_id AND zp.provider_id = NEW.provider_id
  ) THEN
    RAISE EXCEPTION 'This provider does not serve the selected area.' USING ERRCODE = '23514';
  END IF;

  -- ---- Availability ----
  SELECT * INTO v_provider FROM public.providers WHERE id = NEW.provider_id;
  IF NOT FOUND OR NOT v_provider.is_active THEN
    RAISE EXCEPTION 'This provider is not currently active.' USING ERRCODE = '23514';
  END IF;

  IF v_provider.vacation_mode THEN
    RAISE EXCEPTION 'This provider is not accepting bookings right now.' USING ERRCODE = '23514';
  END IF;

  IF NEW.start_at < now() + make_interval(hours => v_provider.min_notice_hours) THEN
    RAISE EXCEPTION 'This booking does not meet the provider''s minimum notice period.' USING ERRCODE = '23514';
  END IF;

  IF NEW.start_at > now() + make_interval(days => v_provider.max_advance_days) THEN
    RAISE EXCEPTION 'This booking is too far in the future for this provider.' USING ERRCODE = '23514';
  END IF;

  v_local_date := (NEW.start_at AT TIME ZONE 'Africa/Cairo')::date;
  v_local_start := (NEW.start_at AT TIME ZONE 'Africa/Cairo')::time;
  v_local_end := (NEW.end_at AT TIME ZONE 'Africa/Cairo')::time;
  v_weekday := EXTRACT(DOW FROM (NEW.start_at AT TIME ZONE 'Africa/Cairo'))::smallint;

  IF v_local_date <> (NEW.end_at AT TIME ZONE 'Africa/Cairo')::date THEN
    RAISE EXCEPTION 'Bookings cannot span past midnight.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.availability_rules ar
    WHERE ar.provider_id = NEW.provider_id AND ar.weekday = v_weekday
      AND ar.start_time <= v_local_start AND ar.end_time >= v_local_end
  ) THEN
    RAISE EXCEPTION 'This time is outside the provider''s working hours.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.provider_vacations pv
    WHERE pv.provider_id = NEW.provider_id AND v_local_date BETWEEN pv.start_date AND pv.end_date
  ) THEN
    RAISE EXCEPTION 'The provider is unavailable on this date.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.availability_exceptions ae
    WHERE ae.provider_id = NEW.provider_id
      AND ae.is_blocked
      AND v_local_date BETWEEN ae.date AND COALESCE(ae.end_date, ae.date)
      AND (ae.start_time IS NULL OR ae.end_time IS NULL OR (v_local_start < ae.end_time AND v_local_end > ae.start_time))
  ) THEN
    RAISE EXCEPTION 'The provider is unavailable during this time.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.provider_id = NEW.provider_id
      AND b.status IN ('pending','confirmed','on_the_way','arrived','arrival_confirmed','in_progress','completion_requested')
      AND tstzrange(b.start_at - make_interval(mins => v_provider.buffer_minutes), b.end_at + make_interval(mins => v_provider.buffer_minutes), '[)')
          && tstzrange(NEW.start_at, NEW.end_at, '[)')
  ) THEN
    RAISE EXCEPTION 'This time is too close to another booking for this provider.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_validate_booking_service() FROM PUBLIC, anon, authenticated;
