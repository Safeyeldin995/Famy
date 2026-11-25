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
  -- Who ended the link: lets admin see students who removed a linked parent.
  revoked_by text NULL CHECK (revoked_by IS NULL OR revoked_by IN ('student', 'parent', 'admin')),
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
  USING (parent_id = (select auth.uid()));

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

-- Tells a linked parent that the student removed or replaced them (never silent).
CREATE OR REPLACE FUNCTION public._student_parent_link_notify_removed(
  p_parent_id uuid,
  p_link_id uuid,
  p_student_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_name text;
BEGIN
  IF p_parent_id IS NULL THEN
    RETURN;
  END IF;
  SELECT left(COALESCE(NULLIF(btrim(full_name), ''), 'Student'), 40)
    INTO v_student_name
  FROM public.profiles WHERE id = p_student_id;
  INSERT INTO public.notifications (
    user_id, type, category, title, body, title_en, title_ar, body_en, body_ar,
    payload, deep_link
  ) VALUES (
    p_parent_id,
    'student_parent_link_removed',
    'system',
    v_student_name || ' removed you as guardian on Famy',
    'If you did not expect this, contact Famy support from the app',
    v_student_name || ' removed you as guardian on Famy',
    v_student_name || ' شال بياناتك كولي أمر على فامي',
    'If you did not expect this, contact Famy support from the app',
    'لو ده مش متوقع، كلم دعم فامي من التطبيق',
    jsonb_build_object('link_id', p_link_id, 'student_id', p_student_id),
    '/student-parent-link'
  );
END;
$$;
REVOKE ALL ON FUNCTION public._student_parent_link_notify_removed(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

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
  v_target_recent integer;
  v_prev public.student_parent_links%ROWTYPE;
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
  IF v_recent >= 3 THEN
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

  -- One phone number can be listed by a few students a day (siblings), not by many.
  SELECT count(*)::integer INTO v_target_recent
  FROM public.student_parent_links l
  WHERE l.requested_parent_phone = v_digits
    AND l.student_id <> v_uid
    AND l.requested_at > now() - interval '24 hours';
  IF v_target_recent >= 5 THEN
    RAISE EXCEPTION 'parent_link_rate_limited' USING ERRCODE = 'P0001';
  END IF;

  v_parent_id := public._student_parent_link_resolve_parent(v_digits, v_uid);
  v_status := CASE WHEN v_parent_id IS NOT NULL THEN 'linked' ELSE 'notified' END;

  SELECT * INTO v_prev
  FROM public.student_parent_links
  WHERE student_id = v_uid AND status IN ('notified', 'linked', 'flagged_not_my_child')
  ORDER BY requested_at DESC
  LIMIT 1
  FOR UPDATE;

  UPDATE public.student_parent_links
  SET status = 'revoked', decided_at = now(), revoked_by = 'student'
  WHERE student_id = v_uid AND status IN ('notified', 'linked', 'flagged_not_my_child');

  -- A linked parent who is being replaced by someone else is told, never dropped silently.
  IF v_prev.id IS NOT NULL
     AND v_prev.status = 'linked'
     AND v_prev.parent_id IS NOT NULL
     AND v_prev.parent_id IS DISTINCT FROM v_parent_id THEN
    PERFORM public._student_parent_link_notify_removed(v_prev.parent_id, v_prev.id, v_uid);
  END IF;

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

  SELECT left(COALESCE(NULLIF(btrim(full_name), ''), 'Student'), 40)
    INTO v_student_name
  FROM public.profiles WHERE id = v_uid;

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

  -- Same answer whether or not the phone belongs to a Famy account: the form must not
  -- tell a student who is on Famy.
  RETURN jsonb_build_object('link_id', v_link_id);
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
  v_send_id uuid;
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
  VALUES (v_uid, v_link.parent_email, v_link.id)
  RETURNING id INTO v_send_id;

  SELECT COALESCE(full_name, '') INTO v_student_name FROM public.profiles WHERE id = v_uid;
  RETURN jsonb_build_object(
    'deduplicated', false,
    'send_id', v_send_id,
    'link_id', v_link.id,
    'parent_email', v_link.parent_email,
    'student_name', v_student_name,
    'flag_token', v_link.flag_token::text
  );
END;
$$;
REVOKE ALL ON FUNCTION public.claim_parent_guardian_email_send(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_parent_guardian_email_send(uuid) TO authenticated;

-- The server calls this (service role) when the email provider refused the message, so a
-- failed send does not count toward the limits or the 1-hour dedupe and can be retried.
CREATE OR REPLACE FUNCTION public.release_parent_guardian_email_claim(p_send_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.parent_guardian_email_sends WHERE id = p_send_id;
$$;
REVOKE ALL ON FUNCTION public.release_parent_guardian_email_claim(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_parent_guardian_email_claim(uuid) TO service_role;

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
  SET status = 'revoked',
      decided_at = now(),
      revoked_by = CASE WHEN v_uid = v_link.student_id THEN 'student' ELSE 'parent' END
  WHERE id = p_link_id;
  IF v_uid = v_link.student_id AND v_link.status = 'linked' AND v_link.parent_id IS NOT NULL THEN
    PERFORM public._student_parent_link_notify_removed(v_link.parent_id, p_link_id, v_link.student_id);
  END IF;
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

-- Lessons show only after the parent tapped «تمام» (decided_at set on a linked row), and
-- only what the parent screen needs: never the full booking row.
CREATE OR REPLACE FUNCTION public.parent_student_lessons(p_student_id uuid)
RETURNS TABLE (
  booking_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  status text,
  subject_code text,
  price_total numeric,
  tutor_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id,
    b.start_at,
    b.end_at,
    b.status::text,
    b.teaching_subject_code,
    b.price_total,
    COALESCE(tp.full_name, '')
  FROM public.bookings b
  LEFT JOIN public.profiles tp ON tp.id = b.provider_id
  WHERE b.customer_id = p_student_id
    AND b.service_mode = 'online'
    AND EXISTS (
      SELECT 1 FROM public.student_parent_links l
      WHERE l.parent_id = auth.uid()
        AND l.student_id = p_student_id
        AND l.status = 'linked'
        AND l.decided_at IS NOT NULL
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
        'status', CASE
          WHEN l.status = 'linked' AND l.decided_at IS NULL THEN 'notified'
          ELSE l.status
        END,
        'parent_id', CASE WHEN l.decided_at IS NULL THEN NULL ELSE l.parent_id END,
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
          l.decided_at,
          l.revoked_by,
          (l.status = 'revoked' AND l.revoked_by = 'student' AND l.parent_id IS NOT NULL)
            AS removed_by_student
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT count(*)::integer
    FROM public.student_parent_links l
    WHERE COALESCE(l.decided_at, l.requested_at) > now() - interval '30 days'
      AND (
        l.status = 'flagged_not_my_child'
        OR (l.status = 'revoked' AND l.revoked_by = 'student' AND l.parent_id IS NOT NULL)
      )
  );
END;
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
  SET status = 'revoked', decided_at = now(), revoked_by = 'admin'
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

  -- booking_id/reason are read from the raw (pre-redaction) row — neither
  -- is ever a deny-listed key, and resolving them first keeps this
  -- independent of the redaction step below.
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

  -- Changed-keys-only object: for every key in the new row whose value is
  -- distinct from the old row's value at that key. (jsonb - jsonb is not a
  -- valid Postgres operator; the previous expression using it would raise
  -- "42883: operator does not exist" on every UPDATE and abort the
  -- triggering statement.)
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
