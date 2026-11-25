-- Scheduling audit HIGH fixes: #441 provider busy RPC, #446 reschedule duration lock

CREATE OR REPLACE FUNCTION public.provider_busy_ranges(
  p_provider_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE(start_at timestamptz, end_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.start_at, b.end_at
  FROM public.bookings b
  WHERE b.provider_id = p_provider_id
    AND b.status IN (
      'pending',
      'confirmed',
      'on_the_way',
      'arrived',
      'arrival_confirmed',
      'in_progress',
      'completion_requested'
    )
    AND b.start_at < p_to
    AND b.end_at > p_from;
$$;

REVOKE EXECUTE ON FUNCTION public.provider_busy_ranges(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_busy_ranges(uuid, timestamptz, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_reschedule(
  p_booking_id uuid, p_proposed_start timestamptz, p_proposed_end timestamptz, p_reason text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking RECORD;
  v_id uuid;
  v_duration interval;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_booking.customer_id <> auth.uid() THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = '42501';
  END IF;
  IF v_booking.status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'This booking can no longer be rescheduled.' USING ERRCODE = '23514';
  END IF;
  IF p_proposed_end <= p_proposed_start THEN
    RAISE EXCEPTION 'Invalid proposed time range.' USING ERRCODE = '23514';
  END IF;

  v_duration := v_booking.end_at - v_booking.start_at;
  IF p_proposed_end - p_proposed_start IS DISTINCT FROM v_duration THEN
    RAISE EXCEPTION 'Reschedule must keep the same session length.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.booking_reschedule_requests (
    booking_id, original_start_at, original_end_at, proposed_start_at, proposed_end_at, requested_by, request_reason
  ) VALUES (
    p_booking_id, v_booking.start_at, v_booking.end_at, p_proposed_start, p_proposed_end, auth.uid(), p_reason
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_reschedule(
  p_request_id uuid, p_action text, p_reason text DEFAULT NULL,
  p_counter_start timestamptz DEFAULT NULL, p_counter_end timestamptz DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req RECORD;
  v_booking RECORD;
  v_is_provider boolean;
  v_expected_responder_is_provider boolean;
  v_new_id uuid;
  v_duration interval;
BEGIN
  IF p_action NOT IN ('accept', 'reject', 'counter') THEN
    RAISE EXCEPTION 'Invalid action.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_req FROM public.booking_reschedule_requests WHERE id = p_request_id;
  IF NOT FOUND OR v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This reschedule request is no longer open.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_req.booking_id;
  v_is_provider := EXISTS (SELECT 1 FROM public.providers p WHERE p.id = v_booking.provider_id AND p.profile_id = auth.uid());
  v_expected_responder_is_provider := (v_req.requested_by = v_booking.customer_id);

  IF v_expected_responder_is_provider AND NOT v_is_provider THEN
    RAISE EXCEPTION 'Only the provider can respond to this request.' USING ERRCODE = '42501';
  END IF;
  IF NOT v_expected_responder_is_provider AND v_booking.customer_id <> auth.uid() THEN
    RAISE EXCEPTION 'Only the customer can respond to this request.' USING ERRCODE = '42501';
  END IF;
  IF p_action = 'counter' AND NOT v_expected_responder_is_provider THEN
    RAISE EXCEPTION 'Only the provider may propose a different time.' USING ERRCODE = '42501';
  END IF;

  v_duration := v_booking.end_at - v_booking.start_at;

  IF p_action = 'accept' THEN
    IF v_booking.status NOT IN ('pending', 'confirmed') THEN
      RAISE EXCEPTION 'This booking can no longer be rescheduled.' USING ERRCODE = '23514';
    END IF;
    IF v_req.proposed_end_at - v_req.proposed_start_at IS DISTINCT FROM v_duration THEN
      RAISE EXCEPTION 'Reschedule must keep the same session length.' USING ERRCODE = '23514';
    END IF;
    PERFORM public.check_booking_slot(v_booking.provider_id, v_req.proposed_start_at, v_req.proposed_end_at, v_booking.id);

    PERFORM set_config('app.reschedule_in_progress', 'on', true);
    UPDATE public.bookings SET start_at = v_req.proposed_start_at, end_at = v_req.proposed_end_at WHERE id = v_booking.id;

    UPDATE public.booking_reschedule_requests
      SET status = 'accepted', responded_by = auth.uid(), response_reason = p_reason, responded_at = now()
      WHERE id = p_request_id;

  ELSIF p_action = 'reject' THEN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
      RAISE EXCEPTION 'A reason is required to decline a reschedule request.' USING ERRCODE = '23514';
    END IF;
    UPDATE public.booking_reschedule_requests
      SET status = 'rejected', responded_by = auth.uid(), response_reason = p_reason, responded_at = now()
      WHERE id = p_request_id;

  ELSE
    IF p_counter_start IS NULL OR p_counter_end IS NULL OR p_counter_end <= p_counter_start THEN
      RAISE EXCEPTION 'A valid counter-proposed time range is required.' USING ERRCODE = '23514';
    END IF;
    IF p_counter_end - p_counter_start IS DISTINCT FROM v_duration THEN
      RAISE EXCEPTION 'Reschedule must keep the same session length.' USING ERRCODE = '23514';
    END IF;
    IF v_booking.status NOT IN ('pending', 'confirmed') THEN
      RAISE EXCEPTION 'This booking can no longer be rescheduled.' USING ERRCODE = '23514';
    END IF;

    UPDATE public.booking_reschedule_requests
      SET status = 'counter_proposed', responded_by = auth.uid(), response_reason = p_reason, responded_at = now()
      WHERE id = p_request_id;

    INSERT INTO public.booking_reschedule_requests (
      booking_id, responds_to_id, original_start_at, original_end_at, proposed_start_at, proposed_end_at, requested_by, request_reason
    ) VALUES (
      v_booking.id, p_request_id, v_booking.start_at, v_booking.end_at, p_counter_start, p_counter_end, auth.uid(), p_reason
    ) RETURNING id INTO v_new_id;
  END IF;

  RETURN COALESCE(v_new_id, p_request_id);
END;
$$;