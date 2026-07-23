-- PATCH 4.2: server-side single-use password setup authorization.

CREATE TABLE IF NOT EXISTS public.password_setup_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  phone text NOT NULL,
  purpose public.otp_purpose NOT NULL,
  signup_role text CHECK (signup_role IS NULL OR signup_role IN ('customer', 'provider')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_setup_authorizations_active_lookup
  ON public.password_setup_authorizations (id, user_id)
  WHERE consumed_at IS NULL;

ALTER TABLE public.password_setup_authorizations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_password_setup_authorization(
  p_auth_id uuid,
  p_user_id uuid,
  p_phone text,
  p_purpose public.otp_purpose
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated uuid;
BEGIN
  UPDATE public.password_setup_authorizations
  SET consumed_at = now()
  WHERE id = p_auth_id
    AND consumed_at IS NULL
    AND expires_at > now()
    AND user_id = p_user_id
    AND phone = p_phone
    AND purpose = p_purpose
  RETURNING id INTO v_updated;

  IF v_updated IS NOT NULL THEN
    RETURN 'ok';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.password_setup_authorizations WHERE id = p_auth_id
  ) THEN
    RETURN 'not_found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.password_setup_authorizations
    WHERE id = p_auth_id AND consumed_at IS NOT NULL
  ) THEN
    RETURN 'already_consumed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.password_setup_authorizations
    WHERE id = p_auth_id AND expires_at <= now()
  ) THEN
    RETURN 'expired';
  END IF;

  RETURN 'mismatch';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_password_setup_authorization(uuid, uuid, text, public.otp_purpose) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_password_setup_authorization(uuid, uuid, text, public.otp_purpose) TO service_role;
