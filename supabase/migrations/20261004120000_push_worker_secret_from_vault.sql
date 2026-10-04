CREATE OR REPLACE FUNCTION public.get_notification_worker_secret()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ds.decrypted_secret
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'notification_worker_secret'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_notification_worker_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_notification_worker_secret() TO service_role;
