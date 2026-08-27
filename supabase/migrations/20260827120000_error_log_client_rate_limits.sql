-- Distributed client error-log rate limiting (Postgres-backed; safe across Cloudflare Workers isolates).

CREATE TABLE IF NOT EXISTS public.error_log_rate_limits (
  rate_key text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count int NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (rate_key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_error_log_rate_limits_window_start
  ON public.error_log_rate_limits (window_start);

ALTER TABLE public.error_log_rate_limits ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.error_log_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.error_log_client_rate_limit_allow(
  p_rate_key text,
  p_limit int DEFAULT 20,
  p_window_seconds int DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate_key text;
  v_window_start timestamptz;
  v_count int;
BEGIN
  v_rate_key := coalesce(nullif(trim(p_rate_key), ''), 'unknown');
  IF length(v_rate_key) > 120 THEN
    v_rate_key := left(v_rate_key, 120);
  END IF;

  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / greatest(p_window_seconds, 1)) * greatest(p_window_seconds, 1)
  );

  PERFORM pg_advisory_xact_lock(
    hashtext('error_log_rate:' || v_rate_key || ':' || v_window_start::text)
  );

  INSERT INTO public.error_log_rate_limits AS rl (rate_key, window_start, request_count)
  VALUES (v_rate_key, v_window_start, 1)
  ON CONFLICT (rate_key, window_start)
  DO UPDATE SET request_count = rl.request_count + 1
  RETURNING request_count INTO v_count;

  DELETE FROM public.error_log_rate_limits
  WHERE window_start < now() - make_interval(secs => greatest(p_window_seconds, 1) * 2);

  RETURN v_count <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.error_log_client_rate_limit_allow(text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.error_log_client_rate_limit_allow(text, int, int) TO service_role;
