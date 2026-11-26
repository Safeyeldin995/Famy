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
