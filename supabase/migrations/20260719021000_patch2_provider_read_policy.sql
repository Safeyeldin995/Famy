-- Break the providers <-> bookings RLS recursion introduced by the Patch 2
-- participant policy while keeping raw Provider rows private from anon and
-- unrelated Customers.
CREATE OR REPLACE FUNCTION public.can_read_provider(p_provider_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.providers p WHERE p.id = p_provider_id AND p.profile_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.bookings b WHERE b.provider_id = p_provider_id AND b.customer_id = auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION public.can_read_provider(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_provider(uuid) TO authenticated;

DROP POLICY IF EXISTS "providers_marketplace_participant_read" ON public.providers;
CREATE POLICY "providers_marketplace_participant_read" ON public.providers
  FOR SELECT TO authenticated
  USING (public.can_read_provider(id));

