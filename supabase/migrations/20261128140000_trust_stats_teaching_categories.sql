-- #577 split Quran and music into their own categories. Lessons in those
-- categories are lessons too: count them in completed_lessons («X حصة على فامي»).
-- Re-derived from 20261128120000_tutor_trust_public_stats.sql; only that filter changes.

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
      count(*) FILTER (WHERE c.slug IN ('tutoring', 'quran', 'music'))::integer AS completed_lessons
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
