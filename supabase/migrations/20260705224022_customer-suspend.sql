-- Admin Portal: customer suspend/unsuspend.
-- Single column, mirrors the existing has_role() SECURITY DEFINER pattern for
-- the enforcement function, and reuses the existing DROP+CREATE POLICY
-- pattern already used for payments_customer_insert. No new tables, no
-- schema redesign.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_not_suspended(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT COALESCE((SELECT is_suspended FROM public.profiles WHERE id = _user_id), false);
$$;

REVOKE EXECUTE ON FUNCTION public.is_not_suspended(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_not_suspended(uuid) TO authenticated;

-- Suspended customers cannot create new bookings (existing activity remains
-- visible/readable; this only blocks starting new activity).
DROP POLICY IF EXISTS "bookings_customer_insert" ON public.bookings;
CREATE POLICY "bookings_customer_insert" ON public.bookings
  FOR INSERT TO authenticated
  WITH CHECK (customer_id = auth.uid() AND public.is_not_suspended(auth.uid()));

-- Admin-only column update path (Admin Portal suspend/unsuspend action).
-- profiles_self_update already exists (auth.uid() = id) and does not need to
-- change; admins update via the existing profiles_admin_select-equivalent
-- write path below, mirroring the has_role() admin-write pattern already used
-- on settings/payments.
DROP POLICY IF EXISTS "profiles_admin_update" ON public.profiles;
CREATE POLICY "profiles_admin_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
