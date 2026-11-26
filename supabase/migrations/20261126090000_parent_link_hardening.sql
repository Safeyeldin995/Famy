-- Follow-ups to #419 (student parent links), found in review.
--
-- 1. parent_guardian_email_sends is only touched by SECURITY DEFINER functions
--    (the email rate limit). Turn RLS on with no policies so the table is not
--    readable or writable through the API by anon or signed-in users.
-- 2. student_has_linked_parent(uuid) is not called by the app or by other
--    functions; nobody but the server needs to run it.

ALTER TABLE public.parent_guardian_email_sends ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.student_has_linked_parent(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_has_linked_parent(uuid) TO service_role;

-- 3. Auto-linking a parent by phone must only trust phones proven by OTP.
--    Contact phones typed after Google/Apple/email sign-up are unverified
--    (phone_verified = false), so someone could claim a parent's number and be
--    linked to their child. Same body as 20261125130000 plus that condition.
CREATE OR REPLACE FUNCTION public._student_parent_link_resolve_parent(p_digits text, p_student_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_id uuid;
  v_parent_age integer;
BEGIN
  SELECT pr.id INTO v_parent_id
  FROM public.profiles pr
  WHERE public.famy_profile_phone_digits(pr.phone) = p_digits
    AND pr.phone_verified
    AND pr.deleted_at IS NULL
  LIMIT 1;
  IF v_parent_id IS NULL OR v_parent_id = p_student_id THEN
    RETURN NULL;
  END IF;
  IF public.is_admin_account(v_parent_id) OR NOT public.has_role(v_parent_id, 'customer') THEN
    RETURN NULL;
  END IF;
  v_parent_age := public.booking_online_age_years(v_parent_id, NULL);
  IF v_parent_age IS NULL OR v_parent_age < 18 THEN
    RETURN NULL;
  END IF;
  RETURN v_parent_id;
END;
$$;
REVOKE ALL ON FUNCTION public._student_parent_link_resolve_parent(text, uuid) FROM PUBLIC, anon, authenticated;
