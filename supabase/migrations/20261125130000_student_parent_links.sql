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
  USING (student_id = auth.uid() OR parent_id = auth.uid());

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

CREATE OR REPLACE FUNCTION public.parent_may_pay_student_booking(p_parent_id uuid, p_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bookings b
    JOIN public.student_parent_links l
      ON l.student_id = b.customer_id
     AND l.parent_id = p_parent_id
     AND l.status = 'linked'
    WHERE b.id = p_booking_id AND b.service_mode = 'online'
  );
$$;
REVOKE ALL ON FUNCTION public.parent_may_pay_student_booking(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parent_may_pay_student_booking(uuid, uuid) TO authenticated, service_role;


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
  IF v_uid <> v_link.student_id AND v_uid <> v_link.parent_id THEN
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

DROP POLICY IF EXISTS payments_customer_insert ON public.payments;
CREATE POLICY payments_customer_insert ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (
  (
    customer_id = (SELECT auth.uid() AS uid)
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = payments.booking_id AND b.customer_id = (SELECT auth.uid() AS uid)
    )
  )
  OR (
    public.parent_may_pay_student_booking((SELECT auth.uid() AS uid), booking_id)
    AND customer_id = (
      SELECT b.customer_id FROM public.bookings b WHERE b.id = payments.booking_id
    )
  )
  );

DROP POLICY IF EXISTS payments_customer_read ON public.payments;
CREATE POLICY payments_customer_read ON public.payments
  FOR SELECT TO authenticated
  USING (
    customer_id = (SELECT auth.uid() AS uid)
    OR EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = payments.booking_id
        AND public.parent_may_pay_student_booking((SELECT auth.uid() AS uid), b.id)
    )
  );

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

