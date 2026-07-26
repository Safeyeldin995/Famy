-- Enforce review_notes_internal isolation with explicit column SELECT grants.
-- Table-level SELECT + column REVOKE is not reliable under PostgREST.

REVOKE SELECT ON public.providers FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id,
  profile_id,
  bio_en,
  bio_ar,
  years_experience,
  languages,
  hourly_rate,
  city,
  country,
  is_active,
  is_verified,
  is_top_pro,
  response_time_min,
  created_at,
  updated_at,
  buffer_minutes,
  min_notice_hours,
  max_advance_days,
  vacation_mode,
  deleted_at,
  onboarding_status,
  submitted_at,
  last_review_at,
  review_reason_code,
  review_reason_public,
  resubmitted_at
) ON public.providers TO anon, authenticated;

GRANT SELECT (review_notes_internal) ON public.providers TO service_role;

NOTIFY pgrst, 'reload schema';
