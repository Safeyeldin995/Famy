-- Atomic weekly availability replace. Additive only; not applied by this issue.
-- SECURITY INVOKER so existing RLS (avail_self_manage / avail_admin_all) still applies.
-- Delete + insert run in the function's single transaction: any error leaves prior rows unchanged.

CREATE OR REPLACE FUNCTION public.replace_provider_availability(
  p_provider_id uuid,
  p_rules jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
  v_i integer;
  v_j integer;
  v_rule jsonb;
  v_weekday integer;
  v_start_text text;
  v_end_text text;
  v_start_time time;
  v_end_time time;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  IF p_provider_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.providers p
       WHERE p.id = p_provider_id
         AND (p.profile_id = v_uid OR public.has_role(v_uid, 'admin'))
     )
  THEN
    RAISE EXCEPTION 'Access denied.' USING ERRCODE = '42501';
  END IF;

  IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'array' THEN
    RAISE EXCEPTION 'Availability rules must be a JSON array.' USING ERRCODE = '23514';
  END IF;

  v_count := jsonb_array_length(p_rules);
  IF v_count > 28 THEN
    RAISE EXCEPTION 'Too many availability rules.' USING ERRCODE = '23514';
  END IF;

  IF v_count > 0 THEN
    FOR v_i IN 0 .. v_count - 1 LOOP
      v_rule := p_rules -> v_i;
      IF v_rule IS NULL OR jsonb_typeof(v_rule) <> 'object' THEN
        RAISE EXCEPTION 'Each availability rule must be an object.' USING ERRCODE = '23514';
      END IF;

      BEGIN
        v_weekday := (v_rule->>'weekday')::integer;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid weekday.' USING ERRCODE = '23514';
      END;
      IF v_weekday IS NULL OR v_weekday < 0 OR v_weekday > 6 THEN
        RAISE EXCEPTION 'Invalid weekday.' USING ERRCODE = '23514';
      END IF;

      v_start_text := v_rule->>'start_time';
      v_end_text := v_rule->>'end_time';
      IF v_start_text IS NULL
         OR v_end_text IS NULL
         OR v_start_text !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$'
         OR v_end_text !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$'
      THEN
        RAISE EXCEPTION 'Invalid time format.' USING ERRCODE = '23514';
      END IF;

      BEGIN
        v_start_time := v_start_text::time;
        v_end_time := v_end_text::time;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid time format.' USING ERRCODE = '23514';
      END;

      IF NOT (v_start_time < v_end_time) THEN
        RAISE EXCEPTION 'start_time must be before end_time.' USING ERRCODE = '23514';
      END IF;
    END LOOP;

    FOR v_i IN 0 .. v_count - 1 LOOP
      FOR v_j IN v_i + 1 .. v_count - 1 LOOP
        IF (p_rules->v_i->>'weekday')::integer = (p_rules->v_j->>'weekday')::integer
           AND (p_rules->v_i->>'start_time')::time < (p_rules->v_j->>'end_time')::time
           AND (p_rules->v_j->>'start_time')::time < (p_rules->v_i->>'end_time')::time
        THEN
          RAISE EXCEPTION 'Overlapping availability on the same weekday.' USING ERRCODE = '23514';
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  PERFORM 1 FROM public.providers WHERE id = p_provider_id FOR UPDATE;

  DELETE FROM public.availability_rules WHERE provider_id = p_provider_id;

  INSERT INTO public.availability_rules (provider_id, weekday, start_time, end_time, timezone)
  SELECT
    p_provider_id,
    (r->>'weekday')::smallint,
    (r->>'start_time')::time,
    (r->>'end_time')::time,
    'Africa/Cairo'
  FROM jsonb_array_elements(p_rules) AS r;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_provider_availability(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_provider_availability(uuid, jsonb) TO authenticated;
