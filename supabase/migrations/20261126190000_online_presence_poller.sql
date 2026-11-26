-- Online lesson attendance without depending on the LiveKit webhook.
--
-- Until now attendance (session_events) was written only by the LiveKit
-- webhook. With no webhook configured, every online lesson had zero events and
-- went to admin review, and a webhook outage could make a present tutor look
-- absent. This adds a server-side presence poller:
--   * pg_cron calls famy_invoke_online_presence_poll() every minute. During an
--     active online lesson window it creates a single-use ticket and calls the
--     website route /api/online-sessions/presence-poll through pg_net.
--   * The route claims the ticket, asks LiveKit (RoomServiceClient
--     listParticipants, server credentials) who is in each lesson room, and
--     records the answer with record_online_session_presence().
--   * Poll results open/close session_events rows (source = 'poll'). Webhook
--     events still work and are deduplicated against poll rows.
--   * resolve_online_session_bookings settles an absence (refund / fee) only
--     with enough evidence: webhook events, or successful polls covering at
--     least half of the lesson. Otherwise the lesson goes to admin review.

-- ---------------------------------------------------------------------------
-- 1. Attendance source + poll log + tickets
-- ---------------------------------------------------------------------------
ALTER TABLE public.session_events
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'webhook';

ALTER TABLE public.session_events
  DROP CONSTRAINT IF EXISTS session_events_source_check;
ALTER TABLE public.session_events
  ADD CONSTRAINT session_events_source_check CHECK (source IN ('webhook', 'poll'));

CREATE TABLE IF NOT EXISTS public.session_presence_polls (
  id bigserial PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  polled_at timestamptz NOT NULL,
  ok boolean NOT NULL,
  customer_present boolean NOT NULL DEFAULT false,
  provider_present boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_presence_polls_booking_idx
  ON public.session_presence_polls (booking_id, polled_at);

ALTER TABLE public.session_presence_polls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.session_presence_polls FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.session_presence_polls TO authenticated;
GRANT SELECT, INSERT ON public.session_presence_polls TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.session_presence_polls_id_seq TO service_role;

DROP POLICY IF EXISTS session_presence_polls_admin_read ON public.session_presence_polls;
CREATE POLICY session_presence_polls_admin_read
  ON public.session_presence_polls
  FOR SELECT
  TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));

CREATE TABLE IF NOT EXISTS public.online_presence_poll_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz NULL
);

ALTER TABLE public.online_presence_poll_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.online_presence_poll_tickets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.online_presence_poll_tickets TO service_role;

