-- PATCH 4.4: explicit privileges and phone invariant for password setup authorizations.

GRANT ALL ON TABLE public.password_setup_authorizations TO service_role;
REVOKE ALL ON TABLE public.password_setup_authorizations FROM anon, authenticated;

ALTER TABLE public.password_setup_authorizations
  ADD CONSTRAINT password_setup_authorizations_phone_not_blank
  CHECK (length(trim(phone)) > 0);
