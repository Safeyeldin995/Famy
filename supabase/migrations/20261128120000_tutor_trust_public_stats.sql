-- Tutor card and profile trust (PO 28 Nov): public, read-only facts for the
-- provider card and profile, computed from real records only.
--
-- 1. public_provider_trust_stats(ids): per publicly visible provider
--    - completed_bookings / completed_lessons (tutoring) on Famy
--    - never_cancels: true only with >= 10 completed bookings AND no strike
--      (a provider cancellation after accepting, a provider no-show, an online
--      provider/both absence, or a counted paid cancellation). NULL when there
--      is not enough history, so clients hide the badge.
--    - offers_online / offers_in_person from offering_mode
--    No cancellation counts, customer data or money leave this function.
-- 2. public_provider_reviews(provider, limit, offset): visible reviews with the
--    lesson's grade/system/subject snapshot from the booking, plus the total.
--    Reviewer identity is never returned. SECURITY DEFINER so guests can read
--    reviews without the `reviews` RLS policy (see #565).

CREATE OR REPLACE FUNCTION public.public_provider_trust_stats(p_provider_ids uuid[])
RETURNS TABLE (
  provider_id uuid,
  is_verified boolean,
  completed_bookings integer,
  completed_lessons integer,
  never_cancels boolean,
  offers_online boolean,
  offers_in_person boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ids AS (
    SELECT DISTINCT unnest(p_provider_ids[1:100]) AS id
  ),
  visible AS (
    SELECT p.*
    FROM public.providers p
    JOIN ids ON ids.id = p.id
    WHERE p.deleted_at IS NULL
      AND p.is_active
      AND p.onboarding_status = 'APPROVED'
  ),
  done AS (
    SELECT
      b.provider_id,
      count(*)::integer AS completed_bookings,
      count(*) FILTER (WHERE c.slug = 'tutoring')::integer AS completed_lessons
    FROM public.bookings b
    JOIN visible v ON v.id = b.provider_id
    LEFT JOIN public.services s ON s.id = b.service_id
    LEFT JOIN public.categories c ON c.id = s.category_id
    WHERE b.status = 'completed'
    GROUP BY b.provider_id
  ),
  strikes AS (
    SELECT b.provider_id, count(*)::integer AS strikes
    FROM public.bookings b
    JOIN visible v ON v.id = b.provider_id
    WHERE b.no_show_party = 'provider'
       OR b.online_session_outcome IN ('provider_absent', 'both_absent')
       OR (
         b.status = 'cancelled'
         AND b.cancelled_by = v.profile_id
         -- Declining a request before accepting it is not a cancellation; any
         -- provider cancellation not proven to come straight from 'pending'
         -- counts as a strike (fails safe: the badge hides).
         AND NOT EXISTS (
           SELECT 1
           FROM public.booking_status_history h
           WHERE h.booking_id = b.id
             AND h.to_status = 'cancelled'
             AND h.from_status = 'pending'
         )
       )
    GROUP BY b.provider_id
  )
  SELECT
    v.id,
    COALESCE(v.is_verified, false),
    COALESCE(d.completed_bookings, 0),
    COALESCE(d.completed_lessons, 0),
    CASE
      WHEN COALESCE(d.completed_bookings, 0) < 10 THEN NULL
      ELSE COALESCE(st.strikes, 0) = 0 AND COALESCE(v.paid_booking_cancellations, 0) = 0
    END,
    COALESCE(v.offering_mode, 'in_person') IN ('online', 'both'),
    COALESCE(v.offering_mode, 'in_person') IN ('in_person', 'both')
  FROM visible v
  LEFT JOIN done d ON d.provider_id = v.id
  LEFT JOIN strikes st ON st.provider_id = v.id;
$$;

REVOKE ALL ON FUNCTION public.public_provider_trust_stats(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_provider_trust_stats(uuid[]) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.public_provider_reviews(
  p_provider_id uuid,
  p_limit integer DEFAULT 5,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  rating smallint,
  comment text,
  provider_reply text,
  created_at timestamptz,
  subject_name_ar text,
  subject_name_en text,
  curriculum_code text,
  curriculum_name_ar text,
  curriculum_name_en text,
  level_code text,
  level_label_style text,
  level_name_ar text,
  level_name_en text,
  total_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id,
    r.rating,
    r.comment,
    r.provider_reply,
    r.created_at,
    b.teaching_subject_name_ar,
    b.teaching_subject_name_en,
    b.teaching_curriculum_code,
    b.teaching_curriculum_name_ar,
    b.teaching_curriculum_name_en,
    b.teaching_level_code,
    tc.level_label_style,
    b.teaching_level_name_ar,
    b.teaching_level_name_en,
    (count(*) OVER ())::integer
  FROM public.reviews r
  JOIN public.providers p ON p.id = r.provider_id
  LEFT JOIN public.bookings b ON b.id = r.booking_id
  LEFT JOIN public.teaching_curricula tc ON tc.code = b.teaching_curriculum_code
  WHERE r.provider_id = p_provider_id
    AND r.deleted_at IS NULL
    AND r.moderation_hidden_at IS NULL
    AND p.deleted_at IS NULL
    AND p.is_active
    AND p.onboarding_status = 'APPROVED'
  ORDER BY r.created_at DESC, r.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.public_provider_reviews(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_provider_reviews(uuid, integer, integer) TO anon, authenticated, service_role;

-- #573: Quran subjects read as bare «حفظ» / «تجويد» outside the Quran screens, and
-- the KG level reads «رياض الأطفال (KG1–KG2)» where the PO decided «كي جي» (#536).
-- Catalog display names only; codes and matching are unchanged. Existing booking
-- snapshots keep the name they were booked with.
UPDATE public.teaching_subjects SET name_ar = 'حفظ القرآن', name_en = 'Quran memorization'
WHERE code = 'quran_memorization';
UPDATE public.teaching_subjects SET name_ar = 'تجويد القرآن', name_en = 'Quran tajweed'
WHERE code = 'quran_tajweed';
UPDATE public.teaching_subjects SET name_ar = 'تلاوة ومراجعة القرآن', name_en = 'Quran recitation & review'
WHERE code = 'quran_recitation_review';
UPDATE public.teaching_levels SET name_ar = 'كي جي', name_en = 'KG'
WHERE code = 'kg';
