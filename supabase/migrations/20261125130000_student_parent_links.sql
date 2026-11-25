-- Student (12-17) parent guardian contact for online lessons (issue #417).
-- Transparency layer only: never blocks booking or payment.

CREATE TABLE IF NOT EXISTS public.student_parent_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  requested_parent_phone text NOT NULL,
  parent_email text NOT NULL,
  status text NOT NULL CHECK (status IN ('notified', 'linked', 'flagged_not_my_child', 'revoked')),
  flag_token uuid NOT NULL DEFAULT gen_random_uuid(),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz NULL,
  CONSTRAINT student_parent_links_distinct CHECK (student_id IS DISTINCT FROM parent_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS student_parent_links_one_active_per_student
  ON public.student_parent_links (student_id)
  WHERE status IN ('notified', 'linked', 'flagged_not_my_child');

CREATE UNIQUE INDEX IF NOT EXISTS student_parent_links_flag_token_idx
  ON public.student_parent_links (flag_token);

CREATE INDEX IF NOT EXISTS student_parent_links_parent_id_idx
  ON public.student_parent_links (parent_id)
  WHERE parent_id IS NOT NULL;

ALTER TABLE public.student_parent_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.student_parent_links FROM PUBLIC, anon;
GRANT SELECT ON public.student_parent_links TO authenticated;
GRANT ALL ON public.student_parent_links TO service_role;

DROP POLICY IF EXISTS student_parent_links_self_read ON public.student_parent_links;
CREATE POLICY student_parent_links_self_read ON public.student_parent_links
  FOR SELECT TO authenticated
  USING (student_id = (select auth.uid()) OR parent_id = (select auth.uid()));

CREATE OR REPLACE FUNCTION public.famy_profile_phone_digits(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_digits text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
BEGIN
  IF v_digits = '' THEN RETURN NULL; END IF;
  IF v_digits LIKE '0020%' THEN
    v_digits := substr(v_digits, 3);
  ELSIF v_digits LIKE '01%' THEN
    v_digits := '2' || v_digits;
  END IF;
  RETURN v_digits;
END;
$$;

CREATE OR REPLACE FUNCTION public.student_has_linked_parent(p_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.student_parent_links l
    WHERE l.student_id = p_student_id
      AND l.status = 'linked'
      AND l.parent_id IS NOT NULL
  );
$$;
REVOKE ALL ON FUNCTION public.student_has_linked_parent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_has_linked_parent(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.famy_normalize_parent_email(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(COALESCE(p_email, '')));
$$;

CREATE OR REPLACE FUNCTION public.famy_valid_parent_email(p_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_email, '') ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$';
$$;

CREATE TABLE IF NOT EXISTS public.parent_guardian_email_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_email text NOT NULL,
  link_id uuid NOT NULL REFERENCES public.student_parent_links(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parent_guardian_email_sends_student_sent_idx
  ON public.parent_guardian_email_sends (student_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS parent_guardian_email_sends_email_sent_idx
  ON public.parent_guardian_email_sends (lower(parent_email), sent_at DESC);

CREATE INDEX IF NOT EXISTS parent_guardian_email_sends_link_id_idx
  ON public.parent_guardian_email_sends (link_id);

REVOKE ALL ON public.parent_guardian_email_sends FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.parent_guardian_email_sends TO service_role;

CREATE OR REPLACE FUNCTION public._student_parent_link_resolve_parent(p_digits text, p_student_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_id uuid;
  v_parent_age integer;
BEGIN
  SELECT pr.id INTO v_parent_id
  FROM public.profiles pr
  WHERE public.famy_profile_phone_digits(pr.phone) = p_digits
    AND pr.deleted_at IS NULL
  LIMIT 1;
  IF v_parent_id IS NULL OR v_parent_id = p_student_id THEN
    RETURN NULL;
  END IF;
  IF public.is_admin_account(v_parent_id) OR NOT public.has_role(v_parent_id, 'customer') THEN
    RETURN NULL;
  END IF;
  v_parent_age := public.booking_online_age_years(v_parent_id, NULL);
  IF v_parent_age IS NULL OR v_parent_age < 18 THEN
    RETURN NULL;
  END IF;
  RETURN v_parent_id;
END;
$$;
REVOKE ALL ON FUNCTION public._student_parent_link_resolve_parent(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_parent_guardian_contact(
  p_parent_phone text,
  p_parent_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_digits text;
  v_email text;
  v_age integer;
  v_parent_id uuid;
  v_student_name text;
  v_link_id uuid;
  v_flag_token uuid;
  v_status text;
  v_recent integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF public.is_admin_account(v_uid) OR NOT public.has_role(v_uid, 'customer') THEN
    RAISE EXCEPTION 'admin_account_restricted' USING ERRCODE = 'P0001';
  END IF;
  v_age := public.booking_online_age_years(v_uid, NULL);
  IF v_age IS NULL OR v_age < 12 THEN
    RAISE EXCEPTION 'Parent guardian contact is only for students aged 12 and above.' USING ERRCODE = '23514';
  END IF;
  IF v_age >= 18 THEN
    RAISE EXCEPTION 'Parent guardian contact is not required for adults.' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer INTO v_recent
  FROM public.student_parent_links l
  WHERE l.student_id = v_uid AND l.requested_at > now() - interval '24 hours';
  IF v_recent >= 10 THEN
    RAISE EXCEPTION 'parent_link_rate_limited' USING ERRCODE = 'P0001';
  END IF;

  v_digits := public.famy_profile_phone_digits(p_parent_phone);
  IF v_digits IS NULL OR v_digits !~ '^201[0125][0-9]{8}$' THEN
    RAISE EXCEPTION 'INVALID_PHONE' USING ERRCODE = 'P0001';
  END IF;
  v_email := public.famy_normalize_parent_email(p_parent_email);
  IF NOT public.famy_valid_parent_email(v_email) THEN
    RAISE EXCEPTION 'INVALID_EMAIL' USING ERRCODE = 'P0001';
  END IF;

  v_parent_id := public._student_parent_link_resolve_parent(v_digits, v_uid);
  v_status := CASE WHEN v_parent_id IS NOT NULL THEN 'linked' ELSE 'notified' END;

  UPDATE public.student_parent_links
  SET status = 'revoked', decided_at = now()
  WHERE student_id = v_uid AND status IN ('notified', 'flagged_not_my_child');

  INSERT INTO public.student_parent_links (
    student_id, parent_id, requested_parent_phone, parent_email, status
  ) VALUES (
    v_uid,
    v_parent_id,
    v_digits,
    v_email,
    v_status
  )
  RETURNING id, flag_token INTO v_link_id, v_flag_token;

  SELECT COALESCE(full_name, '') INTO v_student_name FROM public.profiles WHERE id = v_uid;

  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar,
      payload, deep_link
    ) VALUES (
      v_parent_id,
      'student_parent_linked',
      'system',
      v_student_name || ' added you as guardian on Famy',
      'Acknowledge or flag if this is not your child',
      v_student_name || ' added you as guardian on Famy',
      v_student_name || ' ضافك كولي أمر على فامي',
      'Acknowledge or flag if this is not your child',
      'تمام أو اختار «ده مش ابني» لو الطالب مش ابنك',
      jsonb_build_object('link_id', v_link_id, 'student_id', v_uid, 'student_name', v_student_name),
      '/student-parent-link?linkId=' || v_link_id::text
    );
  END IF;

  RETURN jsonb_build_object(
    'link_id', v_link_id,
    'status', v_status,
    'flag_token', v_flag_token,
    'parent_on_famy', v_parent_id IS NOT NULL,
    'parent_email', v_email,
    'student_name', v_student_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_parent_guardian_contact(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_parent_guardian_contact(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_parent_guardian_email_send(p_link_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_link public.student_parent_links%ROWTYPE;
  v_student_name text;
  v_student_count integer;
  v_email_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF p_link_id IS NULL THEN
    SELECT * INTO v_link
    FROM public.student_parent_links
    WHERE student_id = v_uid AND status IN ('notified', 'linked', 'flagged_not_my_child')
    ORDER BY requested_at DESC
    LIMIT 1
    FOR UPDATE;
  ELSE
    SELECT * INTO v_link
    FROM public.student_parent_links
    WHERE id = p_link_id AND student_id = v_uid
    FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guardian link not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*)::integer INTO v_student_count
  FROM public.parent_guardian_email_sends
  WHERE student_id = v_uid AND sent_at > now() - interval '24 hours';
  IF v_student_count >= 3 THEN
    RAISE EXCEPTION 'parent_guardian_email_rate_limited' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer INTO v_email_count
  FROM public.parent_guardian_email_sends
  WHERE lower(parent_email) = lower(v_link.parent_email)
    AND sent_at > now() - interval '24 hours';
  IF v_email_count >= 3 THEN
    RAISE EXCEPTION 'parent_guardian_email_rate_limited' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.parent_guardian_email_sends
    WHERE link_id = v_link.id AND sent_at > now() - interval '1 hour'
  ) THEN
    SELECT COALESCE(full_name, '') INTO v_student_name FROM public.profiles WHERE id = v_uid;
    RETURN jsonb_build_object(
      'deduplicated', true,
      'link_id', v_link.id,
      'parent_email', v_link.parent_email,
      'student_name', v_student_name,
      'flag_token', v_link.flag_token::text
    );
  END IF;

  INSERT INTO public.parent_guardian_email_sends (student_id, parent_email, link_id)
  VALUES (v_uid, v_link.parent_email, v_link.id);

  SELECT COALESCE(full_name, '') INTO v_student_name FROM public.profiles WHERE id = v_uid;
  RETURN jsonb_build_object(
    'deduplicated', false,
    'link_id', v_link.id,
    'parent_email', v_link.parent_email,
    'student_name', v_student_name,
    'flag_token', v_link.flag_token::text
  );
END;
$$;
REVOKE ALL ON FUNCTION public.claim_parent_guardian_email_send(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_parent_guardian_email_send(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_parent_guardian_contact(
  p_parent_phone text,
  p_parent_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_age integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  v_age := public.booking_online_age_years(v_uid, NULL);
  IF v_age IS NULL OR v_age >= 18 THEN
    RAISE EXCEPTION 'Only students under 18 may update guardian contact.' USING ERRCODE = '23514';
  END IF;
  RETURN public.register_parent_guardian_contact(p_parent_phone, p_parent_email);
END;
$$;

REVOKE ALL ON FUNCTION public.update_parent_guardian_contact(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_parent_guardian_contact(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.parent_acknowledge_student_link(p_link_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_link public.student_parent_links%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_link FROM public.student_parent_links WHERE id = p_link_id FOR UPDATE;
  IF NOT FOUND OR v_link.parent_id IS DISTINCT FROM v_uid OR v_link.status <> 'linked' THEN
    RAISE EXCEPTION 'Link not found.' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.student_parent_links
  SET decided_at = COALESCE(decided_at, now())
  WHERE id = p_link_id;
  RETURN jsonb_build_object('link_id', p_link_id, 'status', 'linked');
END;
$$;

REVOKE ALL ON FUNCTION public.parent_acknowledge_student_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parent_acknowledge_student_link(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.parent_flag_not_my_child(p_link_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_link public.student_parent_links%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_link FROM public.student_parent_links WHERE id = p_link_id FOR UPDATE;
  IF NOT FOUND OR v_link.parent_id IS DISTINCT FROM v_uid OR v_link.status NOT IN ('linked', 'notified') THEN
    RAISE EXCEPTION 'Link not found.' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.student_parent_links
  SET status = 'flagged_not_my_child', decided_at = now()
  WHERE id = p_link_id;
  RETURN jsonb_build_object('link_id', p_link_id, 'status', 'flagged_not_my_child');
END;
$$;

REVOKE ALL ON FUNCTION public.parent_flag_not_my_child(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parent_flag_not_my_child(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.flag_parent_link_by_token(p_flag_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.student_parent_links%ROWTYPE;
BEGIN
  IF p_flag_token IS NULL THEN
    RAISE EXCEPTION 'Invalid token.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_link FROM public.student_parent_links WHERE flag_token = p_flag_token FOR UPDATE;
  IF NOT FOUND OR v_link.status NOT IN ('notified', 'linked') THEN
    RAISE EXCEPTION 'Link not found.' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.student_parent_links
  SET status = 'flagged_not_my_child', decided_at = now()
  WHERE id = v_link.id;
  RETURN jsonb_build_object('link_id', v_link.id, 'status', 'flagged_not_my_child');
END;
$$;

REVOKE ALL ON FUNCTION public.flag_parent_link_by_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flag_parent_link_by_token(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.revoke_parent_link(p_link_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_link public.student_parent_links%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_link FROM public.student_parent_links WHERE id = p_link_id FOR UPDATE;
  IF NOT FOUND OR v_link.status NOT IN ('notified', 'linked', 'flagged_not_my_child') THEN
    RAISE EXCEPTION 'Link not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_uid IS DISTINCT FROM v_link.student_id AND v_uid IS DISTINCT FROM v_link.parent_id THEN
    RAISE EXCEPTION 'Not authorized.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.student_parent_links
  SET status = 'revoked', decided_at = now()
  WHERE id = p_link_id;
  RETURN jsonb_build_object('link_id', p_link_id, 'status', 'revoked');
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_parent_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_parent_link(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.parent_linked_students()
RETURNS TABLE (
  link_id uuid,
  student_id uuid,
  student_name text,
  status text,
  requested_at timestamptz,
  decided_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.student_id,
    COALESCE(p.full_name, ''),
    l.status,
    l.requested_at,
    l.decided_at
  FROM public.student_parent_links l
  JOIN public.profiles p ON p.id = l.student_id
  WHERE l.parent_id = auth.uid()
    AND l.status IN ('notified', 'linked', 'flagged_not_my_child', 'revoked')
  ORDER BY l.requested_at DESC;
$$;

REVOKE ALL ON FUNCTION public.parent_linked_students() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parent_linked_students() TO authenticated;

CREATE OR REPLACE FUNCTION public.parent_student_lessons(p_student_id uuid)
RETURNS SETOF public.bookings
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.*
  FROM public.bookings b
  WHERE b.customer_id = p_student_id
    AND b.service_mode = 'online'
    AND EXISTS (
      SELECT 1 FROM public.student_parent_links l
      WHERE l.parent_id = auth.uid()
        AND l.student_id = p_student_id
        AND l.status = 'linked'
    )
  ORDER BY b.start_at DESC
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.parent_student_lessons(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parent_student_lessons(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.student_parent_link_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_build_object(
        'link_id', l.id,
        'status', l.status,
        'parent_id', l.parent_id,
        'requested_parent_phone', l.requested_parent_phone,
        'parent_email', l.parent_email,
        'requested_at', l.requested_at,
        'decided_at', l.decided_at
      )
      FROM public.student_parent_links l
      WHERE l.student_id = auth.uid()
        AND l.status IN ('notified', 'linked', 'flagged_not_my_child')
      ORDER BY l.requested_at DESC
      LIMIT 1
    ),
    'null'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.student_parent_link_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_parent_link_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_customer_parent_link(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(
    (
      SELECT jsonb_build_object(
        'link_id', l.id,
        'status', l.status,
        'parent_id', l.parent_id,
        'parent_name', pp.full_name,
        'parent_phone_masked', right(COALESCE(l.requested_parent_phone, ''), 3),
        'parent_email_masked', CASE
          WHEN position('@' in l.parent_email) > 1 THEN
            left(split_part(l.parent_email, '@', 1), 1) || '***@' || split_part(l.parent_email, '@', 2)
          ELSE '***'
        END,
        'requested_at', l.requested_at,
        'decided_at', l.decided_at
      )
      FROM public.student_parent_links l
      LEFT JOIN public.profiles pp ON pp.id = l.parent_id
      WHERE l.student_id = p_customer_id
      ORDER BY l.requested_at DESC
      LIMIT 1
    ),
    'null'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_customer_parent_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_customer_parent_link(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_parent_linked_students(p_parent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'link_id', l.id,
          'student_id', l.student_id,
          'student_name', p.full_name,
          'status', l.status,
          'requested_at', l.requested_at
        )
        ORDER BY l.requested_at DESC
      )
      FROM public.student_parent_links l
      JOIN public.profiles p ON p.id = l.student_id
      WHERE l.parent_id = p_parent_id
    ),
    '[]'::jsonb
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_parent_linked_students(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_parent_linked_students(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_student_links(
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_search text := NULLIF(btrim(p_search), '');
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(
    (
      SELECT jsonb_agg(row_to_json(x) ORDER BY x.requested_at DESC)
      FROM (
        SELECT
          l.id AS link_id,
          l.student_id,
          sp.full_name AS student_name,
          l.parent_id,
          pp.full_name AS parent_name,
          l.status,
          right(l.requested_parent_phone, 3) AS parent_phone_masked,
          CASE
            WHEN position('@' in l.parent_email) > 1 THEN
              left(split_part(l.parent_email, '@', 1), 1) || '***@' || split_part(l.parent_email, '@', 2)
            ELSE '***'
          END AS parent_email_masked,
          l.requested_at,
          l.decided_at
        FROM public.student_parent_links l
        JOIN public.profiles sp ON sp.id = l.student_id
        LEFT JOIN public.profiles pp ON pp.id = l.parent_id
        WHERE (p_status IS NULL OR l.status = p_status)
          AND (
            v_search IS NULL
            OR sp.full_name ILIKE '%' || v_search || '%'
            OR COALESCE(pp.full_name, '') ILIKE '%' || v_search || '%'
          )
        ORDER BY l.requested_at DESC
        LIMIT 200
      ) x
    ),
    '[]'::jsonb
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_student_links(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_student_links(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_student_parent_flag_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.student_parent_links l
  WHERE l.status = 'flagged_not_my_child'
    AND COALESCE(l.decided_at, l.requested_at) > now() - interval '30 days';
$$;
REVOKE ALL ON FUNCTION public.admin_student_parent_flag_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_student_parent_flag_count() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_revoke_student_link(p_link_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.student_parent_links%ROWTYPE;
  v_student_name text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_link FROM public.student_parent_links WHERE id = p_link_id FOR UPDATE;
  IF NOT FOUND OR v_link.status = 'revoked' THEN
    RAISE EXCEPTION 'Link not found.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM set_config('app.audit_reason', btrim(p_reason), true);
  UPDATE public.student_parent_links
  SET status = 'revoked', decided_at = now()
  WHERE id = p_link_id;
  SELECT COALESCE(full_name, '') INTO v_student_name FROM public.profiles WHERE id = v_link.student_id;
  IF v_link.parent_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar,
      payload, deep_link
    ) VALUES (
      v_link.parent_id,
      'student_parent_link_revoked',
      'system',
      'Guardian link revoked',
      'An admin revoked the guardian link for ' || v_student_name,
      'Guardian link revoked',
      'اتلغى ربط ولي الأمر',
      'An admin revoked the guardian link for ' || v_student_name,
      'الإدارة لغت ربط ولي الأمر للطالب ' || v_student_name,
      jsonb_build_object('link_id', p_link_id, 'student_id', v_link.student_id),
      '/student-parent-link'
    );
  END IF;
  INSERT INTO public.notifications (
    user_id, type, category, title, body, title_en, title_ar, body_en, body_ar,
    payload, deep_link
  ) VALUES (
    v_link.student_id,
    'student_parent_link_revoked',
    'system',
    'Guardian link revoked',
    'An admin revoked your guardian contact',
    'Guardian link revoked',
    'اتلغى ربط ولي الأمر',
    'An admin revoked your guardian contact',
    'الإدارة لغت بيانات ولي الأمر في حسابك',
    jsonb_build_object('link_id', p_link_id),
    '/student-parent-link'
  );
  RETURN jsonb_build_object('link_id', p_link_id, 'status', 'revoked');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_revoke_student_link(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_student_link(uuid, text) TO authenticated;

DROP TRIGGER IF EXISTS trg_audit_student_parent_links ON public.student_parent_links;
CREATE TRIGGER trg_audit_student_parent_links
  AFTER INSERT OR UPDATE OR DELETE ON public.student_parent_links
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

-- v1: students pay for their own bookings; linked parents do not pay in this release.
DROP FUNCTION IF EXISTS public.parent_may_pay_student_booking(uuid, uuid);

DROP POLICY IF EXISTS payments_customer_insert ON public.payments;
CREATE POLICY payments_customer_insert ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (
    customer_id = (SELECT auth.uid() AS uid)
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = payments.booking_id AND b.customer_id = (SELECT auth.uid() AS uid)
    )
  );

DROP POLICY IF EXISTS payments_customer_read ON public.payments;
CREATE POLICY payments_customer_read ON public.payments
  FOR SELECT TO authenticated
  USING (customer_id = (SELECT auth.uid() AS uid));

CREATE OR REPLACE FUNCTION public.create_booking(
  p_provider_id uuid,
  p_service_id uuid,
  p_address_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_idempotency_key uuid,
  p_family_member_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_promo_code_id uuid DEFAULT NULL,
  p_requirement_selections jsonb DEFAULT '[]'::jsonb,
  p_teaching_capability_id uuid DEFAULT NULL,
  p_teaching_subject_code text DEFAULT NULL,
  p_teaching_curriculum_code text DEFAULT NULL,
  p_teaching_level_code text DEFAULT NULL,
  p_supervision_mode text DEFAULT NULL,
  p_service_mode text DEFAULT 'in_person'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mode text := COALESCE(NULLIF(btrim(p_service_mode), ''), 'in_person');
  v_address uuid;
  v_fingerprint text;
  v_existing RECORD;
  v_booking_id uuid;
  v_created boolean := false;
  v_min_hours_before_start numeric;
  v_provider_min_notice integer;
  v_required_hours numeric;
  v_category_slug text;
  v_age integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '42501';
  END IF;
  IF public.is_admin_account(v_uid) THEN
    RAISE EXCEPTION 'admin_account_restricted' USING ERRCODE = 'P0001';
  END IF;
  IF public.is_not_suspended(v_uid) IS NOT TRUE THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Account is suspended.'
      USING ERRCODE = '42501';
  END IF;
  IF v_mode NOT IN ('in_person', 'online') THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Invalid service mode.'
      USING ERRCODE = '23514';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Idempotency key is required.'
      USING ERRCODE = '23514';
  END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Invalid booking time range.'
      USING ERRCODE = '23514';
  END IF;

  -- Online bookings never retain an unrelated address reference.
  v_address := CASE WHEN v_mode = 'online' THEN NULL ELSE p_address_id END;

  SELECT cat.slug INTO v_category_slug
  FROM public.services s
  JOIN public.categories cat ON cat.id = s.category_id
  WHERE s.id = p_service_id;

  IF v_mode = 'in_person' AND v_category_slug IN ('babysitting', 'tutoring') THEN
    IF p_supervision_mode IS NULL
       OR p_supervision_mode NOT IN ('cameras', 'adult_present') THEN
      RAISE EXCEPTION
        'BOOKING_SUPERVISION_REQUIRED: Choose how your child will be supervised during this service.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_mode = 'online' THEN
    v_age := public.booking_online_age_years(v_uid, p_family_member_id);
    IF v_age IS NULL THEN
      RAISE EXCEPTION
        'BOOKING_ONLINE_BIRTH_DATE_REQUIRED: Add a date of birth before booking an online lesson.'
        USING ERRCODE = '23514';
    ELSIF v_age < 12 THEN
      RAISE EXCEPTION
        'BOOKING_ONLINE_AGE_MINIMUM: Online lessons are available from age 12.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  v_fingerprint := public.booking_request_fingerprint(
    p_provider_id,
    p_service_id,
    v_address,
    p_start_at,
    p_end_at,
    p_family_member_id,
    p_notes,
    p_promo_code_id,
    coalesce(p_requirement_selections, '[]'::jsonb),
    p_teaching_capability_id,
    p_teaching_subject_code,
    p_teaching_curriculum_code,
    p_teaching_level_code,
    p_supervision_mode,
    v_mode
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':' || p_idempotency_key::text, 0)
  );

  SELECT id, request_fingerprint INTO v_existing
  FROM public.bookings
  WHERE customer_id = v_uid AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION
        'BOOKING_DUPLICATE_REQUEST_CONFLICT: Idempotency key reused with different booking details.'
        USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object(
      'booking_id', v_existing.id,
      'created', false,
      'idempotent_replay', true
    );
  END IF;

  SELECT s.min_hours_before_start INTO v_min_hours_before_start
  FROM public.booking_expiry_settings() s;

  SELECT min_notice_hours INTO v_provider_min_notice
  FROM public.providers
  WHERE id = p_provider_id;

  v_required_hours := GREATEST(
    COALESCE(v_min_hours_before_start, 2),
    COALESCE(v_provider_min_notice, 0)::numeric
  );
  IF p_start_at < now() + (v_required_hours * interval '1 hour') THEN
    RAISE EXCEPTION
      'BOOKING_INVALID_BOOKING_REQUEST: This start time is too soon for the provider to respond in time.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.marketplace_eligibility_internal(
      p_provider_id, p_service_id, v_address, v_mode
    ) e
    WHERE e.is_eligible
  ) THEN
    RAISE EXCEPTION
      'BOOKING_PROVIDER_INELIGIBLE: Provider is not eligible for this service mode and address.'
      USING ERRCODE = '23514';
  END IF;

  IF public.provider_cash_debt_blocked(p_provider_id) THEN
    RAISE EXCEPTION
      'BOOKING_PROVIDER_SETTLEMENT_BLOCKED: Provider cannot receive new bookings until platform balance is settled.'
      USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.create_booking_in_progress', 'on', true);

  BEGIN
    INSERT INTO public.bookings (
      customer_id,
      provider_id,
      service_id,
      address_id,
      start_at,
      end_at,
      status,
      notes,
      family_member_id,
      requirement_selections,
      promo_code_id,
      price_subtotal,
      price_discount,
      price_total,
      price_platform_fee,
      price_vat,
      price_extras_total,
      price_travel_fee,
      idempotency_key,
      request_fingerprint,
      currency,
      teaching_capability_id,
      teaching_subject_code,
      teaching_curriculum_code,
      teaching_level_code,
      supervision_mode,
      service_mode
    ) VALUES (
      v_uid,
      p_provider_id,
      p_service_id,
      v_address,
      p_start_at,
      p_end_at,
      'pending',
      NULLIF(btrim(p_notes), ''),
      p_family_member_id,
      coalesce(p_requirement_selections, '[]'::jsonb),
      p_promo_code_id,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      p_idempotency_key,
      v_fingerprint,
      'EGP',
      p_teaching_capability_id,
      NULLIF(btrim(p_teaching_subject_code), ''),
      NULLIF(btrim(p_teaching_curriculum_code), ''),
      NULLIF(btrim(p_teaching_level_code), ''),
      p_supervision_mode,
      v_mode
    )
    RETURNING id INTO v_booking_id;
    v_created := true;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id, request_fingerprint INTO v_existing
      FROM public.bookings
      WHERE customer_id = v_uid AND idempotency_key = p_idempotency_key;

      IF FOUND AND v_existing.request_fingerprint = v_fingerprint THEN
        RETURN jsonb_build_object(
          'booking_id', v_existing.id,
          'created', false,
          'idempotent_replay', true
        );
      END IF;
      RAISE EXCEPTION
        'BOOKING_DUPLICATE_REQUEST_CONFLICT: Concurrent duplicate booking request.'
        USING ERRCODE = '23514';
    WHEN exclusion_violation THEN
      RAISE EXCEPTION
        'BOOKING_SLOT_UNAVAILABLE: That time slot is no longer available.'
        USING ERRCODE = '23514';
    WHEN SQLSTATE '23514' THEN
      RAISE;
    WHEN SQLSTATE '42501' THEN
      RAISE;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'BOOKING_%' THEN
        RAISE;
      END IF;
      RAISE EXCEPTION
        'BOOKING_INVALID_BOOKING_REQUEST: Unable to create booking.'
        USING ERRCODE = '23514';
  END;

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'created', v_created,
    'idempotent_replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb,
  uuid, text, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb,
  uuid, text, text, text, text, text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_audit_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_diff jsonb;
  v_id uuid;
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_booking_id uuid;
  v_reason text;
  v_correlation_id uuid;
  v_deny_keys CONSTANT text[] := ARRAY[
    'password', 'password_hash', 'access_token', 'refresh_token', 'service_role_key',
    'api_key', 'secret', 'secret_key', 'private_key', 'token', 'client_secret',
    'authorization', 'auth_token', 'session_token',
    'requested_parent_phone', 'parent_email', 'flag_token'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW); v_id := NEW.id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW); v_id := NEW.id;
    IF v_old = v_new THEN RETURN NEW; END IF;
  ELSE
    v_old := to_jsonb(OLD); v_id := OLD.id;
  END IF;

  IF TG_TABLE_NAME = 'bookings' THEN
    v_booking_id := v_id;
  ELSE
    v_booking_id := COALESCE((v_new->>'booking_id')::uuid, (v_old->>'booking_id')::uuid);
  END IF;

  v_reason := NULLIF(btrim(current_setting('app.audit_reason', true)), '');
  IF v_reason IS NULL THEN
    v_reason := COALESCE(
      v_new->>'reason', v_new->>'admin_notes', v_new->>'resolution_notes',
      v_new->>'rejection_reason', v_new->>'review_notes', v_new->>'cancellation_reason',
      v_old->>'reason', v_old->>'admin_notes', v_old->>'resolution_notes',
      v_old->>'rejection_reason', v_old->>'review_notes'
    );
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(jsonb_object_agg(t.key, t.value), '{}'::jsonb)
      INTO v_diff
      FROM jsonb_each(v_new) AS t(key, value)
      WHERE (v_old -> t.key) IS DISTINCT FROM t.value;
  ELSE
    v_diff := NULL;
  END IF;

  IF public.has_role(v_actor, 'admin') THEN v_actor_role := 'admin';
  ELSIF public.has_role(v_actor, 'provider') THEN v_actor_role := 'provider';
  ELSIF public.has_role(v_actor, 'customer') THEN v_actor_role := 'customer';
  ELSE v_actor_role := NULL;
  END IF;

  BEGIN
    v_correlation_id := NULLIF(current_setting('app.audit_correlation_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_correlation_id := NULL;
  END;
  IF v_correlation_id IS NULL THEN
    v_correlation_id := gen_random_uuid();
    PERFORM set_config('app.audit_correlation_id', v_correlation_id::text, true);
  END IF;

  v_old := public.audit_redact_jsonb(v_old, v_deny_keys);
  v_new := public.audit_redact_jsonb(v_new, v_deny_keys);
  v_diff := public.audit_redact_jsonb(v_diff, v_deny_keys);

  INSERT INTO public.audit_logs(
    actor_id, actor_role, action, entity, entity_id, booking_id, reason, correlation_id, old_values, new_values, diff
  )
  VALUES (
    v_actor, v_actor_role, TG_OP, TG_TABLE_NAME, v_id, v_booking_id, v_reason, v_correlation_id, v_old, v_new, v_diff
  );
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_audit_changes() FROM PUBLIC, anon, authenticated;
