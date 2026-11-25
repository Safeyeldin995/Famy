-- App release gate: minimum / latest app versions and a maintenance switch.
-- Stored in public.settings (no new tables). Readable by anon through the
-- existing settings_public_read policy (the app checks it before sign-in);
-- writes stay admin-only through settings_admin_write.
-- Idempotent: inserts the default only when missing, never overwrites.

INSERT INTO public.settings (key, value)
VALUES (
  'app_release',
  '{"min_version_android":"1.0.0","min_version_ios":"1.0.0","latest_version_android":"1.0.0","latest_version_ios":"1.0.0","maintenance":false,"maintenance_message_ar":"","maintenance_message_en":""}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- Reject malformed values so a typo can never lock every user out.
CREATE OR REPLACE FUNCTION public.tg_validate_app_release_settings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_field text;
  v_val text;
BEGIN
  IF NEW.key IS DISTINCT FROM 'app_release' THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.value) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'APP_RELEASE_INVALID: value must be an object.' USING ERRCODE = '23514';
  END IF;

  FOREACH v_field IN ARRAY ARRAY['min_version_android','min_version_ios','latest_version_android','latest_version_ios']
  LOOP
    v_val := NEW.value->>v_field;
    IF v_val IS NULL OR v_val !~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$' THEN
      RAISE EXCEPTION 'APP_RELEASE_INVALID: % must be a version like 1.2.3.', v_field USING ERRCODE = '23514';
    END IF;
  END LOOP;

  -- Minimum may never exceed latest (component-wise numeric compare), or every
  -- user on the latest release would be forced to update.
  IF string_to_array(NEW.value->>'min_version_android', '.')::int[]
       > string_to_array(NEW.value->>'latest_version_android', '.')::int[]
     OR string_to_array(NEW.value->>'min_version_ios', '.')::int[]
       > string_to_array(NEW.value->>'latest_version_ios', '.')::int[] THEN
    RAISE EXCEPTION 'APP_RELEASE_INVALID: minimum version must not be above the latest version.' USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(NEW.value->'maintenance') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'APP_RELEASE_INVALID: maintenance must be true or false.' USING ERRCODE = '23514';
  END IF;

  IF length(COALESCE(NEW.value->>'maintenance_message_ar', '')) > 300
     OR length(COALESCE(NEW.value->>'maintenance_message_en', '')) > 300 THEN
    RAISE EXCEPTION 'APP_RELEASE_INVALID: maintenance messages must be 300 characters or less.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_validate_app_release_settings() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validate_app_release_settings ON public.settings;
CREATE TRIGGER trg_validate_app_release_settings
  BEFORE INSERT OR UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_app_release_settings();

NOTIFY pgrst, 'reload schema';
