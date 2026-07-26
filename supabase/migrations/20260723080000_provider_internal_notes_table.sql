-- Restore providers table SELECT for PostgREST select=* queries and isolate internal notes.

GRANT SELECT ON public.providers TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.provider_admin_internal_notes (
  provider_id uuid PRIMARY KEY REFERENCES public.providers(id) ON DELETE CASCADE,
  review_notes_internal text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_admin_internal_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "provider_admin_internal_notes_admin" ON public.provider_admin_internal_notes;
CREATE POLICY "provider_admin_internal_notes_admin" ON public.provider_admin_internal_notes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_admin_internal_notes TO authenticated;

INSERT INTO public.provider_admin_internal_notes (provider_id, review_notes_internal)
SELECT id, review_notes_internal
FROM public.providers
WHERE review_notes_internal IS NOT NULL
ON CONFLICT (provider_id) DO UPDATE
  SET review_notes_internal = EXCLUDED.review_notes_internal,
      updated_at = now();

CREATE OR REPLACE FUNCTION public.apply_provider_onboarding_status(
  p_provider_id uuid,
  p_new_status public.provider_onboarding_status,
  p_actor_id uuid,
  p_actor_role text,
  p_action text,
  p_reason_code text DEFAULT NULL,
  p_reason_public text DEFAULT NULL,
  p_notes_internal text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old public.provider_onboarding_status;
  v_actor_id uuid := auth.uid();
  v_actor_role text;
BEGIN
  PERFORM public.assert_onboarding_internal_call();

  IF v_actor_id IS NULL THEN
    v_actor_id := p_actor_id;
    v_actor_role := COALESCE(NULLIF(btrim(p_actor_role), ''), 'system');
  ELSIF public.has_role(v_actor_id, 'admin') THEN
    v_actor_role := 'admin';
  ELSIF EXISTS (SELECT 1 FROM public.providers p WHERE p.id = p_provider_id AND p.profile_id = v_actor_id) THEN
    v_actor_role := 'provider';
  ELSE
    RAISE EXCEPTION 'Unauthorized onboarding status transition.' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.onboarding_status_transition', '1', true);

  SELECT onboarding_status INTO v_old FROM public.providers WHERE id = p_provider_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider not found.' USING ERRCODE = '42501'; END IF;

  UPDATE public.providers
  SET onboarding_status = p_new_status,
      is_verified = (p_new_status = 'APPROVED'),
      is_active = CASE
        WHEN p_new_status = 'APPROVED' THEN true
        WHEN p_new_status = 'SUSPENDED' THEN false
        WHEN p_new_status = 'REJECTED' THEN false
        ELSE is_active
      END,
      last_review_at = CASE WHEN p_new_status IN ('UNDER_REVIEW','NEEDS_CHANGES','APPROVED','REJECTED','SUSPENDED') THEN now() ELSE last_review_at END,
      review_reason_code = CASE WHEN p_new_status IN ('NEEDS_CHANGES','REJECTED','SUSPENDED') THEN p_reason_code ELSE NULL END,
      review_reason_public = CASE WHEN p_new_status IN ('NEEDS_CHANGES','REJECTED','SUSPENDED') THEN p_reason_public ELSE NULL END,
      submitted_at = CASE WHEN p_new_status = 'SUBMITTED' AND submitted_at IS NULL THEN now() ELSE submitted_at END,
      resubmitted_at = CASE WHEN p_new_status = 'SUBMITTED' AND v_old IN ('NEEDS_CHANGES','REJECTED') THEN now() ELSE resubmitted_at END
  WHERE id = p_provider_id;

  IF p_new_status IN ('NEEDS_CHANGES','REJECTED','SUSPENDED') AND p_notes_internal IS NOT NULL AND btrim(p_notes_internal) <> '' THEN
    INSERT INTO public.provider_admin_internal_notes (provider_id, review_notes_internal, updated_at)
    VALUES (p_provider_id, btrim(p_notes_internal), now())
    ON CONFLICT (provider_id) DO UPDATE
      SET review_notes_internal = EXCLUDED.review_notes_internal,
          updated_at = now();
  END IF;

  PERFORM set_config('app.onboarding_internal_call', '1', true);
  PERFORM public.log_provider_onboarding_event(
    p_provider_id, v_actor_id, v_actor_role, p_action, v_old, p_new_status, p_metadata
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_provider_onboarding_status(uuid, public.provider_onboarding_status, uuid, text, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;

ALTER TABLE public.providers DROP COLUMN IF EXISTS review_notes_internal;

NOTIFY pgrst, 'reload schema';
