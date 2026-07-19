-- Customer-facing Provider data must come only from the safe marketplace RPC.
-- Historical booking access is implemented inside marketplace_provider_details;
-- it must not grant SELECT on the full providers row.
DROP POLICY IF EXISTS "providers_marketplace_participant_read" ON public.providers;
DROP FUNCTION IF EXISTS public.can_read_provider(uuid);

-- Preserve the pre-existing least-privilege policies for Admin and the owning
-- Provider. Customers and anon receive no direct providers table policy.
REVOKE SELECT ON public.providers FROM anon;

