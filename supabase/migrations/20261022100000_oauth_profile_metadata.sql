-- OAuth identity metadata: Google/Apple often send name and picture, not full_name.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.app_role;
  v_full_name text;
  v_avatar_url text;
BEGIN
  v_role := CASE NEW.raw_user_meta_data ->> 'signup_role'
    WHEN 'provider' THEN 'provider'::public.app_role
    ELSE 'customer'::public.app_role
  END;

  v_full_name := COALESCE(
    NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    NULLIF(btrim(NEW.raw_user_meta_data ->> 'name'), ''),
    ''
  );
  v_avatar_url := COALESCE(
    NULLIF(btrim(NEW.raw_user_meta_data ->> 'avatar_url'), ''),
    NULLIF(btrim(NEW.raw_user_meta_data ->> 'picture'), '')
  );

  IF NULLIF(NEW.phone, '') IS NOT NULL THEN
    PERFORM set_config('famy.allow_phone_write', 'on', true);
    UPDATE public.profiles
       SET phone = NULL
     WHERE phone = NEW.phone
       AND phone_verified = false
       AND id <> NEW.id;
  END IF;

  INSERT INTO public.profiles (id, phone, email, full_name, avatar_url)
  VALUES (NEW.id, NEW.phone, NEW.email, v_full_name, v_avatar_url);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, v_role);
  RETURN NEW;
END;
$$;
