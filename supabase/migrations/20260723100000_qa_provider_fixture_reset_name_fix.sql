-- Broaden QA profile guard: onboarding flow tests may rename profiles to "QA Flow ...".
CREATE OR REPLACE FUNCTION public.qa_reset_registry_provider_to_draft(p_profile_id uuid)
RETURNS public.providers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.providers;
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'Profile id is required.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_profile_id AND p.full_name ILIKE 'QA%'
  ) THEN
    RAISE EXCEPTION 'QA reset is limited to QA profiles.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.providers WHERE profile_id = p_profile_id;
  IF FOUND THEN
    DELETE FROM public.provider_onboarding_events WHERE provider_id = v_row.id;
    DELETE FROM public.provider_documents WHERE provider_id = v_row.id;
    DELETE FROM public.provider_references WHERE provider_id = v_row.id;
    DELETE FROM public.provider_admin_internal_notes WHERE provider_id = v_row.id;
    DELETE FROM public.provider_onboarding_details WHERE provider_id = v_row.id;
    DELETE FROM public.zone_providers WHERE provider_id = v_row.id;
    DELETE FROM public.provider_services WHERE provider_id = v_row.id;
    DELETE FROM public.availability_rules WHERE provider_id = v_row.id;
    DELETE FROM public.provider_requirement_fulfillments WHERE provider_id = v_row.id;

    PERFORM set_config('app.onboarding_status_transition', '1', true);
    PERFORM set_config('app.onboarding_internal_call', '1', true);

    UPDATE public.providers SET
      bio_en = '',
      bio_ar = '',
      years_experience = 0,
      hourly_rate = 1,
      city = 'Cairo',
      country = 'EG',
      languages = ARRAY[]::text[],
      is_active = true,
      is_verified = false,
      vacation_mode = false,
      onboarding_status = 'DRAFT',
      submitted_at = NULL,
      review_reason_public = NULL,
      review_reason_code = NULL
    WHERE id = v_row.id
    RETURNING * INTO v_row;

    INSERT INTO public.provider_onboarding_details (provider_id)
    VALUES (v_row.id)
    ON CONFLICT (provider_id) DO NOTHING;

    UPDATE public.profiles SET
      full_name = 'QA_provider_e2e',
      avatar_url = NULL
    WHERE id = p_profile_id;

    RETURN v_row;
  END IF;

  PERFORM set_config('app.onboarding_status_transition', '1', true);

  INSERT INTO public.providers (
    profile_id, bio_en, bio_ar, years_experience, hourly_rate, city,
    country, languages, is_active, is_verified, onboarding_status
  ) VALUES (
    p_profile_id, '', '', 0, 1, 'Cairo', 'EG', ARRAY[]::text[], true, false, 'DRAFT'
  ) RETURNING * INTO v_row;

  INSERT INTO public.provider_onboarding_details (provider_id)
  VALUES (v_row.id)
  ON CONFLICT (provider_id) DO NOTHING;

  UPDATE public.profiles SET
    full_name = 'QA_provider_e2e',
    avatar_url = NULL
  WHERE id = p_profile_id;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.qa_reset_registry_provider_to_draft(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qa_reset_registry_provider_to_draft(uuid) TO service_role;
