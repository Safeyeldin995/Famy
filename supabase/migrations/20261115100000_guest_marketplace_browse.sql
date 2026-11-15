-- Guest browsing (additive): signed-out visitors pick an active area (zone) and see
-- eligible providers there. Returns only the public marketplace card fields
-- (same shape as search_marketplace_providers): no phone, address or documents.

CREATE OR REPLACE FUNCTION public.guest_search_marketplace_providers(
  p_zone_id uuid,
  p_service_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid, full_name text, avatar_url text, bio_en text, bio_ar text, hourly_rate numeric,
  years_experience integer, languages text[], city text, is_top_pro boolean, is_verified boolean,
  response_time_min integer, service_id uuid, service_slug text, service_name_en text,
  service_name_ar text, category_slug text, rating_avg numeric, rating_count bigint,
  trust_score numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_zone_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.zones z WHERE z.id = p_zone_id AND z.is_active) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (p.id, s.id)
    p.id, pr.full_name, pr.avatar_url, p.bio_en, p.bio_ar, e.effective_price,
    p.years_experience, p.languages, p.city, p.is_top_pro, p.is_verified,
    p.response_time_min, s.id, s.slug, s.name_en, s.name_ar, c.slug,
    COALESCE(rs.rating_avg, 0), COALESCE(rs.rating_count, 0)::bigint, COALESCE(ts.score, 0)
  FROM public.providers p
  JOIN LATERAL public.marketplace_eligibility_internal(p.id, p_service_id, NULL) e ON e.is_eligible
  JOIN public.profiles pr ON pr.id = p.profile_id
  JOIN public.services s ON s.id = e.service_id
  JOIN public.categories c ON c.id = s.category_id
  LEFT JOIN public.ratings_summary rs ON rs.provider_id = p.id
  LEFT JOIN public.trust_scores ts ON ts.provider_id = p.id
  WHERE public.is_phase1_category_slug(c.slug)
    AND NOT public.provider_cash_debt_blocked(p.id)
    AND EXISTS (SELECT 1 FROM public.zone_providers zp WHERE zp.zone_id = p_zone_id AND zp.provider_id = p.id)
    AND EXISTS (SELECT 1 FROM public.zone_services zs WHERE zs.zone_id = p_zone_id AND zs.service_id = s.id)
  ORDER BY p.id, s.id, p.is_top_pro DESC, COALESCE(rs.rating_avg, 0) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_marketplace_provider_details(
  p_provider_id uuid,
  p_zone_id uuid
)
RETURNS TABLE(
  id uuid, full_name text, avatar_url text, bio_en text, bio_ar text, hourly_rate numeric,
  years_experience integer, languages text[], city text, is_top_pro boolean, is_verified boolean,
  response_time_min integer, service_id uuid, service_slug text, service_name_en text,
  service_name_ar text, category_slug text, rating_avg numeric, rating_count bigint,
  trust_score numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.*
  FROM public.guest_search_marketplace_providers(p_zone_id, NULL) g
  WHERE g.id = p_provider_id
  ORDER BY g.rating_avg DESC, g.service_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.guest_search_marketplace_providers(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guest_marketplace_provider_details(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_search_marketplace_providers(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_marketplace_provider_details(uuid, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- Guests may load the avatar of an approved, active provider (public marketplace info).
-- Customer avatars stay readable only by signed-in users. The check runs as definer
-- because anon cannot read providers/profiles directly.
CREATE OR REPLACE FUNCTION public.is_public_provider_avatar(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.providers p
    JOIN public.profiles pr ON pr.id = p.profile_id
    WHERE pr.avatar_url = p_name
      -- The object must live in the provider's own folder, so an edited avatar_url
      -- cannot expose another user's file.
      AND split_part(p_name, '/', 1) = pr.id::text
      AND p.onboarding_status = 'APPROVED'
      AND p.deleted_at IS NULL
      AND p.is_active
  );
$$;

REVOKE ALL ON FUNCTION public.is_public_provider_avatar(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_public_provider_avatar(text) TO anon, authenticated;

CREATE POLICY avatars_anon_read_approved_provider
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'avatars' AND public.is_public_provider_avatar(name));
