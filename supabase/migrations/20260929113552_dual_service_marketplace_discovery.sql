-- Forward correction for databases that already applied the closed-beta migration.
-- Keep the original migration immutable; return one row per eligible provider/service.
-- Preserve the customer/address guard, closed-beta category filter, and function ACL.

CREATE OR REPLACE FUNCTION public.search_marketplace_providers(
  p_service_id uuid DEFAULT NULL,
  p_address_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, full_name text, avatar_url text, bio_en text, bio_ar text,
  hourly_rate numeric, years_experience integer, languages text[], city text,
  is_top_pro boolean, is_verified boolean, response_time_min integer,
  service_id uuid, service_slug text, service_name_en text, service_name_ar text,
  category_slug text, rating_avg numeric, rating_count bigint, trust_score numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_address uuid := p_address_id;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'customer') OR public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Customer identity required' USING ERRCODE = '42501';
  END IF;
  IF v_address IS NULL THEN
    SELECT a.id INTO v_address FROM public.addresses a
    WHERE a.user_id = v_uid ORDER BY a.is_default DESC, a.created_at ASC LIMIT 1;
  END IF;
  IF v_address IS NULL OR NOT EXISTS (SELECT 1 FROM public.addresses a WHERE a.id = v_address AND a.user_id = v_uid) THEN
    RAISE EXCEPTION 'A Customer-owned address is required' USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (p.id, s.id)
    p.id, pr.full_name, pr.avatar_url, p.bio_en, p.bio_ar, e.effective_price,
    p.years_experience, p.languages, p.city, p.is_top_pro, p.is_verified,
    p.response_time_min, s.id, s.slug, s.name_en, s.name_ar, c.slug,
    COALESCE(rs.rating_avg, 0), COALESCE(rs.rating_count, 0)::bigint, COALESCE(ts.score, 0)
  FROM public.providers p
  JOIN LATERAL public.marketplace_eligibility_internal(p.id, p_service_id, v_address) e ON e.is_eligible
  JOIN public.profiles pr ON pr.id = p.profile_id
  JOIN public.services s ON s.id = e.service_id
  JOIN public.categories c ON c.id = s.category_id
  LEFT JOIN public.ratings_summary rs ON rs.provider_id = p.id
  LEFT JOIN public.trust_scores ts ON ts.provider_id = p.id
  WHERE public.is_phase1_category_slug(c.slug)
  ORDER BY p.id, s.id, p.is_top_pro DESC, COALESCE(rs.rating_avg, 0) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.search_marketplace_providers(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_marketplace_providers(uuid,uuid) TO authenticated;
