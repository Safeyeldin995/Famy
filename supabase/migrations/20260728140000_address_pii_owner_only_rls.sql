-- PATCH 6A.1: Customer saved addresses are owner-only PII.
-- Removes the broad Admin SELECT policy that exposed every customer's
-- address row to any authenticated user with the admin role (including
-- dual-role admin+customer accounts on customer-facing screens).
--
-- Future Admin support access must use:
--   - immutable public.booking_locations snapshots tied to a booking, and/or
--   - a scoped SECURITY DEFINER RPC or server route — never a blanket SELECT
--     on public.addresses for customer JWTs.

DROP POLICY IF EXISTS "addresses_admin_read" ON public.addresses;

-- addresses_self (user_id = auth.uid()) remains the sole customer access path.
