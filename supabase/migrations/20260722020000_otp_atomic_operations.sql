-- PATCH 3 (Part 1b): atomic OTP operations, uniqueness, and indexes.
-- Replaces read-then-write PostgREST patterns with single-transaction RPCs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- At most one active (unconsumed) OTP per phone + purpose.
CREATE UNIQUE INDEX IF NOT EXISTS idx_otp_verifications_one_active_per_phone_purpose
  ON public.otp_verifications (phone, purpose)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_otp_verifications_ip_created_at
  ON public.otp_verifications (ip_address, created_at DESC)
  WHERE ip_address IS NOT NULL;

-- Tiebreaker when created_at collides: id DESC after created_at DESC.
CREATE INDEX IF NOT EXISTS idx_otp_verifications_active_lookup
  ON public.otp_verifications (phone, purpose, created_at DESC, id DESC)
  WHERE used_at IS NULL;

CREATE OR REPLACE FUNCTION public.otp_begin_send(
  p_phone text,
  p_purpose public.otp_purpose,
  p_ip_address text,
  p_user_agent text,
  p_request_id uuid,
  p_otp_hash text,
  p_expires_at timestamptz,
  p_phone_limit int DEFAULT 3,
  p_phone_window interval DEFAULT interval '15 minutes',
  p_ip_limit int DEFAULT 20,
  p_ip_window interval DEFAULT interval '1 hour'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_count int;
  v_ip_count int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('otp_phone:' || p_phone));

  IF p_ip_address IS NOT NULL AND length(trim(p_ip_address)) > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('otp_ip:' || p_ip_address));
  END IF;

  SELECT count(*)::int INTO v_phone_count
  FROM public.otp_verifications
  WHERE phone = p_phone
    AND created_at > now() - p_phone_window;

  IF v_phone_count >= p_phone_limit THEN
    RETURN 'rate_limited_phone';
  END IF;

  IF p_ip_address IS NOT NULL AND length(trim(p_ip_address)) > 0 THEN
    SELECT count(*)::int INTO v_ip_count
    FROM public.otp_verifications
    WHERE ip_address = p_ip_address
      AND created_at > now() - p_ip_window;

    IF v_ip_count >= p_ip_limit THEN
      RETURN 'rate_limited_ip';
    END IF;
  END IF;

  UPDATE public.otp_verifications
  SET used_at = now()
  WHERE phone = p_phone
    AND purpose = p_purpose
    AND used_at IS NULL;

  INSERT INTO public.otp_verifications (
    phone, purpose, otp_hash, expires_at, ip_address, user_agent, request_id
  ) VALUES (
    p_phone, p_purpose, p_otp_hash, p_expires_at, p_ip_address, p_user_agent, p_request_id
  );

  RETURN 'ok';
EXCEPTION
  WHEN unique_violation THEN
    RETURN 'conflict';
END;
$$;

CREATE OR REPLACE FUNCTION public.otp_verify_and_consume(
  p_phone text,
  p_purpose public.otp_purpose,
  p_code text,
  p_max_attempts int DEFAULT 5
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.otp_verifications%ROWTYPE;
  v_next_attempts int;
BEGIN
  SELECT * INTO v_row
  FROM public.otp_verifications
  WHERE phone = p_phone
    AND purpose = p_purpose
    AND used_at IS NULL
  ORDER BY created_at DESC, id DESC
  FOR UPDATE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF v_row.expires_at <= now() THEN
    UPDATE public.otp_verifications
    SET used_at = now()
    WHERE id = v_row.id AND used_at IS NULL;
    RETURN 'expired';
  END IF;

  IF v_row.attempts >= p_max_attempts THEN
    UPDATE public.otp_verifications
    SET used_at = now()
    WHERE id = v_row.id AND used_at IS NULL;
    RETURN 'max_attempts';
  END IF;

  IF crypt(p_code, v_row.otp_hash) = v_row.otp_hash THEN
    UPDATE public.otp_verifications
    SET used_at = now()
    WHERE id = v_row.id AND used_at IS NULL;

    IF NOT FOUND THEN
      RETURN 'already_used';
    END IF;

    RETURN 'ok';
  END IF;

  v_next_attempts := v_row.attempts + 1;

  UPDATE public.otp_verifications
  SET
    attempts = v_next_attempts,
    used_at = CASE WHEN v_next_attempts >= p_max_attempts THEN now() ELSE NULL END
  WHERE id = v_row.id AND used_at IS NULL;

  IF v_next_attempts >= p_max_attempts THEN
    RETURN 'max_attempts';
  END IF;

  RETURN 'invalid_code';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otp_begin_send(text, public.otp_purpose, text, text, uuid, text, timestamptz, int, interval, int, interval)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.otp_verify_and_consume(text, public.otp_purpose, text, int)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.otp_begin_send(text, public.otp_purpose, text, text, uuid, text, timestamptz, int, interval, int, interval)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.otp_verify_and_consume(text, public.otp_purpose, text, int)
  TO service_role;
