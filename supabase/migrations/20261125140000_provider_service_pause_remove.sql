-- Provider pause / remove approved services (PO #provider-services-status).

ALTER TABLE public.provider_services
  DROP CONSTRAINT IF EXISTS provider_services_status_check;

ALTER TABLE public.provider_services
  ADD CONSTRAINT provider_services_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'paused', 'removed'));

CREATE OR REPLACE FUNCTION public.tg_guard_provider_services()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin');
  v_becoming_approved boolean;
  v_category_slug text;
  v_lifecycle boolean := current_setting('app.provider_service_lifecycle', true) = '1';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending' AND NOT v_is_admin THEN
      RAISE EXCEPTION 'New service requests must start pending.' USING ERRCODE = '42501';
    END IF;
    v_becoming_approved := (NEW.status = 'approved');
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT v_is_admin
       AND NOT v_lifecycle THEN
      RAISE EXCEPTION 'Only admin can change service approval status.' USING ERRCODE = '42501';
    END IF;
    v_becoming_approved := (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved');
  END IF;

  IF v_becoming_approved AND EXISTS (
    SELECT 1 FROM public.service_requirements sr
    WHERE sr.service_id = NEW.service_id AND sr.is_active AND sr.required_for_provider_approval
      AND NOT EXISTS (
        SELECT 1 FROM public.provider_requirement_fulfillments prf
        WHERE prf.provider_id = NEW.provider_id AND prf.requirement_id = sr.id AND prf.status IN ('passed','waived')
      )
  ) THEN
    RAISE EXCEPTION 'This provider has not completed all mandatory requirements for this service.' USING ERRCODE = '23514';
  END IF;

  IF v_becoming_approved THEN
    SELECT c.slug INTO v_category_slug
    FROM public.services s
    JOIN public.categories c ON c.id = s.category_id
    WHERE s.id = NEW.service_id;
    IF v_category_slug = 'tutoring'
       AND EXISTS (
         SELECT 1 FROM public.providers p
         WHERE p.id = NEW.provider_id AND p.onboarding_status = 'APPROVED'
       )
       AND NOT EXISTS (
      SELECT 1 FROM public.provider_teaching_capabilities tc
      WHERE tc.provider_id = NEW.provider_id
        AND tc.service_id = NEW.service_id
        AND tc.status IN ('pending', 'approved')
    ) THEN
      RAISE EXCEPTION 'Tutoring service requests require at least one subject and grade before approval.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.provider_set_service_active(
  p_service_id uuid,
  p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_ps public.provider_services;
  v_new_status text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501';
  END IF;
  IF v_provider.onboarding_status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Only approved providers can pause or resume services.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ps
  FROM public.provider_services
  WHERE provider_id = v_provider.id AND service_id = p_service_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider service not found.' USING ERRCODE = '42501';
  END IF;

  IF p_active THEN
    IF v_ps.status <> 'paused' THEN
      RAISE EXCEPTION 'Only paused services can be resumed.' USING ERRCODE = '23514';
    END IF;
    IF v_ps.flagged_for_review THEN
      v_new_status := 'pending';
    ELSE
      v_new_status := 'approved';
    END IF;
  ELSE
    IF v_ps.status <> 'approved' THEN
      RAISE EXCEPTION 'Only active approved services can be paused.' USING ERRCODE = '23514';
    END IF;
    v_new_status := 'paused';
  END IF;

  PERFORM set_config('app.provider_service_lifecycle', '1', true);
  PERFORM set_config('app.audit_reason', CASE WHEN p_active THEN 'provider_resume_service' ELSE 'provider_pause_service' END, true);

  UPDATE public.provider_services
  SET status = v_new_status
  WHERE id = v_ps.id;

  RETURN jsonb_build_object(
    'ok', true,
    'provider_service_id', v_ps.id,
    'status', v_new_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.provider_set_service_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_set_service_active(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.provider_remove_service(p_service_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_ps public.provider_services;
  v_upcoming integer;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501';
  END IF;
  IF v_provider.onboarding_status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Only approved providers can remove services.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ps
  FROM public.provider_services
  WHERE provider_id = v_provider.id AND service_id = p_service_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider service not found.' USING ERRCODE = '42501';
  END IF;

  IF v_ps.status NOT IN ('approved', 'paused', 'rejected') THEN
    RAISE EXCEPTION 'This service cannot be removed in its current status.' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer INTO v_upcoming
  FROM public.bookings b
  WHERE b.provider_id = v_provider.id
    AND b.service_id = p_service_id
    AND b.status IN (
      'pending',
      'confirmed',
      'on_the_way',
      'arrived',
      'arrival_confirmed',
      'in_progress',
      'completion_requested'
    );

  PERFORM set_config('app.provider_service_lifecycle', '1', true);
  PERFORM set_config('app.audit_reason', 'provider_remove_service', true);

  UPDATE public.provider_services
  SET status = 'removed'
  WHERE id = v_ps.id;

  RETURN jsonb_build_object(
    'ok', true,
    'provider_service_id', v_ps.id,
    'upcoming_bookings', v_upcoming
  );
END;
$$;

REVOKE ALL ON FUNCTION public.provider_remove_service(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_remove_service(uuid) TO authenticated;

-- Allow lifecycle RPCs and resubmit to change status without admin role.
CREATE OR REPLACE FUNCTION public.provider_resubmit_rejected_service(p_service_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_ps public.provider_services;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ps
  FROM public.provider_services
  WHERE provider_id = v_provider.id AND service_id = p_service_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider service not found.' USING ERRCODE = '42501';
  END IF;

  IF v_ps.status <> 'rejected' THEN
    RAISE EXCEPTION 'Only rejected services can be resubmitted.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.provider_service_lifecycle', '1', true);

  UPDATE public.provider_services
  SET status = 'pending', rejection_reason = NULL
  WHERE id = v_ps.id;

  UPDATE public.provider_teaching_capabilities
  SET status = 'pending', review_note = NULL, reviewed_at = NULL, reviewed_by = NULL
  WHERE provider_id = v_provider.id
    AND service_id = p_service_id
    AND status = 'rejected';
END;
$$;