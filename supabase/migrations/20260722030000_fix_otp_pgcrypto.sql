-- PATCH 3.4: schema-qualify pgcrypto crypt() for Supabase hosted (extensions schema).

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

  IF extensions.crypt(p_code, v_row.otp_hash) = v_row.otp_hash THEN
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

REVOKE EXECUTE ON FUNCTION public.otp_verify_and_consume(text, public.otp_purpose, text, int)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.otp_verify_and_consume(text, public.otp_purpose, text, int)
  TO service_role;
