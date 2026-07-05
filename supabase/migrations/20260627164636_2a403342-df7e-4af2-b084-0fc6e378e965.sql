
REVOKE EXECUTE ON FUNCTION public.recompute_trust_score(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_recompute_trust() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_audit_changes() FROM PUBLIC, anon, authenticated;
