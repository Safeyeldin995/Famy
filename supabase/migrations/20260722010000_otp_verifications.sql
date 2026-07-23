-- PATCH 3 (Part 1): OTP verification storage (service_role only).
-- Plain OTP codes are never stored; only bcrypt hashes.

DO $$ BEGIN
  CREATE TYPE public.otp_purpose AS ENUM ('LOGIN', 'SIGNUP', 'RESET_PASSWORD');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.otp_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  purpose public.otp_purpose NOT NULL,
  otp_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip_address text NULL,
  user_agent text NULL,
  request_id uuid NULL
);

CREATE INDEX IF NOT EXISTS idx_otp_verifications_phone_purpose
  ON public.otp_verifications (phone, purpose);

CREATE INDEX IF NOT EXISTS idx_otp_verifications_expires_at
  ON public.otp_verifications (expires_at);

ALTER TABLE public.otp_verifications ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.otp_verifications TO service_role;
