-- Allow authenticated users to insert ONLY a 'provider' role row for themselves.
GRANT INSERT ON public.user_roles TO authenticated;

CREATE POLICY "roles_self_insert_provider"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id AND role = 'provider'::app_role);