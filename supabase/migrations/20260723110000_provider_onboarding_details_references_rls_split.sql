-- Split provider onboarding detail/reference policies so owners can read submitted
-- rows while writes remain gated to editable onboarding statuses.
--
-- provider_onboarding_details intentionally has no client DELETE policy: each provider
-- owns a single persistent row upserted via provider_save_onboarding_section, not a
-- replaceable collection. provider_references keeps DELETE for editable-status cleanup.

DROP POLICY IF EXISTS "provider_onboarding_details_own" ON public.provider_onboarding_details;
DROP POLICY IF EXISTS "provider_references_own" ON public.provider_references;

CREATE POLICY "provider_onboarding_details_select" ON public.provider_onboarding_details
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.profile_id = auth.uid()
    )
  );

CREATE POLICY "provider_onboarding_details_insert" ON public.provider_onboarding_details
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.profile_id = auth.uid()
        AND public.provider_onboarding_editable(p.onboarding_status)
    )
  );

CREATE POLICY "provider_onboarding_details_update" ON public.provider_onboarding_details
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.profile_id = auth.uid()
        AND public.provider_onboarding_editable(p.onboarding_status)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.profile_id = auth.uid()
        AND public.provider_onboarding_editable(p.onboarding_status)
    )
  );

CREATE POLICY "provider_references_select" ON public.provider_references
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.profile_id = auth.uid()
    )
  );

CREATE POLICY "provider_references_insert" ON public.provider_references
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.profile_id = auth.uid()
        AND public.provider_onboarding_editable(p.onboarding_status)
    )
  );

CREATE POLICY "provider_references_update" ON public.provider_references
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.profile_id = auth.uid()
        AND public.provider_onboarding_editable(p.onboarding_status)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.profile_id = auth.uid()
        AND public.provider_onboarding_editable(p.onboarding_status)
    )
  );

CREATE POLICY "provider_references_delete" ON public.provider_references
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.profile_id = auth.uid()
        AND public.provider_onboarding_editable(p.onboarding_status)
    )
  );
