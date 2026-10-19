-- Google (OAuth) sign-in: customers who sign in without a phone add a contact
-- phone that is not OTP-verified. The verified owner of a number always wins:
-- a later phone signup for that number takes it over from the unverified holder.
--
-- Also closes a gap: users could previously change profiles.phone directly.
-- Phone changes now only happen through verification flows or this RPC.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.phone_verified IS
  'false when the phone was typed by an OAuth user without OTP verification.';

-- 1) Guard: only admins or the internal phone flows may change phone fields.
CREATE OR REPLACE FUNCTION public.tg_guard_profile_admin_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_suspended IS DISTINCT FROM OLD.is_suspended
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Suspension status can only be changed by an admin.' USING ERRCODE = '42501';
  END IF;

  IF (NEW.phone IS DISTINCT FROM OLD.phone OR NEW.phone_verified IS DISTINCT FROM OLD.phone_verified)
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin')
     AND COALESCE(current_setting('famy.allow_phone_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Phone can only be changed through verification.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- 2) New auth users: a verified phone signup releases the number from any
--    account that only holds it unverified, then creates the profile as before.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.app_role;
BEGIN
  v_role := CASE NEW.raw_user_meta_data ->> 'signup_role'
    WHEN 'provider' THEN 'provider'::public.app_role
    ELSE 'customer'::public.app_role
  END;

  IF NULLIF(NEW.phone, '') IS NOT NULL THEN
    PERFORM set_config('famy.allow_phone_write', 'on', true);
    UPDATE public.profiles
       SET phone = NULL
     WHERE phone = NEW.phone
       AND phone_verified = false
       AND id <> NEW.id;
  END IF;

  INSERT INTO public.profiles (id, phone, email, full_name)
  VALUES (NEW.id, NEW.phone, NEW.email, COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, v_role);
  RETURN NEW;
END;
$$;

-- 3) RPC for OAuth users (no auth phone) to set an unverified contact phone.
CREATE OR REPLACE FUNCTION public.set_my_contact_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_digits text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  -- Accounts created with a verified phone keep it; they never use this path.
  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_uid AND NULLIF(u.phone, '') IS NOT NULL) THEN
    RAISE EXCEPTION 'PHONE_ALREADY_VERIFIED' USING ERRCODE = 'P0001';
  END IF;

  v_digits := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  IF v_digits LIKE '0020%' THEN
    v_digits := substr(v_digits, 3);
  ELSIF v_digits LIKE '01%' THEN
    v_digits := '2' || v_digits;
  END IF;
  IF v_digits !~ '^201[0125][0-9]{8}$' THEN
    RAISE EXCEPTION 'INVALID_PHONE' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE phone = v_digits AND id <> v_uid) THEN
    RAISE EXCEPTION 'PHONE_TAKEN' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('famy.allow_phone_write', 'on', true);
  UPDATE public.profiles
     SET phone = v_digits,
         phone_verified = false
   WHERE id = v_uid;

  RETURN v_digits;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_contact_phone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_contact_phone(text) TO authenticated;
