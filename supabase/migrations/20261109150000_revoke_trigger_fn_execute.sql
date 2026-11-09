-- Trigger functions run as triggers only; nobody should call them over /rest/v1/rpc.
-- Revoking EXECUTE does not stop the triggers from firing.
REVOKE EXECUTE ON FUNCTION public.tg_area_requests_rate_limit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_guard_provider_service_insert() FROM PUBLIC, anon, authenticated;