-- Where pg_net sends the poll request (not a secret; the ticket authenticates).
INSERT INTO public.settings (key, value)
VALUES (
  'online_presence_poll',
  jsonb_build_object('url', 'https://famy-chi.vercel.app/api/online-sessions/presence-poll')
)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Lessons that need polling right now
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.online_presence_active_bookings()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id
  FROM public.bookings b
  WHERE b.service_mode = 'online'
    AND b.status = 'confirmed'
    AND now() >= b.start_at - interval '10 minutes'
    AND now() <= b.end_at + interval '5 minutes'
  ORDER BY b.start_at, b.id
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.online_presence_active_bookings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.online_presence_active_bookings() TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Single-use tickets authenticate pg_net -> website calls (no shared secret)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_online_presence_poll_ticket(p_ticket uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_ticket IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.online_presence_poll_tickets
  SET used_at = now()
  WHERE id = p_ticket
    AND used_at IS NULL
    AND created_at >= now() - interval '2 minutes';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_online_presence_poll_ticket(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_online_presence_poll_ticket(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.famy_invoke_online_presence_poll()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_ticket uuid;
BEGIN
  DELETE FROM public.online_presence_poll_tickets
  WHERE created_at < now() - interval '1 day';

  IF NOT EXISTS (SELECT 1 FROM public.online_presence_active_bookings()) THEN
    RETURN;
  END IF;

  SELECT NULLIF(btrim(s.value->>'url'), '') INTO v_url
  FROM public.settings s
  WHERE s.key = 'online_presence_poll';

  IF v_url IS NULL OR v_url !~ '^https://[^/?#]+/api/online-sessions/presence-poll$' THEN
    RAISE NOTICE 'famy_invoke_online_presence_poll skipped: settings.online_presence_poll.url missing or invalid';
    RETURN;
  END IF;

  INSERT INTO public.online_presence_poll_tickets DEFAULT VALUES
  RETURNING id INTO v_ticket;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('ticket', v_ticket),
    timeout_milliseconds := 20000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.famy_invoke_online_presence_poll() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.famy_invoke_online_presence_poll() TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Record one poll result for one lesson
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_online_session_presence(
  p_booking_id uuid,
  p_polled_at timestamptz,
  p_ok boolean,
  p_customer_present boolean,
  p_provider_present boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_participant text;
  v_present boolean;
  v_open record;
BEGIN
  IF p_booking_id IS NULL OR p_polled_at IS NULL THEN
    RAISE EXCEPTION 'Booking and poll time required' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = p_booking_id AND b.service_mode = 'online'
  ) THEN
    RETURN;
  END IF;

  -- Serialize with the webhook for the same lesson.
  PERFORM pg_advisory_xact_lock(hashtextextended('session_events:' || p_booking_id::text, 0));

  INSERT INTO public.session_presence_polls (
    booking_id, polled_at, ok, customer_present, provider_present
  ) VALUES (
    p_booking_id, p_polled_at, COALESCE(p_ok, false),
    COALESCE(p_customer_present, false), COALESCE(p_provider_present, false)
  );

  -- A failed poll says nothing about presence: keep the timeline as it is.
  IF NOT COALESCE(p_ok, false) THEN
    RETURN;
  END IF;

  FOREACH v_participant IN ARRAY ARRAY['customer', 'provider'] LOOP
    v_present := CASE v_participant
      WHEN 'customer' THEN COALESCE(p_customer_present, false)
      ELSE COALESCE(p_provider_present, false)
    END;

    SELECT se.id, se.joined_at INTO v_open
    FROM public.session_events se
    WHERE se.booking_id = p_booking_id
      AND se.participant = v_participant
      AND se.left_at IS NULL
    ORDER BY se.joined_at DESC
    LIMIT 1;

    IF v_present AND NOT FOUND THEN
      INSERT INTO public.session_events (booking_id, participant, joined_at, source)
      VALUES (p_booking_id, v_participant, p_polled_at, 'poll');
    ELSIF NOT v_present AND FOUND AND v_open.joined_at <= p_polled_at THEN
      UPDATE public.session_events
      SET left_at = p_polled_at
      WHERE id = v_open.id AND left_at IS NULL;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.record_online_session_presence(uuid, timestamptz, boolean, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_online_session_presence(uuid, timestamptz, boolean, boolean, boolean)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 5. LiveKit webhook: same lock, and a join while a row is already open
--    (opened by the poller) no longer fails on the one-open-row index.
--    Re-derived from 20261123230000_codex_p1_audit_fixes.sql.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_livekit_session_webhook_event(
  p_event_id text,
  p_booking_id uuid,
  p_event_type text,
  p_participant text,
  p_event_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rowcount integer;
  v_open record;
BEGIN
  IF p_event_id IS NULL OR btrim(p_event_id) = '' THEN
    RAISE EXCEPTION 'Event id required' USING ERRCODE = '23514';
  END IF;
  IF p_participant NOT IN ('customer', 'provider') THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('session_events:' || p_booking_id::text, 0));

  INSERT INTO public.session_livekit_webhook_events (
    id, booking_id, event_type, participant, event_at, processed_at
  ) VALUES (
    p_event_id, p_booking_id, p_event_type, p_participant, p_event_at, NULL
  )
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount = 0 THEN
    IF EXISTS (
      SELECT 1 FROM public.session_livekit_webhook_events e
      WHERE e.id = p_event_id AND e.processed_at IS NOT NULL
    ) THEN
      RETURN false;
    END IF;
  END IF;

  IF p_event_type = 'participant_joined' THEN
    SELECT se.id, se.joined_at INTO v_open
    FROM public.session_events se
    WHERE se.booking_id = p_booking_id
      AND se.participant = p_participant
      AND se.left_at IS NULL
    ORDER BY se.joined_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO public.session_events (booking_id, participant, joined_at, source)
      VALUES (p_booking_id, p_participant, p_event_at, 'webhook');
    ELSIF v_open.joined_at > p_event_at THEN
      -- Already open (e.g. seen by the poller a bit later): keep one row and
      -- use the more precise webhook join time.
      UPDATE public.session_events
      SET joined_at = p_event_at, source = 'webhook'
      WHERE id = v_open.id AND left_at IS NULL;
    END IF;
  ELSIF p_event_type = 'participant_left' THEN
    SELECT se.id, se.joined_at INTO v_open
    FROM public.session_events se
    WHERE se.booking_id = p_booking_id
      AND se.participant = p_participant
      AND se.left_at IS NULL
    ORDER BY se.joined_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO public.session_events (booking_id, participant, joined_at, left_at, source)
      VALUES (p_booking_id, p_participant, p_event_at, p_event_at, 'webhook');
    ELSIF v_open.joined_at > p_event_at THEN
      INSERT INTO public.session_events (booking_id, participant, joined_at, left_at, source)
      VALUES (p_booking_id, p_participant, p_event_at, p_event_at, 'webhook');
    ELSE
      UPDATE public.session_events
      SET left_at = p_event_at
      WHERE id = v_open.id AND left_at IS NULL;
    END IF;
  ELSE
    UPDATE public.session_livekit_webhook_events
    SET processed_at = now()
    WHERE id = p_event_id;
    RETURN true;
  END IF;

  UPDATE public.session_livekit_webhook_events
  SET processed_at = now()
  WHERE id = p_event_id;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  DELETE FROM public.session_livekit_webhook_events
  WHERE id = p_event_id AND processed_at IS NULL;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_livekit_session_webhook_event(text, uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_livekit_session_webhook_event(text, uuid, text, text, timestamptz)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Is there enough attendance evidence to settle an absence?
--    Webhook events, or successful polls covering >= half of the lesson.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.online_session_presence_evidence_ok(p_booking_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz;
  v_end timestamptz;
  v_duration_min numeric;
  v_polled_minutes integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.session_events se
    WHERE se.booking_id = p_booking_id AND se.source = 'webhook'
  ) THEN
    RETURN true;
  END IF;

  SELECT b.start_at, b.end_at INTO v_start, v_end
  FROM public.bookings b
  WHERE b.id = p_booking_id;

  IF NOT FOUND OR v_end <= v_start THEN
    RETURN false;
  END IF;

  v_duration_min := EXTRACT(epoch FROM (v_end - v_start)) / 60.0;

  SELECT count(DISTINCT date_trunc('minute', p.polled_at))::integer
  INTO v_polled_minutes
  FROM public.session_presence_polls p
  WHERE p.booking_id = p_booking_id
    AND p.ok
    AND p.polled_at >= v_start
    AND p.polled_at <= v_end;

  RETURN v_polled_minutes >= GREATEST(v_duration_min * 0.5, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.online_session_presence_evidence_ok(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.online_session_presence_evidence_ok(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Resolver: never settle an absence without evidence.
--    Re-derived from 20261126130100_audit_money_batch_a.sql (#537).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_online_session_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_settings record;
  v_overlap numeric;
  v_required numeric;
  v_duration_min numeric;
  v_outcome text;
  v_event_count integer;
  v_customer_present boolean;
  v_provider_present boolean;
  v_participant_minutes integer;
  v_evidence_ok boolean;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_settings FROM public.online_session_settings() LIMIT 1;

  FOR v_booking IN
    SELECT b.*
    FROM public.bookings b
    WHERE b.service_mode = 'online'
      AND b.status IN ('confirmed', 'completed')
      AND b.end_at + (COALESCE(v_settings.grace_minutes_after_end, 15) * interval '1 minute') <= now()
      AND b.online_session_outcome IS NULL
    ORDER BY b.end_at, b.id
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    SELECT count(*)::integer INTO v_event_count
    FROM public.session_events se
    WHERE se.booking_id = v_booking.id;

    v_evidence_ok := public.online_session_presence_evidence_ok(v_booking.id);

    v_duration_min := GREATEST(
      EXTRACT(epoch FROM (v_booking.end_at - v_booking.start_at)) / 60.0,
      0
    );
    v_required := v_duration_min * COALESCE(v_settings.overlap_ratio, 0.5);
    v_overlap := public.online_session_overlap_minutes(v_booking.id);
    v_customer_present := public.online_session_participant_present(v_booking.id, 'customer');
    v_provider_present := public.online_session_participant_present(v_booking.id, 'provider');

    IF v_event_count = 0 AND NOT v_evidence_ok THEN
      v_outcome := 'admin_review_no_events';
    ELSIF NOT v_customer_present AND NOT v_provider_present THEN
      v_outcome := 'both_absent';
    ELSIF NOT v_provider_present THEN
      v_outcome := 'provider_absent';
    ELSIF NOT v_customer_present THEN
      v_outcome := 'customer_absent';
    ELSIF v_overlap < v_required THEN
      v_outcome := 'admin_review_overlap';
    ELSE
      v_outcome := 'complete';
    END IF;

    -- An absence is money-relevant (refund / fee). Without trustworthy
    -- attendance data (no webhook events and poor poll coverage), never
    -- settle it automatically: send it to admin review instead.
    IF v_outcome IN ('provider_absent', 'customer_absent', 'both_absent')
       AND NOT v_evidence_ok THEN
      v_outcome := 'admin_review_no_events';
    END IF;

    SELECT COALESCE(
      sum(
        GREATEST(
          EXTRACT(
            epoch FROM (
              COALESCE(se.left_at, LEAST(now(), v_booking.end_at)) - se.joined_at
            )
          ),
          0
        )
      )::integer / 60,
      0
    ) INTO v_participant_minutes
    FROM public.session_events se
    WHERE se.booking_id = v_booking.id;

    UPDATE public.bookings
    SET online_session_outcome = v_outcome,
        online_participant_minutes = v_participant_minutes
    WHERE id = v_booking.id AND online_session_outcome IS NULL;

    -- #517: an absence is settled (refund / fee) while the lesson is still
    -- confirmed; a lesson the tutor already completed is only reviewed.
    IF v_outcome IN ('provider_absent', 'customer_absent', 'both_absent')
       AND v_booking.status = 'confirmed' THEN
      PERFORM public.settle_online_session_absence(v_booking.id, v_outcome);
      v_count := v_count + 1;
    END IF;

    IF v_outcome IN (
      'admin_review_no_events', 'admin_review_overlap',
      'provider_absent', 'customer_absent', 'both_absent'
    ) THEN
      PERFORM public.open_online_session_admin_review(
        v_booking.id,
        'Online session evidence: ' || v_outcome,
        jsonb_build_object(
          'overlap_minutes', v_overlap,
          'required_overlap_minutes', v_required,
          'event_count', v_event_count,
          'evidence_ok', v_evidence_ok,
          'outcome', v_outcome,
          'booking_status_before', v_booking.status
        )
      );
    END IF;

    -- History is protected by the online_session_outcome IS NULL filter above:
    -- lessons already resolved are never revisited.
    IF v_outcome = 'complete'
       AND v_booking.status = 'confirmed' THEN
      PERFORM set_config('app.auto_complete_in_progress', 'on', true);
      PERFORM set_config('app.audit_reason', 'online_session_auto_complete', true);

      UPDATE public.bookings
      SET status = 'completed',
          session_started_at = COALESCE(session_started_at, v_booking.start_at),
          session_ended_at = COALESCE(session_ended_at, v_booking.end_at),
          completion_requested_at = COALESCE(completion_requested_at, v_booking.end_at),
          completed_at = COALESCE(completed_at, now()),
          status_changed_at = now(),
          status_changed_by = NULL
      WHERE id = v_booking.id
        AND status = 'confirmed';

      IF FOUND THEN
        v_count := v_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_online_session_bookings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_online_session_bookings() TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Schedule the poll every minute (best effort, same pattern as push).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'famy-online-presence-poll') THEN
      PERFORM cron.unschedule('famy-online-presence-poll');
    END IF;
    PERFORM cron.schedule(
      'famy-online-presence-poll',
      '* * * * *',
      'SELECT public.famy_invoke_online_presence_poll();'
    );
  ELSE
    RAISE NOTICE 'famy-online-presence-poll not scheduled: pg_cron and pg_net are required.';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'famy-online-presence-poll scheduling skipped (%).', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
