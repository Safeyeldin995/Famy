-- Customer and Provider roles must be mutually exclusive; Admin may coexist
-- with either. Two independent code paths could grant a second, conflicting
-- role without ever removing the first:
--   1. handle_new_user() unconditionally grants 'customer' to every new
--      auth.users row (see 20260627001502), and a provider signup
--      (otp.functions.ts verifyOtpFn) additionally upserts 'provider'
--      without removing it.
--   2. useCreateProvider() ("become a provider" onboarding for an existing
--      signed-in customer) inserts 'provider' the same way.
-- Enforcing this once, in a trigger on user_roles, closes both paths (and
-- any future one) instead of patching each call site.
CREATE OR REPLACE FUNCTION public.enforce_role_exclusivity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role = 'customer' THEN
    DELETE FROM public.user_roles WHERE user_id = NEW.user_id AND role = 'provider';
  ELSIF NEW.role = 'provider' THEN
    DELETE FROM public.user_roles WHERE user_id = NEW.user_id AND role = 'customer';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_role_exclusivity() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER enforce_role_exclusivity_trigger
  BEFORE INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_role_exclusivity();

-- One-time cleanup of existing conflicts. Unambiguous case: the user has a
-- completed providers row, so 'provider' is the real, onboarded identity —
-- drop the stray 'customer' grant. Booking/payment/profile history is
-- untouched; only the role assignment changes.
DELETE FROM public.user_roles ur
WHERE ur.role = 'customer'
  AND EXISTS (SELECT 1 FROM public.user_roles p WHERE p.user_id = ur.user_id AND p.role = 'provider')
  AND EXISTS (SELECT 1 FROM public.providers pr WHERE pr.profile_id = ur.user_id);

-- Anything still conflicting after that (both roles present, no providers
-- row to disambiguate) is genuinely ambiguous — surface it to Admin instead
-- of guessing. Expected to be empty in the common case.
CREATE OR REPLACE VIEW public.admin_identity_conflicts AS
SELECT
  p.id AS user_id,
  p.full_name,
  p.phone,
  p.email,
  array_agg(ur.role ORDER BY ur.role) AS roles
FROM public.profiles p
JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role IN ('customer', 'provider')
GROUP BY p.id, p.full_name, p.phone, p.email
HAVING count(DISTINCT ur.role) > 1;

GRANT SELECT ON public.admin_identity_conflicts TO authenticated;
ALTER VIEW public.admin_identity_conflicts SET (security_invoker = true);
