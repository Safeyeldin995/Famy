-- Phase C (option A): admin may request updated details from an APPROVED
-- provider (APPROVED → NEEDS_CHANGES). Copies the latest
-- admin_provider_onboarding_action body from
-- 20260723050000_provider_onboarding_security_remediation.sql and adds one
-- action. Does not rewrite Phase A/B. Does not backfill max_children or
-- bulk-update provider status.
--
-- New bookings drop out of marketplace eligibility because that gate already
-- requires onboarding_status = APPROVED. Existing bookings are not modified.

CREATE OR REPLACE FUNCTION public.admin_provider_onboarding_action(
  p_provider_id uuid,
  p_action text,
  p_reason_code text DEFAULT NULL,
  p_reason_public text DEFAULT NULL,
  p_notes_internal text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_new_status public.provider_onboarding_status;
  v_completion jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE id = p_provider_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider not found.' USING ERRCODE = '42501'; END IF;

  IF p_action = 'start_review' THEN
    IF v_provider.onboarding_status <> 'SUBMITTED' THEN
      RAISE EXCEPTION 'Only submitted applications can enter review.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'UNDER_REVIEW';
  ELSIF p_action = 'approve' THEN
    IF v_provider.onboarding_status NOT IN ('SUBMITTED', 'UNDER_REVIEW') THEN
      RAISE EXCEPTION 'Only submitted or in-review applications can be approved.' USING ERRCODE = '23514';
    END IF;
    v_completion := public.provider_onboarding_completion(p_provider_id);
    IF NOT COALESCE((v_completion->>'complete')::boolean, false) THEN
      RAISE EXCEPTION 'Application is incomplete and cannot be approved.' USING ERRCODE = '23514';
    END IF;
    IF NOT public.provider_required_documents_approved(p_provider_id) THEN
      RAISE EXCEPTION 'Required identity documents must be approved before provider approval.' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.provider_documents d
      WHERE d.provider_id = p_provider_id AND d.type IN ('id_card_front', 'id_card_back') AND d.status = 'rejected'
    ) THEN
      RAISE EXCEPTION 'Rejected required documents must be replaced and approved.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'APPROVED';
  ELSIF p_action = 'request_changes' THEN
    IF v_provider.onboarding_status NOT IN ('SUBMITTED', 'UNDER_REVIEW') THEN
      RAISE EXCEPTION 'Invalid status for requesting changes.' USING ERRCODE = '23514';
    END IF;
    IF p_reason_code IS NULL OR btrim(p_reason_code) = '' OR p_reason_public IS NULL OR btrim(p_reason_public) = '' THEN
      RAISE EXCEPTION 'A reason is required to request changes.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'NEEDS_CHANGES';
  ELSIF p_action = 'request_updated_details' THEN
    IF v_provider.profile_id = v_uid THEN
      RAISE EXCEPTION 'Administrators cannot request updated details for their own provider profile.' USING ERRCODE = '42501';
    END IF;
    IF v_provider.onboarding_status <> 'APPROVED' THEN
      RAISE EXCEPTION 'Only approved providers can be asked for updated details.' USING ERRCODE = '23514';
    END IF;
    IF p_reason_code IS NULL OR btrim(p_reason_code) = '' OR p_reason_public IS NULL OR btrim(p_reason_public) = '' THEN
      RAISE EXCEPTION 'A reason is required to request updated details.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'NEEDS_CHANGES';
  ELSIF p_action = 'reject' THEN
    IF v_provider.onboarding_status NOT IN ('SUBMITTED', 'UNDER_REVIEW', 'NEEDS_CHANGES') THEN
      RAISE EXCEPTION 'Invalid status for rejection.' USING ERRCODE = '23514';
    END IF;
    IF p_reason_code IS NULL OR btrim(p_reason_code) = '' OR p_reason_public IS NULL OR btrim(p_reason_public) = '' THEN
      RAISE EXCEPTION 'A reason is required to reject an application.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'REJECTED';
  ELSIF p_action = 'suspend' THEN
    IF v_provider.onboarding_status <> 'APPROVED' THEN
      RAISE EXCEPTION 'Only approved providers can be suspended.' USING ERRCODE = '23514';
    END IF;
    IF p_reason_code IS NULL OR btrim(p_reason_code) = '' OR p_reason_public IS NULL OR btrim(p_reason_public) = '' THEN
      RAISE EXCEPTION 'A reason is required to suspend a provider.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'SUSPENDED';
  ELSIF p_action = 'unsuspend' THEN
    IF v_provider.onboarding_status <> 'SUSPENDED' THEN
      RAISE EXCEPTION 'Only suspended providers can be unsuspended.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'APPROVED';
  ELSE
    RAISE EXCEPTION 'Unknown onboarding action.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.audit_reason', COALESCE(btrim(p_reason_public), ''), true);
  PERFORM set_config('app.onboarding_internal_call', '1', true);
  PERFORM public.apply_provider_onboarding_status(
    p_provider_id, v_new_status, v_uid, 'admin', p_action,
    p_reason_code, p_reason_public, p_notes_internal, '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_provider_onboarding_action(uuid, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_provider_onboarding_action(uuid, text, text, text, text)
  TO authenticated;
