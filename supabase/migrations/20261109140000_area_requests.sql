-- Customers who drop their address pin outside every service zone can ask
-- Famy to come to their area. Admins use the requests to pick the next zones.

CREATE TABLE IF NOT EXISTS public.area_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS area_requests_created_at_idx ON public.area_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS area_requests_user_idx ON public.area_requests (user_id, created_at DESC);

ALTER TABLE public.area_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'area_requests' AND policyname = 'area_requests_insert_own'
  ) THEN
    CREATE POLICY area_requests_insert_own ON public.area_requests
      FOR INSERT TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'area_requests' AND policyname = 'area_requests_select_own'
  ) THEN
    CREATE POLICY area_requests_select_own ON public.area_requests
      FOR SELECT TO authenticated
      USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));
  END IF;
END $$;

REVOKE ALL ON public.area_requests FROM anon;
GRANT SELECT, INSERT ON public.area_requests TO authenticated;

-- At most 5 requests per customer per day. The server sets user_id and
-- created_at (clients cannot backdate to dodge the limit), and a per-user
-- advisory lock makes the count hold under concurrent inserts.
CREATE OR REPLACE FUNCTION public.tg_area_requests_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.user_id := auth.uid();
  NEW.created_at := now();
  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('area_requests:' || NEW.user_id::text));
  IF (
    SELECT count(*) FROM public.area_requests
    WHERE user_id = NEW.user_id AND created_at > now() - interval '1 day'
  ) >= 5 THEN
    RAISE EXCEPTION 'area_request_rate_limited' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_area_requests_rate_limit() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_area_requests_rate_limit' AND tgrelid = 'public.area_requests'::regclass
  ) THEN
    CREATE TRIGGER trg_area_requests_rate_limit
      BEFORE INSERT ON public.area_requests
      FOR EACH ROW EXECUTE FUNCTION public.tg_area_requests_rate_limit();
  END IF;
END $$;
