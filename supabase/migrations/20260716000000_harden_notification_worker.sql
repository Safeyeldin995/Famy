-- Famy Patch 3 security hardening: atomic, concurrency-safe outbox claim.
-- Additive only. Fixes a SELECT-then-UPDATE race in the send-push-notifications
-- worker (two overlapping invocations could both select the same due rows
-- before either flipped them to 'processing', causing duplicate pushes) and
-- adds recovery for rows abandoned mid-processing (function crash/timeout
-- left them stuck in 'processing' forever, since the due-query only looked
-- at queued/failed).

ALTER TABLE public.notification_outbox
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

-- Atomically claims up to p_batch_size due rows (queued/failed due now, or
-- processing rows abandoned longer than p_stale_minutes ago) using
-- FOR UPDATE SKIP LOCKED so concurrent worker invocations never claim the
-- same row twice. Worker-only.
CREATE OR REPLACE FUNCTION public.claim_notification_outbox_batch(
  p_batch_size int DEFAULT 50,
  p_stale_minutes int DEFAULT 5
)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.notification_outbox o
  SET status = 'processing', processing_started_at = now()
  FROM (
    SELECT id FROM public.notification_outbox
    WHERE (status IN ('queued', 'failed') AND next_attempt_at <= now())
       OR (status = 'processing' AND processing_started_at <= now() - (p_stale_minutes || ' minutes')::interval)
    ORDER BY next_attempt_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ) claimed
  WHERE o.id = claimed.id
  RETURNING o.*;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_notification_outbox_batch(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_outbox_batch(int, int) TO service_role;
