-- Account deletion renamed auth.users.email/phone but left the old values in
-- auth.identities.identity_data and auth.users.raw_user_meta_data. GoTrue checks
-- identity emails for uniqueness, so a deleted account kept blocking sign-up
-- with the same phone ("email_exists"), and the deleted user's phone number
-- stayed stored. Scrub both, for future deletions and for existing ones.

CREATE OR REPLACE FUNCTION public.scrub_deleted_auth_identities(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := 'deleted-' || p_user_id::text || '@famio.local';
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_user' USING ERRCODE = '22023';
  END IF;

  -- Only ever touch accounts that have already been deleted.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_user_id AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'account_not_deleted' USING ERRCODE = '42501';
  END IF;

  UPDATE auth.identities
  SET
    identity_data = (COALESCE(identity_data, '{}'::jsonb) - 'phone' - 'email')
      || CASE WHEN provider = 'email' THEN jsonb_build_object('email', v_email) ELSE '{}'::jsonb END,
    updated_at = now()
  WHERE user_id = p_user_id;

  UPDATE auth.users
  SET
    raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) - 'phone',
    updated_at = now()
  WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.scrub_deleted_auth_identities(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scrub_deleted_auth_identities(uuid) TO service_role;

-- Existing deleted accounts.
SELECT public.scrub_deleted_auth_identities(p.id)
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.deleted_at IS NOT NULL;
