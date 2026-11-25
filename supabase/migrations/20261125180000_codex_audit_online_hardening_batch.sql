-- Audit batch: atomic OTP send limits, avatar storage privacy, wallet/debt RPC hardening.

-- ---------------------------------------------------------------------------
-- OTP send attempts (atomic count + insert under advisory lock)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.otp_send_attempt_record_if_allowed(
  p_phone_hash text,
  p_ip_hash text,
  p_phone_limit int DEFAULT 5,
  p_ip_limit int DEFAULT 10,
  p_window_seconds int DEFAULT 3600,
  p_retention_seconds int DEFAULT 86400
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz;
  v_phone_count int;
  v_ip_count int;
  v_oldest timestamptz;
  v_retry_seconds int;
BEGIN
  IF p_phone_hash IS NULL OR btrim(p_phone_hash) = '' THEN
    RAISE EXCEPTION 'phone_hash required' USING ERRCODE = '23514';
  END IF;

  v_since := now() - make_interval(secs => greatest(p_window_seconds, 1));

  PERFORM pg_advisory_xact_lock(hashtext('otp_send:' || p_phone_hash));
  IF p_ip_hash IS NOT NULL AND btrim(p_ip_hash) <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('otp_send_ip:' || p_ip_hash));
  END IF;

  SELECT count(*)::int, min(created_at)
    INTO v_phone_count, v_oldest
  FROM public.otp_send_attempts
  WHERE phone_hash = p_phone_hash
    AND created_at >= v_since;

  IF v_phone_count >= greatest(p_phone_limit, 1) THEN
    v_retry_seconds := greatest(
      1,
      ceil(extract(epoch FROM (v_oldest + make_interval(secs => greatest(p_window_seconds, 1)) - now())))::int
    );
    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', v_retry_seconds);
  END IF;

  IF p_ip_hash IS NOT NULL AND btrim(p_ip_hash) <> '' THEN
    SELECT count(*)::int, min(created_at)
      INTO v_ip_count, v_oldest
    FROM public.otp_send_attempts
    WHERE ip_hash = p_ip_hash
      AND created_at >= v_since;

    IF v_ip_count >= greatest(p_ip_limit, 1) THEN
      v_retry_seconds := greatest(
        1,
        ceil(extract(epoch FROM (v_oldest + make_interval(secs => greatest(p_window_seconds, 1)) - now())))::int
      );
      RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', v_retry_seconds);
    END IF;
  END IF;

  INSERT INTO public.otp_send_attempts (phone_hash, ip_hash)
  VALUES (p_phone_hash, NULLIF(btrim(p_ip_hash), ''));

  DELETE FROM public.otp_send_attempts
  WHERE created_at < now() - make_interval(secs => greatest(p_retention_seconds, 3600));

  RETURN jsonb_build_object('allowed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.otp_send_attempt_record_if_allowed(text, text, int, int, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.otp_send_attempt_record_if_allowed(text, text, int, int, int, int) TO service_role;

-- ---------------------------------------------------------------------------
-- Avatars: limit authenticated reads to owner, marketplace provider, or booking party
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_authenticated_read_avatar(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(auth.uid(), 'admin')
    OR (
      auth.uid() IS NOT NULL
      AND split_part(p_name, '/', 1) = auth.uid()::text
    )
    OR public.is_public_provider_avatar(p_name)
    OR EXISTS (
      SELECT 1
      FROM public.bookings b
      JOIN public.providers pv ON pv.id = b.provider_id
      JOIN public.profiles cust ON cust.id = b.customer_id
      JOIN public.profiles prov ON prov.id = pv.profile_id
      WHERE b.deleted_at IS NULL
        AND (
          b.customer_id = auth.uid()
          OR pv.profile_id = auth.uid()
        )
        AND (cust.avatar_url = p_name OR prov.avatar_url = p_name)
    );
$$;

REVOKE ALL ON FUNCTION public.can_authenticated_read_avatar(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_authenticated_read_avatar(text) TO authenticated, service_role;

DROP POLICY IF EXISTS avatars_auth_read ON storage.objects;
CREATE POLICY avatars_auth_read
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND public.can_authenticated_read_avatar(name));

-- ---------------------------------------------------------------------------
-- provider_cash_debt_blocked: direct RPC only for owner/admin (trusted internal callers set bypass)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provider_cash_debt_blocked(p_provider_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit numeric;
  v_net numeric;
BEGIN
  IF COALESCE(current_setting('app.trusted_provider_debt_check', true), '') <> 'on'
     AND COALESCE(current_setting('app.create_booking_in_progress', true), '') <> 'on' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF COALESCE(current_setting('app.trusted_provider_debt_check', true), '') <> 'on'
     AND COALESCE(current_setting('app.create_booking_in_progress', true), '') <> 'on'
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT EXISTS (
       SELECT 1 FROM public.providers p
       WHERE p.id = p_provider_id AND p.profile_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
  END IF;

  SELECT s.cash_debt_limit INTO v_limit FROM public.provider_settlement_settings() s;
  SELECT COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END), 0)
    INTO v_net
  FROM public.provider_ledger_entries e
  WHERE e.provider_id = p_provider_id;
  RETURN COALESCE(v_net, 0) <= -v_limit;
END;
$$;

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
  PERFORM set_config('app.trusted_provider_debt_check', 'on', true);

  IF p_zone_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.zones z WHERE z.id = p_zone_id AND z.is_active) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (p.id, s.id)
    p.id, pr.full_name, pr.avatar_url, p.bio_en, p.bio_ar, e.effective_price,
    p.years_experience, p.languages, p.city, p.is_top_pro, p.is_verified,
    p.response_time_min, s.id, s.slug, s.name_en, s.name_ar, c.slug,
    COALESCE(rs.rating_avg, 0), COALESCE(rs.rating_count, 0)::bigint, COALESCE(ts.score, 0)
  FROM public.zone_providers zp
  JOIN public.providers p ON p.id = zp.provider_id
  JOIN LATERAL public.marketplace_eligibility_internal(p.id, p_service_id, NULL) e ON e.is_eligible
  JOIN public.profiles pr ON pr.id = p.profile_id
  JOIN public.services s ON s.id = e.service_id
  JOIN public.categories c ON c.id = s.category_id
  LEFT JOIN public.ratings_summary rs ON rs.provider_id = p.id
  LEFT JOIN public.trust_scores ts ON ts.provider_id = p.id
  WHERE zp.zone_id = p_zone_id
    AND public.is_phase1_category_slug(c.slug)
    AND NOT public.provider_cash_debt_blocked(p.id)
    AND EXISTS (SELECT 1 FROM public.zone_services zs WHERE zs.zone_id = p_zone_id AND zs.service_id = s.id)
  ORDER BY p.id, s.id, p.is_top_pro DESC, COALESCE(rs.rating_avg, 0) DESC;
END;
$$;

-- ---------------------------------------------------------------------------
-- customer_wallet_balances: reject null uid explicitly; use IS DISTINCT FROM
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_wallet_balances(p_customer_id uuid DEFAULT NULL)
RETURNS TABLE (
  ledger_balance numeric,
  held_amount numeric,
  available_amount numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer uuid := COALESCE(p_customer_id, auth.uid());
BEGIN
  IF v_customer IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF p_customer_id IS NOT NULL
     AND p_customer_id IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(
      sum(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END),
      0
    ),
    0::numeric,
    COALESCE(
      sum(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END),
      0
    )
  FROM public.customer_wallet_entries e
  WHERE e.customer_id = v_customer;
END;
$$;

NOTIFY pgrst, 'reload schema';