REVOKE ALL ON FUNCTION public.customer_apply_wallet_at_checkout(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_apply_wallet_at_checkout(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_apply_wallet_at_checkout(uuid, uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.tg_guard_payment_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reviewer boolean;
BEGIN
  IF current_setting('app.ledger_internal_capture', true) = 'on'
     OR current_setting('app.wallet_checkout_adjust', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF auth.role() = 'service_role' OR (v_uid IS NULL AND auth.role() IS NULL) THEN RETURN NEW; END IF;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF v_uid = NEW.customer_id THEN
      NULL;
    ELSIF public.parent_may_pay_student_booking(v_uid, NEW.booking_id)
      AND NEW.customer_id = (
        SELECT b.customer_id FROM public.bookings b WHERE b.id = NEW.booking_id
      ) THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Only the booking customer can initialize payment.' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public.bookings WHERE id = NEW.booking_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.payments WHERE booking_id = NEW.booking_id
               AND status NOT IN ('rejected', 'failed', 'refunded')) THEN
      RAISE EXCEPTION 'A payment already exists for this booking.' USING ERRCODE = '23514';
    END IF;
    NEW.status := CASE WHEN NEW.payment_method_type = 'manual_transfer'
      THEN 'pending_review'::public.payment_status ELSE 'pending'::public.payment_status END;
    NEW.provider_ref := NULL;
    NEW.metadata := '{}'::jsonb;
    NEW.paymob_order_id := NULL;
    NEW.paymob_integration_id := NULL;
    NEW.captured_at := NULL;
    NEW.reviewed_at := NULL;
    NEW.reviewed_by := NULL;
    NEW.rejection_reason := NULL;
    NEW.proof_path := NULL;
    NEW.proof_uploaded_at := NULL;
    NEW.created_at := now();
    RETURN NEW;
  END IF;

  v_reviewer := public.has_role(v_uid, 'admin') OR EXISTS (
    SELECT 1 FROM public.bookings b JOIN public.providers p ON p.id = b.provider_id
    WHERE b.id = OLD.booking_id AND p.profile_id = v_uid
  );
  IF OLD.payment_method_type = 'online' OR OLD.payment_method_code = 'paymob' OR OLD.method = 'paymob' THEN
    RAISE EXCEPTION 'Online payments can only be updated by the payment gateway.' USING ERRCODE = '42501';
  END IF;
  IF OLD.customer_id = v_uid AND NOT public.has_role(v_uid, 'admin') THEN
    IF OLD.status <> 'pending_review' OR OLD.payment_method_type <> 'manual_transfer'
       OR (to_jsonb(NEW) - ARRAY['proof_path','proof_uploaded_at','updated_at'])
          IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['proof_path','proof_uploaded_at','updated_at']) THEN
      RAISE EXCEPTION 'Customers may only upload pending payment proof.' USING ERRCODE = '42501';
    END IF;
    IF NEW.proof_path IS NOT NULL AND split_part(NEW.proof_path, '/', 1) <> OLD.booking_id::text THEN
      RAISE EXCEPTION 'Payment proof must belong to this booking.' USING ERRCODE = '42501';
    END IF;
    NEW.proof_uploaded_at := CASE WHEN NEW.proof_path IS NULL THEN NULL ELSE now() END;
  ELSIF v_reviewer THEN
    IF OLD.status NOT IN ('pending', 'pending_review') OR NEW.status NOT IN ('captured', 'rejected')
       OR (to_jsonb(NEW) - ARRAY['status','captured_at','reviewed_at','reviewed_by','rejection_reason','updated_at'])
          IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','captured_at','reviewed_at','reviewed_by','rejection_reason','updated_at']) THEN
      RAISE EXCEPTION 'Invalid manual payment review.' USING ERRCODE = '42501';
    END IF;
    NEW.reviewed_by := v_uid;
    NEW.reviewed_at := now();
    NEW.captured_at := CASE WHEN NEW.status = 'captured' THEN now() ELSE NULL END;
    NEW.rejection_reason := CASE WHEN NEW.status = 'rejected' THEN NEW.rejection_reason ELSE NULL END;
  ELSE
    RAISE EXCEPTION 'Payment update not authorized.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;


REVOKE ALL ON FUNCTION public.tg_guard_payment_writes() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.customer_apply_wallet_at_checkout(
  p_payment_id uuid,
  p_customer_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pay public.payments%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_due numeric;
  v_available numeric;
  v_spend numeric;
  v_card numeric;
  v_key text;
  v_entry_id uuid;
  v_existing jsonb;
  v_payer uuid;
BEGIN
  IF v_uid IS NULL THEN
    IF p_customer_id IS NULL THEN
      RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;
    IF current_setting('role', true) <> 'service_role' THEN
      RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;
    v_uid := p_customer_id;
  END IF;

  IF public.is_admin_account(v_uid) THEN
    RAISE EXCEPTION 'admin_account_restricted' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_pay.customer_id = v_uid THEN
    v_payer := v_uid;
  ELSIF public.parent_may_pay_student_booking(v_uid, v_pay.booking_id) THEN
    v_payer := v_uid;
  ELSE
    RAISE EXCEPTION 'Payment not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_pay.status = 'captured' THEN
    RETURN jsonb_build_object(
      'payment_id', v_pay.id,
      'wallet_spent', COALESCE((v_pay.metadata->>'wallet_applied')::numeric, 0),
      'card_amount', 0,
      'paid_via_wallet_only', true
    );
  END IF;
  IF v_pay.status <> 'pending' THEN
    RAISE EXCEPTION 'Payment is not payable.' USING ERRCODE = '23514';
  END IF;

  v_existing := v_pay.metadata->'wallet_checkout';
  IF jsonb_typeof(v_existing) = 'object' AND (v_existing->>'applied')::boolean IS TRUE THEN
    RETURN v_existing || jsonb_build_object('payment_id', v_pay.id);
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_pay.booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_booking.status::text NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'This booking is no longer payable.' USING ERRCODE = '23514';
  END IF;

  PERFORM public.lock_customer_debts(v_pay.customer_id);
  PERFORM public.lock_customer_wallet(v_payer);

  v_due := COALESCE(
    NULLIF((v_pay.metadata->>'checkout_total')::numeric, 0),
    NULLIF(v_pay.amount, 0),
    COALESCE(v_booking.price_total, 0) + COALESCE(v_booking.carried_fees_amount, 0)
  );
  IF v_due <= 0 THEN
    RAISE EXCEPTION 'Nothing to pay.' USING ERRCODE = '23514';
  END IF;

  SELECT b.available_amount INTO v_available
  FROM public.customer_wallet_balances(v_payer) b;

  v_spend := LEAST(GREATEST(COALESCE(v_available, 0), 0), v_due);
  v_card := GREATEST(v_due - v_spend, 0);

  v_key := 'checkout_spend:' || p_payment_id::text;

  IF v_spend > 0 THEN
    IF v_spend > COALESCE(v_available, 0) + 0.0001 THEN
      RAISE EXCEPTION 'Insufficient wallet balance.' USING ERRCODE = '23514';
    END IF;
    v_entry_id := public.customer_wallet_insert_entry(
      v_payer, 'debit', v_spend, 'checkout_spend', v_booking.id, p_payment_id, NULL, v_key,
      jsonb_build_object('checkout_total', v_due)
    );
    IF v_entry_id IS NULL THEN
      SELECT e.id, e.amount INTO v_entry_id, v_spend
      FROM public.customer_wallet_entries e
      WHERE e.idempotency_key = v_key;
      IF v_entry_id IS NULL THEN
        RAISE EXCEPTION 'Wallet checkout debit could not be recorded.' USING ERRCODE = '23514';
      END IF;
      v_card := GREATEST(v_due - v_spend, 0);
    END IF;
  END IF;

  IF v_card <= 0.01 THEN
    PERFORM set_config('app.wallet_checkout_adjust', 'on', true);
    PERFORM set_config('app.ledger_internal_capture', 'on', true);
    UPDATE public.payments
    SET status = 'captured',
        captured_at = now(),
        amount = v_due,
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'wallet_checkout',
          jsonb_build_object(
            'applied', true,
            'checkout_total', v_due,
            'wallet_spent', v_spend,
            'card_amount', 0,
            'paid_via_wallet_only', true
          ),
          'wallet_applied', v_spend,
          'checkout_total', v_due
        )
    WHERE id = p_payment_id;
    PERFORM set_config('app.ledger_internal_capture', 'off', true);
    PERFORM set_config('app.wallet_checkout_adjust', 'off', true);
    RETURN jsonb_build_object(
      'payment_id', p_payment_id,
      'wallet_spent', v_spend,
      'card_amount', 0,
      'paid_via_wallet_only', true
    );
  END IF;

  PERFORM set_config('app.wallet_checkout_adjust', 'on', true);
  UPDATE public.payments
  SET amount = round(v_card, 2),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'wallet_checkout',
        jsonb_build_object(
          'applied', true,
          'checkout_total', v_due,
          'wallet_spent', v_spend,
          'card_amount', round(v_card, 2),
          'paid_via_wallet_only', false
        ),
        'wallet_applied', v_spend,
        'checkout_total', v_due
      )
  WHERE id = p_payment_id;
  PERFORM set_config('app.wallet_checkout_adjust', 'off', true);

  RETURN jsonb_build_object(
    'payment_id', p_payment_id,
    'wallet_spent', v_spend,
    'card_amount', round(v_card, 2),
    'paid_via_wallet_only', false
  );
END;
$$;

