-- Fix column privilege enforcement and provider document UPDATE denial.

GRANT SELECT ON public.providers TO authenticated;
REVOKE SELECT (review_notes_internal) ON public.providers FROM PUBLIC, anon, authenticated;
GRANT SELECT (review_notes_internal) ON public.providers TO service_role;

-- Belt-and-suspenders: providers must not UPDATE documents at all.
DROP POLICY IF EXISTS "docs_self_update" ON public.provider_documents;
