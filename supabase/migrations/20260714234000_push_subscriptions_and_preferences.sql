-- Famy Patch 3 / Module 4: push subscriptions + notification preferences.
-- Additive only.

-- ============================================================
-- 1) PUSH SUBSCRIPTIONS. One row per browser/device. `auth_key` (not
-- `auth`) to avoid any ambiguity with the `auth` schema inside functions.
-- No direct INSERT/UPDATE/DELETE grant to authenticated — registration and
-- revocation only happen through the SECURITY DEFINER functions below, so
-- a user can never write another user's subscription row. SELECT is
-- self-only so a user can list/manage their own devices; raw endpoints
-- are never exposed to Admin (no admin policy exists on this table).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth_key text NOT NULL,
  device_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user_active ON public.push_subscriptions(user_id) WHERE revoked_at IS NULL;

GRANT SELECT ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subs_self_select ON public.push_subscriptions;
CREATE POLICY push_subs_self_select ON public.push_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Register or refresh a subscription. Upserts on the unique endpoint: if
-- the same browser endpoint was previously owned by a different account
-- (e.g. a shared device, different user logged in), ownership transfers
-- to the current session — the endpoint itself came from the browser's
-- push service, not from client-supplied identity, so this is safe.
CREATE OR REPLACE FUNCTION public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth_key text, p_device_label text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF p_endpoint IS NULL OR btrim(p_endpoint) = '' OR p_p256dh IS NULL OR btrim(p_p256dh) = ''
     OR p_auth_key IS NULL OR btrim(p_auth_key) = '' THEN
    RAISE EXCEPTION 'Invalid push subscription.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth_key, device_label, last_seen_at, revoked_at)
  VALUES (v_uid, p_endpoint, p_p256dh, p_auth_key, NULLIF(btrim(COALESCE(p_device_label, '')), ''), now(), NULL)
  ON CONFLICT (endpoint) DO UPDATE SET
    user_id = v_uid,
    p256dh = EXCLUDED.p256dh,
    auth_key = EXCLUDED.auth_key,
    device_label = EXCLUDED.device_label,
    last_seen_at = now(),
    revoked_at = NULL
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.register_push_subscription(text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_subscription(text,text,text,text) TO authenticated;

-- Revoke by endpoint (client already holds its own PushSubscription.endpoint
-- when the user disables push in-browser) — self-owned rows only.
CREATE OR REPLACE FUNCTION public.revoke_push_subscription(p_endpoint text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.push_subscriptions
  SET revoked_at = now()
  WHERE endpoint = p_endpoint AND user_id = auth.uid() AND revoked_at IS NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.revoke_push_subscription(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_push_subscription(text) TO authenticated;

-- Revoke by id (device-list "remove this device" UI, no endpoint round-trip).
CREATE OR REPLACE FUNCTION public.revoke_push_subscription_by_id(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.push_subscriptions
  SET revoked_at = now()
  WHERE id = p_id AND user_id = auth.uid() AND revoked_at IS NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.revoke_push_subscription_by_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_push_subscription_by_id(uuid) TO authenticated;

-- Worker-only: called by the delivery worker on a permanent-expiration
-- response (410 Gone / 404). Not reachable by authenticated clients.
CREATE OR REPLACE FUNCTION public.mark_push_subscription_expired(p_endpoint text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.push_subscriptions SET revoked_at = now()
  WHERE endpoint = p_endpoint AND revoked_at IS NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mark_push_subscription_expired(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_push_subscription_expired(text) TO service_role;

-- ============================================================
-- 2) NOTIFICATION PREFERENCES. Push is togglable per category. In-app
-- storage of transactional notifications (booking/chat/reminder/support)
-- is not a preference at all — the spec guarantees it unconditionally, so
-- there is deliberately no *_in_app column for those; only the marketing
-- category needs an in-app opt-out, since it's the one category that
-- isn't operationally required. Marketing push defaults to off.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  booking_push boolean NOT NULL DEFAULT true,
  chat_push boolean NOT NULL DEFAULT true,
  reminder_push boolean NOT NULL DEFAULT true,
  support_push boolean NOT NULL DEFAULT true,
  campaign_push boolean NOT NULL DEFAULT false,
  campaign_in_app boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_preferences_self ON public.notification_preferences;
CREATE POLICY notification_preferences_self ON public.notification_preferences FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_notification_preferences_updated ON public.notification_preferences;
CREATE TRIGGER trg_notification_preferences_updated BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
