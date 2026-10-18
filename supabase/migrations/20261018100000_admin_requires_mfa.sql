-- Admin access requires a second factor (TOTP).
--
-- has_role(auth.uid(), 'admin') now only returns true when the caller's session
-- is at assurance level aal2 (signed in + verified authenticator code). Every
-- admin RLS policy and admin_* RPC goes through has_role, so a stolen password
-- or session token alone can no longer reach admin data or actions.
--
-- Unchanged on purpose:
-- - Non-admin roles (customer/provider) are not affected.
-- - Checks about *another* user (_user_id <> auth.uid()) keep their old meaning.
-- - Service-role / server contexts (auth.uid() is null) are not affected.
--
-- Enrolment itself runs through Supabase Auth at aal1 (it does not use
-- has_role), so admins enrol from the /admin screen after this is applied.
-- Recovery if an admin loses their authenticator: delete their row from
-- auth.mfa_factors (Supabase dashboard > Authentication > Users > the user).

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
    AND (
      _role <> 'admin'::app_role
      OR _user_id IS DISTINCT FROM auth.uid()
      -- Read the claim the way auth.jwt() does (per-claim setting, then the JSON
      -- claims), so this also works where auth.jwt() is unavailable.
      OR coalesce(
        nullif(current_setting('request.jwt.claim.aal', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal',
        ''
      ) = 'aal2'
    );
$function$;

-- Admin-only helpers that anonymous visitors never need.
REVOKE EXECUTE ON FUNCTION public.check_zone_overlap(jsonb, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.provider_required_documents_approved(uuid) FROM anon, public;
