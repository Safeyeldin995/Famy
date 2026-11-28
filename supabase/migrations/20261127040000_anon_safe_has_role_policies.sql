-- #565: has_role() is not executable by anon (revoked in 20260627001514). Postgres
-- checks EXECUTE on every function in every policy that applies to the role, so any
-- anon SELECT on a table whose PUBLIC/anon policy calls has_role() fails with 42501.
-- Guests therefore never saw tutor reviews.
--
-- Fix without re-granting has_role to anon:
--   * reviews: a separate anon policy without has_role; the admin branch stays for
--     authenticated only.
--   * admin/provider-only policies that were created TO PUBLIC are narrowed to
--     authenticated (anon has no auth.uid(), so these never matched a guest anyway).
-- No data changes.

DROP POLICY IF EXISTS "reviews_public_read" ON public.reviews;
DROP POLICY IF EXISTS "reviews_anon_read" ON public.reviews;

CREATE POLICY "reviews_anon_read" ON public.reviews FOR SELECT TO anon
  USING (moderation_hidden_at IS NULL);

CREATE POLICY "reviews_public_read" ON public.reviews FOR SELECT TO authenticated
  USING (
    moderation_hidden_at IS NULL
    OR public.has_role((SELECT auth.uid()), 'admin')
  );

ALTER POLICY "admins manage incidents" ON public.provider_incidents TO authenticated;
ALTER POLICY "incidents visible to admin and provider" ON public.provider_incidents TO authenticated;
ALTER POLICY "providers manage own vacations" ON public.provider_vacations TO authenticated;
ALTER POLICY provider_warnings_select ON public.provider_warnings TO authenticated;
