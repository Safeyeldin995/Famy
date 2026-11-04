-- Review only: deploy before the age-picker clients. Existing birth dates are unchanged.
ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS date_of_birth_is_estimated boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.family_members.date_of_birth_is_estimated IS
  'True when the customer supplied an age and date_of_birth is a first-of-month estimate.';

-- Add infant precision without exposing birth dates or changing the existing
-- party/status/privacy checks. The original RPC remains untouched.
CREATE OR REPLACE FUNCTION public.booking_party_profiles_with_member_age(p_booking_ids uuid[])
RETURNS TABLE (
  booking_id uuid, viewer_role text, other_user_id uuid, other_name text,
  other_avatar_url text, other_phone text, area text, zone_name_en text,
  zone_name_ar text, member_first_name text, member_age_years integer,
  member_age_months integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.*, CASE WHEN p.member_age_years IS NOT NULL THEN
    (extract(year FROM age((now() AT TIME ZONE 'Africa/Cairo')::date, fm.date_of_birth)) * 12
      + extract(month FROM age((now() AT TIME ZONE 'Africa/Cairo')::date, fm.date_of_birth)))::integer
    END
  FROM public.booking_party_profiles(p_booking_ids) p
  LEFT JOIN public.booking_family_member_snapshots fm ON fm.booking_id = p.booking_id;
$$;
REVOKE ALL ON FUNCTION public.booking_party_profiles_with_member_age(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_party_profiles_with_member_age(uuid[]) TO authenticated;
