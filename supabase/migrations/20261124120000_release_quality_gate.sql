-- Release quality gate: server-side feature flags (admin toggles) without touching online-sessions code paths.

INSERT INTO public.settings (key, value)
VALUES ('release_features', '{"online_lessons_enabled": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.release_features_config()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value FROM public.settings WHERE key = 'release_features'),
    '{"online_lessons_enabled": false}'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.release_features_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_features_config() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.online_lessons_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((public.release_features_config()->>'online_lessons_enabled')::boolean, false);
$$;

REVOKE ALL ON FUNCTION public.online_lessons_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.online_lessons_enabled() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';