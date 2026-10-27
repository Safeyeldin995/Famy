-- Fix midnight rule on Africa/Cairo DST nights (#240 follow-up).
-- Bookings must not extend past the start date's Cairo end-of-day instant; exactly
-- midnight ends are allowed only when elapsed duration matches the wall-clock span.

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
  v_cairo_day_end timestamptz;
  v_wall_span interval;
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
  v_weekday := EXTRACT(DOW FROM (p_start AT TIME ZONE 'Africa/Cairo'))::smallint;
  v_cairo_day_end := (v_local_date + 1)::timestamp AT TIME ZONE 'Africa/Cairo';

  IF p_end > v_cairo_day_end THEN
    RAISE EXCEPTION 'Bookings cannot span past midnight.' USING ERRCODE = '23514';
  ELSIF p_end = v_cairo_day_end THEN
    v_wall_span := time '24:00' - v_local_start;
    IF (p_end - p_start) IS DISTINCT FROM v_wall_span THEN
      RAISE EXCEPTION 'Bookings cannot span past midnight.' USING ERRCODE = '23514';
    END IF;
    v_local_end := time '24:00';
  ELSIF (p_end AT TIME ZONE 'Africa/Cairo')::date <> v_local_date THEN
    RAISE EXCEPTION 'Bookings cannot span past midnight.' USING ERRCODE = '23514';
  ELSE
    v_local_end := (p_end AT TIME ZONE 'Africa/Cairo')::time;
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
