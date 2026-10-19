-- Fixed babysitting packages. No booking backfill or historical repricing.
ALTER TABLE public.services ADD COLUMN fixed_start_time time;

UPDATE public.services
SET pricing_model = 'fixed', duration_min = 480, fixed_start_time = NULL,
    description_en = '8 continuous hours for one fixed package price.',
    description_ar = '8 ساعات متواصلة بسعر ثابت'
WHERE slug = 'babysetting';

UPDATE public.services
SET pricing_model = 'fixed', duration_min = 360, fixed_start_time = time '18:00',
    description_en = 'From 6 PM to midnight (Cairo time) for one fixed package price.',
    description_ar = 'من 6 مساء لحد 12 بالليل بسعر ثابت بتوقيت القاهرة'
WHERE slug = 'overnight-babysitting';

CREATE OR REPLACE FUNCTION public.tg_validate_fixed_package_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service RECORD;
BEGIN
  -- Status-only updates of historical bookings must remain unaffected.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.service_id IS NOT DISTINCT FROM OLD.service_id
       AND NEW.start_at IS NOT DISTINCT FROM OLD.start_at
       AND NEW.end_at IS NOT DISTINCT FROM OLD.end_at THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT pricing_model, duration_min, fixed_start_time INTO v_service
  FROM public.services WHERE id = NEW.service_id;
  IF FOUND AND v_service.pricing_model = 'fixed' THEN
    IF (NEW.end_at - NEW.start_at) IS DISTINCT FROM make_interval(mins => v_service.duration_min) THEN
      RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Booking duration must match the fixed package.' USING ERRCODE = '23514';
    END IF;
    IF v_service.fixed_start_time IS NOT NULL
       AND (NEW.start_at AT TIME ZONE 'Africa/Cairo')::time IS DISTINCT FROM v_service.fixed_start_time THEN
      RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Booking must start at the package time in Cairo.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_validate_fixed_package_booking() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_validate_fixed_package_booking
BEFORE INSERT OR UPDATE OF service_id, start_at, end_at ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.tg_validate_fixed_package_booking();

-- Latest body: 20260713180000_secure-booking-rescheduling.sql.
-- Only the midnight-date branch changes; all availability and overlap guards remain.
CREATE OR REPLACE FUNCTION public.check_booking_slot(
  p_provider_id uuid, p_start timestamptz, p_end timestamptz, p_exclude_booking_id uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider RECORD;
  v_local_date date;
  v_local_start time;
  v_local_end time;
  v_weekday smallint;
BEGIN
  SELECT * INTO v_provider FROM public.providers WHERE id = p_provider_id;
  IF NOT FOUND OR NOT v_provider.is_active THEN
    RAISE EXCEPTION 'This provider is not currently active.' USING ERRCODE = '23514';
  END IF;

  IF v_provider.vacation_mode THEN
    RAISE EXCEPTION 'This provider is not accepting bookings right now.' USING ERRCODE = '23514';
  END IF;

  IF p_start < now() + make_interval(hours => v_provider.min_notice_hours) THEN
    RAISE EXCEPTION 'This time does not meet the provider''s minimum notice period.' USING ERRCODE = '23514';
  END IF;

  IF p_start > now() + make_interval(days => v_provider.max_advance_days) THEN
    RAISE EXCEPTION 'This time is too far in the future for this provider.' USING ERRCODE = '23514';
  END IF;

  v_local_date := (p_start AT TIME ZONE 'Africa/Cairo')::date;
  v_local_start := (p_start AT TIME ZONE 'Africa/Cairo')::time;
  v_local_end := (p_end AT TIME ZONE 'Africa/Cairo')::time;
  v_weekday := EXTRACT(DOW FROM (p_start AT TIME ZONE 'Africa/Cairo'))::smallint;

  IF (p_end AT TIME ZONE 'Africa/Cairo')::date = v_local_date + 1
     AND v_local_end = time '00:00' THEN
    v_local_end := time '24:00';
  ELSIF v_local_date <> (p_end AT TIME ZONE 'Africa/Cairo')::date THEN
    RAISE EXCEPTION 'Bookings cannot span past midnight.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.availability_rules ar
    WHERE ar.provider_id = p_provider_id AND ar.weekday = v_weekday
      AND ar.start_time <= v_local_start AND ar.end_time >= v_local_end
  ) THEN
    RAISE EXCEPTION 'This time is outside the provider''s working hours.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.provider_vacations pv
    WHERE pv.provider_id = p_provider_id AND v_local_date BETWEEN pv.start_date AND pv.end_date
  ) THEN
    RAISE EXCEPTION 'The provider is unavailable on this date.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.availability_exceptions ae
    WHERE ae.provider_id = p_provider_id
      AND ae.is_blocked
      AND v_local_date BETWEEN ae.date AND COALESCE(ae.end_date, ae.date)
      AND (ae.start_time IS NULL OR ae.end_time IS NULL OR (v_local_start < ae.end_time AND v_local_end > ae.start_time))
  ) THEN
    RAISE EXCEPTION 'The provider is unavailable during this time.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.provider_id = p_provider_id
      AND b.id IS DISTINCT FROM p_exclude_booking_id
      AND b.status IN ('pending','confirmed','on_the_way','arrived','arrival_confirmed','in_progress','completion_requested')
      AND tstzrange(b.start_at - make_interval(mins => v_provider.buffer_minutes), b.end_at + make_interval(mins => v_provider.buffer_minutes), '[)')
          && tstzrange(p_start, p_end, '[)')
  ) THEN
    RAISE EXCEPTION 'This time is too close to another booking for this provider.' USING ERRCODE = '23514';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.check_booking_slot(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
