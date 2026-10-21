-- Native app push: Expo push tokens per device, delivered by the existing
-- send-push-notifications worker next to Web Push subscriptions.
-- Additive only. Clients never write the table directly; they go through
-- the SECURITY DEFINER RPCs below, which bind the token to auth.uid().

CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_device_push_tokens_user_active
  ON public.device_push_tokens(user_id) WHERE revoked_at IS NULL;

ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_push_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.device_push_tokens TO authenticated;
GRANT ALL ON public.device_push_tokens TO service_role;

CREATE POLICY device_push_tokens_select_own ON public.device_push_tokens
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Register (or move) this device's token to the signed-in user. A device that
-- switches accounts re-registers, so the token follows the current account.
CREATE OR REPLACE FUNCTION public.register_device_push_token(p_token text, p_platform text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_token IS NULL OR p_token !~ '^ExponentPushToken\[[A-Za-z0-9_-]{10,200}\]$' THEN
    RAISE EXCEPTION 'invalid_push_token' USING ERRCODE = '22023';
  END IF;
  IF p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'invalid_platform' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.device_push_tokens (user_id, token, platform)
  VALUES (v_uid, p_token, p_platform)
  ON CONFLICT (token) DO UPDATE
    SET user_id = v_uid,
        platform = EXCLUDED.platform,
        last_seen_at = now(),
        revoked_at = NULL;
END;
$$;

-- Sign-out / opt-out from this device. Only the token's owner can revoke it.
CREATE OR REPLACE FUNCTION public.revoke_device_push_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.device_push_tokens
     SET revoked_at = now()
   WHERE token = p_token AND user_id = auth.uid() AND revoked_at IS NULL;
END;
$$;

-- Worker-only: Expo reported the device as no longer registered.
CREATE OR REPLACE FUNCTION public.mark_device_push_token_expired(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.device_push_tokens
     SET revoked_at = now()
   WHERE token = p_token AND revoked_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_device_push_token(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_device_push_token(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_device_push_token_expired(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_device_push_token(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_device_push_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_device_push_token_expired(text) TO service_role;

NOTIFY pgrst, 'reload schema';
