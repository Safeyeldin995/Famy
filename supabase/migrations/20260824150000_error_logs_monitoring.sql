-- Milestone 3 monitoring minimum: application error_logs + admin monitoring summary.
-- QA-first; Production application is a separate approved step.

CREATE TABLE IF NOT EXISTS public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  message_safe text NOT NULL,
  source text NOT NULL CHECK (source IN ('client', 'server', 'edge')),
  context_route text,
  context_label text,
  CONSTRAINT error_logs_message_safe_len CHECK (char_length(message_safe) BETWEEN 1 AND 500),
  CONSTRAINT error_logs_context_route_len CHECK (context_route IS NULL OR char_length(context_route) <= 200),
  CONSTRAINT error_logs_context_label_len CHECK (context_label IS NULL OR char_length(context_label) <= 120)
);

CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON public.error_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_source ON public.error_logs (source, created_at DESC);

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.error_logs TO authenticated;
GRANT ALL ON public.error_logs TO service_role;

CREATE POLICY "error_logs_admin_read" ON public.error_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Writes are service_role only (no INSERT/UPDATE/DELETE policies for authenticated).

CREATE OR REPLACE FUNCTION public.admin_monitoring_summary(
  p_since timestamptz DEFAULT (now() - interval '7 days')
)
RETURNS TABLE (
  recent_errors bigint,
  failed_payments bigint,
  failed_notifications bigint,
  oldest_error_at timestamptz,
  oldest_failed_payment_at timestamptz,
  oldest_failed_notification_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM public.error_logs WHERE created_at >= p_since),
    (SELECT count(*) FROM public.payments WHERE status IN ('failed', 'rejected') AND created_at >= p_since),
    (SELECT count(*) FROM public.notification_outbox WHERE status IN ('failed', 'dead') AND created_at >= p_since),
    (SELECT min(created_at) FROM public.error_logs WHERE created_at >= p_since),
    (SELECT min(created_at) FROM public.payments WHERE status IN ('failed', 'rejected') AND created_at >= p_since),
    (SELECT min(created_at) FROM public.notification_outbox WHERE status IN ('failed', 'dead') AND created_at >= p_since);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_monitoring_summary(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_monitoring_summary(timestamptz) TO authenticated;
