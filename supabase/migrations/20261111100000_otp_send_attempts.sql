-- Throttle OTP send/begin/resend before account-existence checks (enumeration resistance).

CREATE TABLE IF NOT EXISTS public.otp_send_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash text,
  phone_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_send_attempts_ip_hash_created_at
  ON public.otp_send_attempts (ip_hash, created_at)
  WHERE ip_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_otp_send_attempts_phone_hash_created_at
  ON public.otp_send_attempts (phone_hash, created_at);

ALTER TABLE public.otp_send_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.otp_send_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.otp_send_attempts TO service_role;

COMMENT ON TABLE public.otp_send_attempts IS
  'Hashed OTP send/begin/resend attempts for pre-check rate limiting. Service role only.';
