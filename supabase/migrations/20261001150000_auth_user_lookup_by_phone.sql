-- Server-only lookup of auth.users by synthetic phone email or E.164 phone.
-- Draft only: do not apply this migration until Product Owner approval.

CREATE OR REPLACE FUNCTION public.auth_user_id_for_phone(p_auth_email text, p_phone text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM auth.users
  WHERE email = p_auth_email
     OR phone = p_phone
     OR phone = ltrim(p_phone, '+')
  ORDER BY (email = p_auth_email) DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.auth_user_id_for_phone(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_id_for_phone(text, text) TO service_role;
