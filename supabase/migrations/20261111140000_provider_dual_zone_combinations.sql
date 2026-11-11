-- #322: providers may serve at most two zones, and only when admin has marked
-- that pair combinable (for example Sheikh Zayed + 6th of October).
-- Additive only. Existing single-zone coverage is unchanged.
--
-- Marketplace search/eligibility already joins zone_providers, so a second
-- coverage row is enough for discovery. marketplace_eligibility_internal is
-- not replaced.
--
-- Post-approval second zone: apply directly and write an audit event.
-- Adding a neighbouring zone is additive and low-risk (customers in the
-- original zone keep the same provider; pricing/travel are unchanged).
-- That is unlike provider_request_service / provider_request_price_change,
-- which alter what the customer is sold. Admin combination edits still
-- cannot drop a pair while any provider serves both zones.

-- ============================================================
-- 1) Combinable zone pairs (store each pair once, zone_a < zone_b)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.zone_combinations (
  zone_a uuid NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  zone_b uuid NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (zone_a, zone_b),
  CHECK (zone_a < zone_b)
);

CREATE INDEX IF NOT EXISTS idx_zone_combinations_zone_a ON public.zone_combinations(zone_a);
CREATE INDEX IF NOT EXISTS idx_zone_combinations_zone_b ON public.zone_combinations(zone_b);

GRANT SELECT ON public.zone_combinations TO anon, authenticated;
GRANT ALL ON public.zone_combinations TO service_role;

ALTER TABLE public.zone_combinations ENABLE ROW LEVEL SECURITY;

CREATE POLICY zone_combinations_public_read ON public.zone_combinations
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY zone_combinations_admin_all ON public.zone_combinations
  FOR ALL TO authenticated
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));

-- Backfill: any pair a provider already serves together becomes combinable,
-- so existing two-zone coverage (e.g. Sheikh Zayed + 6th of October) stays
-- valid under the new rules. Additive insert only.
INSERT INTO public.zone_combinations (zone_a, zone_b)
SELECT DISTINCT LEAST(a.zone_id, b.zone_id), GREATEST(a.zone_id, b.zone_id)
FROM public.zone_providers a
JOIN public.zone_providers b
  ON b.provider_id = a.provider_id AND b.zone_id <> a.zone_id
ON CONFLICT (zone_a, zone_b) DO NOTHING;

