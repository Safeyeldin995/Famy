-- Security hardening (additive): pin search_path on two trigger functions
-- flagged by the Supabase linter. Bodies use only built-ins, so behavior is unchanged.

ALTER FUNCTION public.tg_normalize_provider_service_preparation_notes() SET search_path = '';
ALTER FUNCTION public.tg_block_provider_ledger_mutation() SET search_path = '';
