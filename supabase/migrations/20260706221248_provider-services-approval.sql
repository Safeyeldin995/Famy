-- Beta Stabilization Sprint 1, Issue #2: Provider Services Approval.
-- Root cause: provider_services had no approval gate at all — a provider's
-- self-inserted row (via the existing ps_provider_manage policy) was
-- immediately public via ps_public_read. This adds the one missing column
-- needed to gate that, reusing the existing admin/provider policy structure
-- rather than redesigning it.

ALTER TABLE public.provider_services
  ADD COLUMN status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected'));

CREATE INDEX idx_ps_status ON public.provider_services(status);

-- Providers may still manage their own rows (add/remove a requested service),
-- but can never set status directly — every new request starts 'pending' and
-- can only move to 'approved'/'rejected' via the existing ps_admin_all policy.
DROP POLICY IF EXISTS "ps_provider_manage" ON public.provider_services;
CREATE POLICY "ps_provider_manage" ON public.provider_services FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()))
  WITH CHECK (
    EXISTS(SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid())
    AND status = 'pending'
  );