-- ============================================================
-- 2) Helpers
-- ============================================================
CREATE OR REPLACE FUNCTION public.zones_can_combine(p_zone_a uuid, p_zone_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_zone_a IS NOT NULL
     AND p_zone_b IS NOT NULL
     AND p_zone_a IS DISTINCT FROM p_zone_b
     AND EXISTS (
       SELECT 1
       FROM public.zone_combinations zc
       WHERE zc.zone_a = LEAST(p_zone_a, p_zone_b)
         AND zc.zone_b = GREATEST(p_zone_a, p_zone_b)
     );
$$;

REVOKE ALL ON FUNCTION public.zones_can_combine(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.zones_can_combine(uuid, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.replace_provider_zone_coverage(
  p_provider_id uuid,
  p_zone_ids uuid[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_id uuid;
BEGIN
  IF p_provider_id IS NULL THEN
    RAISE EXCEPTION 'Provider is required.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.providers p WHERE p.id = p_provider_id) THEN
    RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501';
  END IF;

  v_ids := ARRAY(
    SELECT DISTINCT z
    FROM unnest(COALESCE(p_zone_ids, ARRAY[]::uuid[])) AS z
    WHERE z IS NOT NULL
  );

  IF cardinality(v_ids) > 2 THEN
    RAISE EXCEPTION 'A provider can serve at most two zones.' USING ERRCODE = '23514';
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    IF NOT EXISTS (SELECT 1 FROM public.zones z WHERE z.id = v_id AND z.is_active) THEN
      RAISE EXCEPTION 'Invalid or inactive zone.' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF cardinality(v_ids) = 2 AND NOT public.zones_can_combine(v_ids[1], v_ids[2]) THEN
    RAISE EXCEPTION 'These zones cannot be combined.' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('zone_providers:' || p_provider_id::text));

  DELETE FROM public.zone_providers WHERE provider_id = p_provider_id;
  FOREACH v_id IN ARRAY v_ids LOOP
    INSERT INTO public.zone_providers (provider_id, zone_id) VALUES (p_provider_id, v_id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_provider_zone_coverage(uuid, uuid[])
  FROM PUBLIC, anon, authenticated;

-- Integrity trigger: admin table writes follow the same max-2 / combinable rules.
-- UPDATE is included so changing zone_id cannot skip the pair check.
CREATE OR REPLACE FUNCTION public.tg_validate_zone_providers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid[];
  v_count int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('zone_providers:' || NEW.provider_id::text));

  IF NOT EXISTS (SELECT 1 FROM public.zones z WHERE z.id = NEW.zone_id AND z.is_active) THEN
    RAISE EXCEPTION 'Invalid or inactive zone.' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(array_agg(zp.zone_id), ARRAY[]::uuid[])
  INTO v_existing
  FROM public.zone_providers zp
  WHERE zp.provider_id = NEW.provider_id
    AND zp.zone_id IS DISTINCT FROM NEW.zone_id
    AND (TG_OP = 'INSERT' OR zp.id IS DISTINCT FROM NEW.id);

  v_count := COALESCE(cardinality(v_existing), 0) + 1;
  IF v_count > 2 THEN
    RAISE EXCEPTION 'A provider can serve at most two zones.' USING ERRCODE = '23514';
  END IF;

  IF v_count = 2 AND NOT public.zones_can_combine(v_existing[1], NEW.zone_id) THEN
    RAISE EXCEPTION 'These zones cannot be combined.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_validate_zone_providers() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validate_zone_providers ON public.zone_providers;
CREATE TRIGGER trg_validate_zone_providers
  BEFORE INSERT OR UPDATE ON public.zone_providers
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_zone_providers();

CREATE OR REPLACE FUNCTION public.tg_zone_combinations_block_in_use()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_in_use int;
BEGIN
  -- CASCADE from deleting a zone: the parent row is already gone, and
  -- zone_providers for that zone cascade as well. Do not block that path.
  IF NOT EXISTS (SELECT 1 FROM public.zones z WHERE z.id = OLD.zone_a)
     OR NOT EXISTS (SELECT 1 FROM public.zones z WHERE z.id = OLD.zone_b) THEN
    RETURN OLD;
  END IF;

  SELECT count(*)::int
  INTO v_in_use
  FROM public.zone_providers a
  JOIN public.zone_providers b
    ON b.provider_id = a.provider_id AND b.zone_id = OLD.zone_b
  WHERE a.zone_id = OLD.zone_a;

  IF v_in_use > 0 THEN
    RAISE EXCEPTION
      'Cannot remove this zone combination while % provider(s) still serve both zones.',
      v_in_use
      USING ERRCODE = '23514';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_zone_combinations_block_in_use() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_zone_combinations_block_in_use ON public.zone_combinations;
CREATE TRIGGER trg_zone_combinations_block_in_use
  BEFORE DELETE ON public.zone_combinations
  FOR EACH ROW EXECUTE FUNCTION public.tg_zone_combinations_block_in_use();

-- ============================================================
-- 3) Admin RPC — set the partner list for one zone
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_sync_zone_combinations(
  p_zone_id uuid,
  p_partner_zone_ids uuid[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_partner uuid;
  v_a uuid;
  v_b uuid;
  v_in_use int;
  v_partners uuid[];
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  IF p_zone_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.zones z WHERE z.id = p_zone_id) THEN
    RAISE EXCEPTION 'Zone not found.' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('zone_combinations:' || p_zone_id::text));

  v_partners := ARRAY(
    SELECT DISTINCT x
    FROM unnest(COALESCE(p_partner_zone_ids, ARRAY[]::uuid[])) AS x
    WHERE x IS NOT NULL AND x IS DISTINCT FROM p_zone_id
  );

  FOREACH v_partner IN ARRAY v_partners LOOP
    IF NOT EXISTS (SELECT 1 FROM public.zones z WHERE z.id = v_partner) THEN
      RAISE EXCEPTION 'Zone not found.' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  FOR v_a, v_b IN
    SELECT zc.zone_a, zc.zone_b
    FROM public.zone_combinations zc
    WHERE zc.zone_a = p_zone_id OR zc.zone_b = p_zone_id
  LOOP
    v_partner := CASE WHEN v_a = p_zone_id THEN v_b ELSE v_a END;
    IF v_partner = ANY (v_partners) THEN
      CONTINUE;
    END IF;

    SELECT count(*)::int
    INTO v_in_use
    FROM public.zone_providers a
    JOIN public.zone_providers b
      ON b.provider_id = a.provider_id AND b.zone_id = v_b
    WHERE a.zone_id = v_a;

    IF v_in_use > 0 THEN
      RAISE EXCEPTION
        'Cannot remove this zone combination while % provider(s) still serve both zones.',
        v_in_use
        USING ERRCODE = '23514';
    END IF;

    DELETE FROM public.zone_combinations WHERE zone_a = v_a AND zone_b = v_b;
  END LOOP;

  FOREACH v_partner IN ARRAY v_partners LOOP
    INSERT INTO public.zone_combinations (zone_a, zone_b, created_by)
    VALUES (LEAST(p_zone_id, v_partner), GREATEST(p_zone_id, v_partner), v_uid)
    ON CONFLICT (zone_a, zone_b) DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_sync_zone_combinations(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_sync_zone_combinations(uuid, uuid[]) TO authenticated;

-- ============================================================
-- 4) Approved-provider coverage update (direct + audit)
-- ============================================================
CREATE OR REPLACE FUNCTION public.provider_update_service_zones(
  p_primary_zone_id uuid,
  p_secondary_zone_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_ids uuid[];
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'provider') IS NOT TRUE THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501';
  END IF;
  IF v_provider.onboarding_status::text <> 'APPROVED' THEN
    RAISE EXCEPTION 'Service zone updates are only for approved providers.' USING ERRCODE = '42501';
  END IF;

  IF p_primary_zone_id IS NULL THEN
    RAISE EXCEPTION 'A primary zone is required.' USING ERRCODE = '23514';
  END IF;
  IF p_secondary_zone_id IS NOT NULL AND p_secondary_zone_id = p_primary_zone_id THEN
    RAISE EXCEPTION 'The second zone must be different from the primary zone.' USING ERRCODE = '23514';
  END IF;

  IF p_secondary_zone_id IS NULL THEN
    v_ids := ARRAY[p_primary_zone_id];
  ELSE
    v_ids := ARRAY[p_primary_zone_id, p_secondary_zone_id];
  END IF;

  PERFORM public.replace_provider_zone_coverage(v_provider.id, v_ids);

  PERFORM set_config('app.onboarding_internal_call', '1', true);
  PERFORM public.log_provider_onboarding_event(
    v_provider.id, v_uid, 'provider', 'service_zones_updated',
    v_provider.onboarding_status, v_provider.onboarding_status,
    jsonb_build_object(
      'primary_zone_id', p_primary_zone_id,
      'secondary_zone_id', p_secondary_zone_id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.provider_update_service_zones(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_update_service_zones(uuid, uuid) TO authenticated;

-- ============================================================
-- 5) Onboarding coverage save uses the shared helper
--    Body from 20261007100000_provider_apply_minimal_submit.sql; only the
--    coverage block now calls replace_provider_zone_coverage.
-- ============================================================
CREATE OR REPLACE FUNCTION public.provider_save_onboarding_section(
  p_section text,
  p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_service_id uuid;
  v_zone_id uuid;
  v_ref jsonb;
  v_i int := 0;
  v_norm_phones text[] := ARRAY[]::text[];
  v_norm_phone text;
  v_cap jsonb;
  v_code text;
  v_codes text[] := ARRAY[]::text[];
  v_years int;
  v_note text;
  v_max int;
  v_existing public.provider_age_group_capabilities;
  v_babysitting boolean;
  v_deferred boolean;
  v_previous_marker text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501'; END IF;
  v_deferred := v_provider.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW')
    AND p_section IN ('personal', 'experience', 'references');
  IF NOT public.provider_onboarding_editable(v_provider.onboarding_status) AND NOT v_deferred THEN
    RAISE EXCEPTION 'Application is not editable in the current status.' USING ERRCODE = '42501';
  END IF;

  v_previous_marker := current_setting('app.provider_deferred_save', true);
  IF v_deferred THEN PERFORM set_config('app.provider_deferred_save', '1', true); END IF;

  INSERT INTO public.provider_onboarding_details (provider_id) VALUES (v_provider.id)
  ON CONFLICT (provider_id) DO NOTHING;

  IF p_section = 'personal' THEN
    UPDATE public.profiles SET full_name = COALESCE(p_payload->>'legal_name', full_name)
    WHERE id = v_uid AND public.provider_onboarding_editable(v_provider.onboarding_status);
    UPDATE public.provider_onboarding_details SET
      date_of_birth = CASE WHEN p_payload ? 'date_of_birth' THEN (p_payload->>'date_of_birth')::date ELSE date_of_birth END,
      gender = CASE WHEN p_payload ? 'gender' THEN NULLIF(btrim(p_payload->>'gender'), '') ELSE gender END,
      governorate = CASE WHEN p_payload ? 'governorate' THEN NULLIF(btrim(p_payload->>'governorate'), '') ELSE governorate END,
      area = CASE WHEN p_payload ? 'area' THEN NULLIF(btrim(p_payload->>'area'), '') ELSE area END,
      full_address = CASE WHEN p_payload ? 'full_address' THEN NULLIF(btrim(p_payload->>'full_address'), '') ELSE full_address END,
      updated_at = now()
    WHERE provider_id = v_provider.id;
    UPDATE public.providers SET city = COALESCE(NULLIF(btrim(p_payload->>'area'), ''), city) WHERE id = v_provider.id;
  ELSIF p_section = 'experience' THEN
    UPDATE public.providers SET
      years_experience = COALESCE((p_payload->>'years_experience')::int, years_experience),
      bio_en = COALESCE(p_payload->>'bio_en', bio_en),
      bio_ar = COALESCE(p_payload->>'bio_ar', bio_ar),
      languages = COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'languages')), languages)
    WHERE id = v_provider.id;
    UPDATE public.provider_onboarding_details SET
      previous_work = NULLIF(btrim(p_payload->>'previous_work'), ''),
      newborn_experience = COALESCE((p_payload->>'newborn_experience')::boolean, newborn_experience),
      first_aid_training = COALESCE((p_payload->>'first_aid_training')::boolean, first_aid_training),
      updated_at = now()
    WHERE provider_id = v_provider.id;

    SELECT EXISTS (
      SELECT 1 FROM public.provider_services ps
      JOIN public.services s ON s.id = ps.service_id
      JOIN public.categories c ON c.id = s.category_id
      WHERE ps.provider_id = v_provider.id AND c.slug = 'babysitting'
    ) INTO v_babysitting;

    IF p_payload ? 'max_children_per_booking' THEN
      IF p_payload->'max_children_per_booking' IS NULL
         OR jsonb_typeof(p_payload->'max_children_per_booking') = 'null'
         OR NULLIF(btrim(p_payload->>'max_children_per_booking'), '') IS NULL THEN
        v_max := NULL;
      ELSE
        BEGIN
          v_max := (p_payload->>'max_children_per_booking')::int;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'max_children_per_booking must be an integer between 1 and 20.' USING ERRCODE = '23514';
        END;
        IF v_max < 1 OR v_max > 20 THEN
          RAISE EXCEPTION 'max_children_per_booking must be an integer between 1 and 20.' USING ERRCODE = '23514';
        END IF;
      END IF;
      IF v_max IS NULL AND v_babysitting THEN
        RAISE EXCEPTION 'max_children_per_booking must be an integer between 1 and 20.' USING ERRCODE = '23514';
      END IF;
      PERFORM set_config('app.max_children_declaration', '1', true);
      UPDATE public.providers SET max_children_per_booking = v_max WHERE id = v_provider.id;
    END IF;

    IF p_payload ? 'age_group_capabilities' THEN
      IF jsonb_typeof(p_payload->'age_group_capabilities') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'age_group_capabilities must be an array.' USING ERRCODE = '23514';
      END IF;

      PERFORM pg_advisory_xact_lock(hashtext('age-cap:' || v_provider.id::text));
      PERFORM 1 FROM public.provider_age_group_capabilities
        WHERE provider_id = v_provider.id FOR UPDATE;

      FOR v_cap IN SELECT jsonb_array_elements(p_payload->'age_group_capabilities') LOOP
        IF jsonb_typeof(v_cap) IS DISTINCT FROM 'object' THEN
          RAISE EXCEPTION 'Each age group capability must be an object.' USING ERRCODE = '23514';
        END IF;
        v_code := NULLIF(btrim(v_cap->>'code'), '');
        IF v_code IS NULL THEN
          RAISE EXCEPTION 'Age group code is required.' USING ERRCODE = '23514';
        END IF;
        IF v_code = ANY (v_codes) THEN
          RAISE EXCEPTION 'Duplicate age group capability: %', v_code USING ERRCODE = '23514';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.child_age_groups g WHERE g.code = v_code AND g.is_active) THEN
          RAISE EXCEPTION 'Unknown or inactive age group: %', v_code USING ERRCODE = '23514';
        END IF;
        IF v_cap ? 'years_experience'
           AND v_cap->'years_experience' IS NOT NULL
           AND jsonb_typeof(v_cap->'years_experience') <> 'null'
           AND NULLIF(btrim(v_cap->>'years_experience'), '') IS NOT NULL THEN
          BEGIN
            v_years := (v_cap->>'years_experience')::int;
          EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'years_experience must be an integer between 0 and 60.' USING ERRCODE = '23514';
          END;
          IF v_years < 0 OR v_years > 60 THEN
            RAISE EXCEPTION 'years_experience must be an integer between 0 and 60.' USING ERRCODE = '23514';
          END IF;
        ELSE
          v_years := NULL;
        END IF;
        v_note := NULLIF(btrim(v_cap->>'note'), '');
        IF v_note IS NOT NULL AND length(v_note) > 300 THEN
          RAISE EXCEPTION 'Capability note must be 300 characters or fewer.' USING ERRCODE = '23514';
        END IF;
        v_codes := array_append(v_codes, v_code);

        SELECT * INTO v_existing
        FROM public.provider_age_group_capabilities
        WHERE provider_id = v_provider.id AND age_group_code = v_code;

        IF NOT FOUND THEN
          INSERT INTO public.provider_age_group_capabilities (
            provider_id, age_group_code, years_experience, note
          ) VALUES (v_provider.id, v_code, v_years, v_note);
        ELSIF v_existing.verified_at IS NOT NULL OR v_existing.verified_by IS NOT NULL THEN
          NULL;
        ELSE
          UPDATE public.provider_age_group_capabilities SET
            years_experience = v_years,
            note = v_note
          WHERE id = v_existing.id;
        END IF;
      END LOOP;

      DELETE FROM public.provider_age_group_capabilities
      WHERE provider_id = v_provider.id
        AND verified_at IS NULL
        AND verified_by IS NULL
        AND (cardinality(v_codes) = 0 OR age_group_code <> ALL (v_codes));

      UPDATE public.provider_onboarding_details SET
        child_age_groups = COALESCE((
          SELECT array_agg(c.age_group_code ORDER BY g.sort_order)
          FROM public.provider_age_group_capabilities c
          JOIN public.child_age_groups g ON g.code = c.age_group_code
          WHERE c.provider_id = v_provider.id
        ), ARRAY[]::text[]),
        updated_at = now()
      WHERE provider_id = v_provider.id;
    ELSIF p_payload ? 'child_age_groups' THEN
      UPDATE public.provider_onboarding_details SET
        child_age_groups = COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'child_age_groups')), child_age_groups),
        updated_at = now()
      WHERE provider_id = v_provider.id;
    END IF;
  ELSIF p_section = 'services' THEN
    FOR v_service_id IN SELECT (value)::uuid FROM jsonb_array_elements_text(COALESCE(p_payload->'service_ids', '[]'::jsonb)) LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.services s JOIN public.categories c ON c.id = s.category_id
        WHERE s.id = v_service_id AND s.is_active AND c.is_active AND public.is_phase1_category_slug(c.slug)
      ) THEN
        RAISE EXCEPTION 'Invalid or inactive service selection.' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.provider_services (provider_id, service_id, status)
      VALUES (v_provider.id, v_service_id, 'pending') ON CONFLICT (provider_id, service_id) DO NOTHING;
    END LOOP;
  ELSIF p_section = 'coverage' THEN
    PERFORM public.replace_provider_zone_coverage(
      v_provider.id,
      ARRAY(
        SELECT (value)::uuid
        FROM jsonb_array_elements_text(COALESCE(p_payload->'zone_ids', '[]'::jsonb))
      )
    );
  ELSIF p_section = 'references' THEN
    DELETE FROM public.provider_references WHERE provider_id = v_provider.id;
    FOR v_ref IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'references', '[]'::jsonb)) LOOP
      IF btrim(COALESCE(v_ref->>'full_name', '')) = ''
         AND btrim(COALESCE(v_ref->>'relationship', '')) = ''
         AND btrim(COALESCE(v_ref->>'phone', '')) = ''
         AND btrim(COALESCE(v_ref->>'notes', '')) = '' THEN
        CONTINUE;
      END IF;
      v_norm_phone := public.normalize_reference_phone(v_ref->>'phone');
      IF v_norm_phone IS NULL OR btrim(v_norm_phone) = '' THEN
        RAISE EXCEPTION 'Reference phone is required.' USING ERRCODE = '23514';
      END IF;
      IF v_norm_phone = ANY(v_norm_phones) THEN
        RAISE EXCEPTION 'Reference phone numbers must be distinct.' USING ERRCODE = '23514';
      END IF;
      v_norm_phones := array_append(v_norm_phones, v_norm_phone);
      v_i := v_i + 1;
      INSERT INTO public.provider_references (provider_id, full_name, relationship, phone, notes, sort_order)
      VALUES (
        v_provider.id, btrim(v_ref->>'full_name'), btrim(v_ref->>'relationship'),
        v_norm_phone, NULLIF(btrim(v_ref->>'notes'), ''), v_i
      );
    END LOOP;
    IF v_i < 1 THEN
      RAISE EXCEPTION 'At least one reference is required.' USING ERRCODE = '23514';
    END IF;
  ELSIF p_section = 'review' THEN
    UPDATE public.provider_onboarding_details SET
      accuracy_confirmed_at = CASE WHEN COALESCE((p_payload->>'confirmed')::boolean, false) THEN now() ELSE NULL END,
      updated_at = now()
    WHERE provider_id = v_provider.id;
  ELSE
    RAISE EXCEPTION 'Unknown onboarding section.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.provider_deferred_save', COALESCE(v_previous_marker, ''), true);
  PERFORM set_config('app.onboarding_internal_call', '1', true);
  PERFORM public.log_provider_onboarding_event(
    v_provider.id, v_uid, 'provider', 'section_updated', v_provider.onboarding_status, v_provider.onboarding_status,
    jsonb_build_object('section', p_section)
  );

  RETURN public.provider_onboarding_completion(v_provider.id);
END;
$$;

REVOKE ALL ON FUNCTION public.provider_save_onboarding_section(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_save_onboarding_section(text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
