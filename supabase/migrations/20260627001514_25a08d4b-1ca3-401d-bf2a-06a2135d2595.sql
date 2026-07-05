
-- Move btree_gist out of public
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION btree_gist SET SCHEMA extensions;

-- Lock down SECURITY DEFINER functions
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_booking_status_audit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_refresh_ratings_summary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;

-- has_role must remain callable inside RLS policies (definer + stable). Keep execute for authenticated/anon
-- but it's already SECURITY DEFINER which is intentional. Limit to authenticated only.
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
