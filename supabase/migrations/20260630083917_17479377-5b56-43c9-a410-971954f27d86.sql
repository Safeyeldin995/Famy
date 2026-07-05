insert into public.user_roles (user_id, role)
select id, 'admin'::app_role from public.profiles
where phone in ('201126516777','201005522352')
on conflict (user_id, role) do nothing;