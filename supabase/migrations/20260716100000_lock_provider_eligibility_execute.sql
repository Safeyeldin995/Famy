DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'provider_eligibility'
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM authenticated', fn);
  END LOOP;
END
$$;

GRANT EXECUTE ON FUNCTION public.provider_eligibility(uuid) TO authenticated;
