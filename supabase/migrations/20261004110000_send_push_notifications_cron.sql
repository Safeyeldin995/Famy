-- Schedule send-push-notifications via pg_cron + pg_net. Vault-backed secrets only.
-- Draft only: do not apply to QA or Production from this PR.

-- ============================================================
-- 1) auth_user_id_for_phone — NULL email must not sort first (#98)
-- ============================================================
CREATE OR REPLACE FUNCTION public.auth_user_id_for_phone(p_auth_email text, p_phone text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM auth.users
  WHERE email = p_auth_email
     OR phone = p_phone
     OR phone = ltrim(p_phone, '+')
  ORDER BY (email = p_auth_email) DESC NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.auth_user_id_for_phone(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_id_for_phone(text, text) TO service_role;

-- ============================================================
-- 2) Worker invoker — reads project URL + worker secret from Vault
-- ============================================================
CREATE OR REPLACE FUNCTION public.famy_invoke_send_push_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_url text;
  v_worker_secret text;
  v_url text;
BEGIN
  SELECT ds.decrypted_secret INTO v_worker_secret
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'notification_worker_secret'
  LIMIT 1;

  SELECT ds.decrypted_secret INTO v_project_url
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'project_url'
  LIMIT 1;

  IF v_worker_secret IS NULL OR v_project_url IS NULL THEN
    RAISE NOTICE 'famy_invoke_send_push_notifications skipped: vault secrets notification_worker_secret and/or project_url missing';
    RETURN;
  END IF;

  v_url := rtrim(v_project_url, '/') || '/functions/v1/send-push-notifications';

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', v_worker_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.famy_invoke_send_push_notifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.famy_invoke_send_push_notifications() TO service_role;

-- ============================================================
-- 3) pg_net + pg_cron (best-effort, same pattern as reminders)
-- ============================================================
DO $$
BEGIN
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_net extension unavailable (%); schedule send-push-notifications externally.', SQLERRM;
END $$;

DO $$
BEGIN
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron extension unavailable (%); schedule famy_invoke_send_push_notifications() externally.', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'famy-send-push-notifications') THEN
      PERFORM cron.unschedule('famy-send-push-notifications');
    END IF;
    PERFORM cron.schedule(
      'famy-send-push-notifications',
      '* * * * *',
      'SELECT public.famy_invoke_send_push_notifications();'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron scheduling skipped (%); schedule famy_invoke_send_push_notifications() externally.', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
