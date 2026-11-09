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

CREATE POLICY area_requests_insert_own ON public.area_requests
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY area_requests_select_own ON public.area_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

REVOKE ALL ON public.area_requests FROM anon;
GRANT SELECT, INSERT ON public.area_requests TO authenticated;

-- At most 5 requests per customer per day.
CREATE OR REPLACE FUNCTION public.tg_area_requests_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (
    SELECT count(*) FROM public.area_requests
    WHERE user_id = NEW.user_id AND created_at > now() - interval '1 day'
  ) >= 5 THEN
    RAISE EXCEPTION 'area_request_rate_limited' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_area_requests_rate_limit
  BEFORE INSERT ON public.area_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_area_requests_rate_limit();
