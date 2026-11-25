-- Student–parent account links for under-18 online students (#417).
-- Idempotent, no outer BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS public.student_parent_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  requested_parent_phone text NOT NULL,
  status text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoke_reason text,
  CONSTRAINT student_parent_links_status_chk
    CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  CONSTRAINT student_parent_links_not_self_chk
    CHECK (parent_id IS NULL OR parent_id <> student_id)
);

ALTER TABLE public.student_parent_links
  ADD COLUMN IF NOT EXISTS id uuid,
  ADD COLUMN IF NOT EXISTS student_id uuid,
  ADD COLUMN IF NOT EXISTS parent_id uuid,
  ADD COLUMN IF NOT EXISTS requested_parent_phone text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by uuid,
  ADD COLUMN IF NOT EXISTS revoke_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'student_parent_links_status_chk'
      AND conrelid = 'public.student_parent_links'::regclass
  ) THEN
    ALTER TABLE public.student_parent_links
      ADD CONSTRAINT student_parent_links_status_chk
      CHECK (status IN ('pending', 'approved', 'rejected', 'revoked'));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS student_parent_links_one_active_idx
  ON public.student_parent_links (student_id)
  WHERE status IN ('pending', 'approved');

CREATE INDEX IF NOT EXISTS student_parent_links_parent_id_idx
  ON public.student_parent_links (parent_id);

CREATE INDEX IF NOT EXISTS student_parent_links_revoked_by_idx
  ON public.student_parent_links (revoked_by);

CREATE INDEX IF NOT EXISTS student_parent_links_pending_requested_at_idx
  ON public.student_parent_links (requested_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.student_parent_link_booking_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.student_parent_link_booking_blocks
  ADD COLUMN IF NOT EXISTS id uuid,
  ADD COLUMN IF NOT EXISTS student_id uuid,
  ADD COLUMN IF NOT EXISTS attempted_at timestamptz;

CREATE INDEX IF NOT EXISTS student_parent_link_booking_blocks_student_id_idx
  ON public.student_parent_link_booking_blocks (student_id);

CREATE INDEX IF NOT EXISTS student_parent_link_booking_blocks_attempted_at_idx
  ON public.student_parent_link_booking_blocks (attempted_at DESC);

ALTER TABLE public.student_parent_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_parent_link_booking_blocks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.student_parent_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.student_parent_links TO authenticated;
GRANT ALL ON public.student_parent_links TO service_role;

REVOKE ALL ON public.student_parent_link_booking_blocks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.student_parent_link_booking_blocks TO authenticated;
GRANT ALL ON public.student_parent_link_booking_blocks TO service_role;

DROP POLICY IF EXISTS student_parent_links_party_read ON public.student_parent_links;
CREATE POLICY student_parent_links_party_read
  ON public.student_parent_links FOR SELECT TO authenticated
  USING (
    student_id = (select auth.uid())
    OR parent_id = (select auth.uid())
  );

DROP POLICY IF EXISTS student_parent_links_admin_read ON public.student_parent_links;
CREATE POLICY student_parent_links_admin_read
  ON public.student_parent_links FOR SELECT TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'));

DROP POLICY IF EXISTS student_parent_link_booking_blocks_admin_read
  ON public.student_parent_link_booking_blocks;
CREATE POLICY student_parent_link_booking_blocks_admin_read
  ON public.student_parent_link_booking_blocks FOR SELECT TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'));

DROP TRIGGER IF EXISTS trg_audit_student_parent_links ON public.student_parent_links;
CREATE TRIGGER trg_audit_student_parent_links
  AFTER INSERT OR UPDATE OR DELETE ON public.student_parent_links
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

CREATE OR REPLACE FUNCTION public.normalize_egypt_customer_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_digits text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
BEGIN
  IF v_digits = '' THEN
    RETURN NULL;
  END IF;
  IF v_digits ~ '^20' THEN
    RETURN '+' || v_digits;
  END IF;
  IF v_digits ~ '^0' THEN
    RETURN '+20' || substring(v_digits from 2);
  END IF;
  RETURN '+20' || v_digits;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_egypt_customer_phone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_egypt_customer_phone(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mask_egypt_phone_last3(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(regexp_replace(p_phone, '\D', '', 'g'), '') = '' THEN NULL
    WHEN length(regexp_replace(p_phone, '\D', '', 'g')) <= 3
      THEN regexp_replace(p_phone, '\D', '', 'g')
    ELSE repeat('•', length(regexp_replace(p_phone, '\D', '', 'g')) - 3)
      || right(regexp_replace(p_phone, '\D', '', 'g'), 3)
  END;
$$;

REVOKE ALL ON FUNCTION public.mask_egypt_phone_last3(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mask_egypt_phone_last3(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.profile_age_years(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXTRACT(year FROM age(CURRENT_DATE, pr.date_of_birth))::integer
  FROM public.profiles pr
  WHERE pr.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.profile_age_years(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_age_years(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_approved_parent_of_student(
  p_parent_id uuid,
  p_student_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.student_parent_links spl
    WHERE spl.parent_id = p_parent_id
      AND spl.student_id = p_student_id
      AND spl.status = 'approved'
  );
$$;

REVOKE ALL ON FUNCTION public.is_approved_parent_of_student(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_approved_parent_of_student(uuid, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_online_student_parent_link(p_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.student_parent_links spl
    WHERE spl.student_id = p_student_id AND spl.status = 'approved'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.student_parent_link_booking_blocks (student_id)
  VALUES (p_student_id);

  RAISE EXCEPTION
    'STUDENT_PARENT_LINK_REQUIRED: Link a parent account before booking an online lesson.'
    USING ERRCODE = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION public.assert_online_student_parent_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_online_student_parent_link(uuid)
  TO authenticated, service_role;

DROP POLICY IF EXISTS bookings_approved_parent_select ON public.bookings;
CREATE POLICY bookings_approved_parent_select
  ON public.bookings FOR SELECT TO authenticated
  USING (
    COALESCE(service_mode, 'in_person') = 'online'
    AND public.is_approved_parent_of_student((select auth.uid()), customer_id)
  );

DROP POLICY IF EXISTS payments_approved_parent_read ON public.payments;
CREATE POLICY payments_approved_parent_read
  ON public.payments FOR SELECT TO authenticated
  USING (
    public.is_approved_parent_of_student((select auth.uid()), customer_id)
  );

DROP POLICY IF EXISTS payments_approved_parent_insert ON public.payments;
CREATE POLICY payments_approved_parent_insert
  ON public.payments FOR INSERT TO authenticated
  WITH CHECK (
    public.is_approved_parent_of_student((select auth.uid()), customer_id)
    AND EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.id = booking_id
        AND b.customer_id = customer_id
        AND COALESCE(b.service_mode, 'in_person') = 'online'
    )
  );

CREATE OR REPLACE FUNCTION public.notify_student_parent_link(
  p_user_id uuid,
  p_type text,
  p_title_en text,
  p_title_ar text,
  p_body_en text,
  p_body_ar text,
  p_payload jsonb,
  p_deep_link text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications (
    user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
  ) VALUES (
    p_user_id, p_type, 'system',
    p_title_en, p_body_en,
    p_title_en, p_title_ar, p_body_en, p_body_ar,
    COALESCE(p_payload, '{}'::jsonb),
    p_deep_link
  );
END;
$$;

REVOKE ALL ON FUNCTION public.notify_student_parent_link(uuid, text, text, text, text, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.find_eligible_parent_by_phone(p_phone text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text := public.normalize_egypt_customer_phone(p_phone);
  v_id uuid;
  v_age integer;
BEGIN
  IF v_norm IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.id INTO v_id
  FROM public.profiles p
  WHERE public.normalize_egypt_customer_phone(p.phone) = v_norm
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF public.is_admin_account(v_id) THEN
    RETURN NULL;
  END IF;
  IF NOT public.has_role(v_id, 'customer') THEN
    RETURN NULL;
  END IF;
  v_age := public.profile_age_years(v_id);
  IF v_age IS NULL OR v_age < 18 THEN
    RETURN NULL;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.find_eligible_parent_by_phone(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_parent_link(p_parent_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_age integer;
  v_norm text;
  v_parent uuid;
  v_recent integer;
  v_existing public.student_parent_links%ROWTYPE;
  v_student_name text;
  v_link_id uuid;
  v_found boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.raise_if_admin_account(v_uid);
  IF NOT public.has_role(v_uid, 'customer') THEN
    RAISE EXCEPTION 'Customer authorization required.' USING ERRCODE = '42501';
  END IF;

  v_age := public.profile_age_years(v_uid);
  IF v_age IS NULL THEN
    RAISE EXCEPTION 'PARENT_LINK_BIRTH_DATE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF v_age < 12 OR v_age >= 18 THEN
    RAISE EXCEPTION 'PARENT_LINK_AGE_NOT_ELIGIBLE' USING ERRCODE = 'P0001';
  END IF;

  v_norm := public.normalize_egypt_customer_phone(p_parent_phone);
  IF v_norm IS NULL OR v_norm !~ '^\+201[0125][0-9]{8}$' THEN
    RAISE EXCEPTION 'PARENT_LINK_INVALID_PHONE' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer INTO v_recent
  FROM public.student_parent_links spl
  WHERE spl.student_id = v_uid
    AND spl.requested_at > now() - interval '1 hour';
  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'PARENT_LINK_RATE_LIMITED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing
  FROM public.student_parent_links
  WHERE student_id = v_uid AND status = 'approved'
  FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'PARENT_LINK_ALREADY_ACTIVE' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.student_parent_links
  SET status = 'rejected',
      decided_at = now(),
      revoke_reason = CASE
        WHEN requested_at < now() - interval '7 days' THEN 'expired'
        ELSE 'superseded'
      END
  WHERE student_id = v_uid AND status = 'pending';

  v_parent := public.find_eligible_parent_by_phone(v_norm);
  IF v_parent = v_uid THEN
    RAISE EXCEPTION 'PARENT_LINK_INVALID_PHONE' USING ERRCODE = 'P0001';
  END IF;
  v_found := v_parent IS NOT NULL;

  SELECT COALESCE(NULLIF(btrim(full_name), ''), 'Student') INTO v_student_name
  FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.student_parent_links (
    student_id, parent_id, requested_parent_phone, status
  ) VALUES (
    v_uid, v_parent, v_norm, 'pending'
  ) RETURNING id INTO v_link_id;

  IF v_parent IS NOT NULL THEN
    PERFORM public.notify_student_parent_link(
      v_parent,
      'parent_link_requested',
      'Parent link request',
      'طلب ربط ولي أمر',
      v_student_name || ' wants to link their Famy account to yours',
      v_student_name || ' عايز يربط حسابه بحسابك',
      jsonb_build_object('link_id', v_link_id, 'student_id', v_uid),
      '/family-members'
    );
  END IF;

  RETURN jsonb_build_object(
    'link_id', v_link_id,
    'status', 'pending',
    'parent_found', v_found
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_parent_link(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_parent_link(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_parent_link(p_link_id uuid, p_approve boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.student_parent_links%ROWTYPE;
  v_status text;
  v_student_name text;
  v_parent_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.raise_if_admin_account(v_uid);

  SELECT * INTO v_row
  FROM public.student_parent_links
  WHERE id = p_link_id
  FOR UPDATE;
  IF NOT FOUND OR v_row.parent_id IS DISTINCT FROM v_uid OR v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Parent link not found.' USING ERRCODE = 'P0002';
  END IF;

  v_status := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
  UPDATE public.student_parent_links
  SET status = v_status,
      decided_at = now()
  WHERE id = p_link_id;

  SELECT COALESCE(NULLIF(btrim(full_name), ''), 'Student') INTO v_student_name
  FROM public.profiles WHERE id = v_row.student_id;
  SELECT COALESCE(NULLIF(btrim(full_name), ''), 'Parent') INTO v_parent_name
  FROM public.profiles WHERE id = v_uid;

  IF p_approve THEN
    PERFORM public.notify_student_parent_link(
      v_row.student_id,
      'parent_link_approved',
      'Parent linked',
      'اتربط ولي الأمر',
      v_parent_name || ' approved the parent link',
      v_parent_name || ' وافق على ربط الحساب',
      jsonb_build_object('link_id', p_link_id, 'parent_id', v_uid),
      '/parent-link'
    );
  ELSE
    PERFORM public.notify_student_parent_link(
      v_row.student_id,
      'parent_link_rejected',
      'Parent link declined',
      'الربط اترفض',
      v_parent_name || ' declined the parent link',
      v_parent_name || ' رفض ربط الحساب',
      jsonb_build_object('link_id', p_link_id),
      '/parent-link'
    );
  END IF;

  RETURN jsonb_build_object('link_id', p_link_id, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.respond_parent_link(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_parent_link(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_parent_link(p_link_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.student_parent_links%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.raise_if_admin_account(v_uid);

  SELECT * INTO v_row
  FROM public.student_parent_links
  WHERE id = p_link_id
  FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'approved' THEN
    RAISE EXCEPTION 'Parent link not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_uid IS DISTINCT FROM v_row.student_id AND v_uid IS DISTINCT FROM v_row.parent_id THEN
    RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.student_parent_links
  SET status = 'revoked',
      decided_at = now(),
      revoked_by = v_uid,
      revoke_reason = 'unlinked'
  WHERE id = p_link_id;

  PERFORM public.notify_student_parent_link(
    v_row.student_id,
    'parent_link_revoked',
    'Parent link removed',
    'الربط اتشال',
    'The parent link was removed',
    'اتشال ربط ولي الأمر',
    jsonb_build_object('link_id', p_link_id),
    '/parent-link'
  );
  PERFORM public.notify_student_parent_link(
    v_row.parent_id,
    'parent_link_revoked',
    'Parent link removed',
    'الربط اتشال',
    'The parent link was removed',
    'اتشال ربط ولي الأمر',
    jsonb_build_object('link_id', p_link_id),
    '/family-members'
  );

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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    spl.id,
    spl.student_id,
    COALESCE(NULLIF(btrim(pr.full_name), ''), 'Student'),
    spl.status,
    spl.requested_at,
    spl.decided_at
  FROM public.student_parent_links spl
  JOIN public.profiles pr ON pr.id = spl.student_id
  WHERE spl.parent_id = v_uid
    AND spl.status IN ('pending', 'approved')
  ORDER BY spl.requested_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.parent_linked_students() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parent_linked_students() TO authenticated;

CREATE OR REPLACE FUNCTION public.parent_student_lessons(p_student_id uuid)
RETURNS TABLE (
  booking_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  status text,
  price_total numeric,
  payment_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_approved_parent_of_student(v_uid, p_student_id) THEN
    RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    b.id,
    b.start_at,
    b.end_at,
    b.status::text,
    b.price_total,
    pay.status::text
  FROM public.bookings b
  LEFT JOIN LATERAL (
    SELECT p.status
    FROM public.payments p
    WHERE p.booking_id = b.id
      AND p.status NOT IN ('rejected', 'failed', 'refunded')
    ORDER BY p.created_at DESC
    LIMIT 1
  ) pay ON true
  WHERE b.customer_id = p_student_id
    AND COALESCE(b.service_mode, 'in_person') = 'online'
  ORDER BY b.start_at DESC
  LIMIT 100;
END;
$$;

REVOKE ALL ON FUNCTION public.parent_student_lessons(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parent_student_lessons(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_student_links(
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS TABLE (
  link_id uuid,
  student_id uuid,
  student_name text,
  parent_id uuid,
  parent_name text,
  parent_phone_masked text,
  status text,
  requested_at timestamptz,
  decided_at timestamptz,
  revoke_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text := NULLIF(btrim(p_status), '');
  v_search text := NULLIF(btrim(p_search), '');
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('pending', 'approved', 'rejected', 'revoked') THEN
    RAISE EXCEPTION 'Invalid status filter.' USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
  SELECT
    spl.id,
    spl.student_id,
    COALESCE(NULLIF(btrim(st.full_name), ''), 'Student'),
    spl.parent_id,
    COALESCE(NULLIF(btrim(pt.full_name), ''), NULL),
    public.mask_egypt_phone_last3(COALESCE(pt.phone, spl.requested_parent_phone)),
    spl.status,
    spl.requested_at,
    spl.decided_at,
    spl.revoke_reason
  FROM public.student_parent_links spl
  JOIN public.profiles st ON st.id = spl.student_id
  LEFT JOIN public.profiles pt ON pt.id = spl.parent_id
  WHERE (v_status IS NULL OR spl.status = v_status)
    AND (
      v_search IS NULL
      OR st.full_name ILIKE '%' || v_search || '%'
      OR COALESCE(pt.full_name, '') ILIKE '%' || v_search || '%'
    )
  ORDER BY spl.requested_at DESC
  LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_student_links(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_student_links(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_revoke_student_link(p_link_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.student_parent_links%ROWTYPE;
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_row
  FROM public.student_parent_links
  WHERE id = p_link_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent link not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status IN ('revoked', 'rejected') THEN
    RETURN jsonb_build_object('link_id', p_link_id, 'status', v_row.status);
  END IF;

  PERFORM set_config('app.audit_reason', v_reason, true);

  UPDATE public.student_parent_links
  SET status = 'revoked',
      decided_at = now(),
      revoked_by = v_uid,
      revoke_reason = v_reason
  WHERE id = p_link_id;

  PERFORM public.notify_student_parent_link(
    v_row.student_id,
    'parent_link_revoked',
    'Parent link removed',
    'الربط اتشال',
    'Famy removed the parent link',
    'فامي شالت ربط ولي الأمر',
    jsonb_build_object('link_id', p_link_id, 'reason', v_reason),
    '/parent-link'
  );
  PERFORM public.notify_student_parent_link(
    v_row.parent_id,
    'parent_link_revoked',
    'Parent link removed',
    'الربط اتشال',
    'Famy removed the parent link',
    'فامي شالت ربط ولي الأمر',
    jsonb_build_object('link_id', p_link_id, 'reason', v_reason),
    '/family-members'
  );

  RETURN jsonb_build_object('link_id', p_link_id, 'status', 'revoked');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revoke_student_link(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_student_link(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_customer_student_parent_link(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row record;
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT
    spl.id AS link_id,
    spl.student_id,
    spl.parent_id,
    COALESCE(NULLIF(btrim(pt.full_name), ''), NULL) AS parent_name,
    public.mask_egypt_phone_last3(COALESCE(pt.phone, spl.requested_parent_phone)) AS parent_phone_masked,
    spl.status,
    spl.requested_at,
    spl.decided_at,
    spl.revoke_reason
  INTO v_row
  FROM public.student_parent_links spl
  LEFT JOIN public.profiles pt ON pt.id = spl.parent_id
  WHERE spl.student_id = p_customer_id
  ORDER BY
    CASE spl.status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
    spl.requested_at DESC
  LIMIT 1;

  IF v_row.link_id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_customer_student_parent_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_customer_student_parent_link(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_customer_linked_students(p_parent_id uuid)
RETURNS TABLE (
  link_id uuid,
  student_id uuid,
  student_name text,
  status text,
  requested_at timestamptz,
  decided_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    spl.id,
    spl.student_id,
    COALESCE(NULLIF(btrim(st.full_name), ''), 'Student'),
    spl.status,
    spl.requested_at,
    spl.decided_at
  FROM public.student_parent_links spl
  JOIN public.profiles st ON st.id = spl.student_id
  WHERE spl.parent_id = p_parent_id
  ORDER BY spl.requested_at DESC
  LIMIT 100;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_customer_linked_students(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_customer_linked_students(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_student_parent_booking_blocks(p_customer_id uuid DEFAULT NULL)
RETURNS TABLE (
  student_id uuid,
  student_name text,
  attempted_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    blk.student_id,
    COALESCE(NULLIF(btrim(st.full_name), ''), 'Student'),
    blk.attempted_at
  FROM public.student_parent_link_booking_blocks blk
  JOIN public.profiles st ON st.id = blk.student_id
  WHERE blk.attempted_at > now() - interval '7 days'
    AND (p_customer_id IS NULL OR blk.student_id = p_customer_id)
  ORDER BY blk.attempted_at DESC
  LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_student_parent_booking_blocks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_student_parent_booking_blocks(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_attach_pending_parent_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent uuid;
  v_student_name text;
  r record;
BEGIN
  IF NEW.phone IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.phone IS NOT DISTINCT FROM OLD.phone THEN
    RETURN NEW;
  END IF;
  v_parent := public.find_eligible_parent_by_phone(NEW.phone);
  IF v_parent IS NULL OR v_parent <> NEW.id THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT spl.id, spl.student_id
    FROM public.student_parent_links spl
    WHERE spl.status = 'pending'
      AND spl.parent_id IS NULL
      AND public.normalize_egypt_customer_phone(spl.requested_parent_phone)
          = public.normalize_egypt_customer_phone(NEW.phone)
  LOOP
    UPDATE public.student_parent_links
    SET parent_id = NEW.id
    WHERE id = r.id;
    SELECT COALESCE(NULLIF(btrim(full_name), ''), 'Student') INTO v_student_name
    FROM public.profiles WHERE id = r.student_id;
    PERFORM public.notify_student_parent_link(
      NEW.id,
      'parent_link_requested',
      'Parent link request',
      'طلب ربط ولي أمر',
      COALESCE(v_student_name, 'Student') || ' wants to link their Famy account to yours',
      COALESCE(v_student_name, 'Student') || ' عايز يربط حسابه بحسابك',
      jsonb_build_object('link_id', r.id, 'student_id', r.student_id),
      '/family-members'
    );
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_attach_pending_parent_links() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_attach_pending_parent_links ON public.profiles;
CREATE TRIGGER trg_attach_pending_parent_links
  AFTER INSERT OR UPDATE OF phone ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_attach_pending_parent_links();

-- Patched from latest create_booking / payment / wallet / work-queue functions.
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
    ELSIF v_age < 18 THEN
      PERFORM public.assert_online_student_parent_link(v_uid);
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
    IF NEW.customer_id <> v_uid THEN
      IF NOT (
        public.is_approved_parent_of_student(v_uid, NEW.customer_id)
        AND EXISTS (
          SELECT 1
          FROM public.bookings b
          WHERE b.id = NEW.booking_id
            AND b.customer_id = NEW.customer_id
            AND COALESCE(b.service_mode, 'in_person') = 'online'
        )
      ) THEN
        RAISE EXCEPTION 'Only the booking customer can initialize payment.' USING ERRCODE = '42501';
      END IF;
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
  IF v_pay.customer_id <> v_uid THEN
    IF NOT (
      public.is_approved_parent_of_student(v_uid, v_pay.customer_id)
      AND EXISTS (
        SELECT 1
        FROM public.bookings b
        WHERE b.id = v_pay.booking_id
          AND b.customer_id = v_pay.customer_id
          AND COALESCE(b.service_mode, 'in_person') = 'online'
      )
    ) THEN
      RAISE EXCEPTION 'Payment not found.' USING ERRCODE = 'P0002';
    END IF;
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

  PERFORM public.lock_customer_debts(v_uid);
  PERFORM public.lock_customer_wallet(v_uid);

  v_due := COALESCE(
    NULLIF((v_pay.metadata->>'checkout_total')::numeric, 0),
    NULLIF(v_pay.amount, 0),
    COALESCE(v_booking.price_total, 0) + COALESCE(v_booking.carried_fees_amount, 0)
  );
  IF v_due <= 0 THEN
    RAISE EXCEPTION 'Nothing to pay.' USING ERRCODE = '23514';
  END IF;

  SELECT b.available_amount INTO v_available
  FROM public.customer_wallet_balances(v_uid) b;

  v_spend := LEAST(GREATEST(COALESCE(v_available, 0), 0), v_due);
  v_card := GREATEST(v_due - v_spend, 0);

  v_key := 'checkout_spend:' || p_payment_id::text;

  IF v_spend > 0 THEN
    IF v_spend > COALESCE(v_available, 0) + 0.0001 THEN
      RAISE EXCEPTION 'Insufficient wallet balance.' USING ERRCODE = '23514';
    END IF;
    v_entry_id := public.customer_wallet_insert_entry(
      v_uid, 'debit', v_spend, 'checkout_spend', v_booking.id, p_payment_id, NULL, v_key,
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

CREATE OR REPLACE FUNCTION public.admin_work_queue_counts()
RETURNS TABLE(queue text, item_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutoff timestamptz;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT s.completion_auto_from INTO v_cutoff
  FROM public.booking_expiry_settings() s;

  RETURN QUERY
  SELECT 'new_applications'::text, count(*) FROM public.providers p
    WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND p.resubmitted_at IS NULL
      AND p.id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'resubmitted_applications'::text, count(*) FROM public.providers p
    WHERE p.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW') AND p.resubmitted_at IS NOT NULL
      AND p.id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'new_service_requests'::text, count(*) FROM public.provider_services ps
    JOIN public.providers p ON p.id = ps.provider_id
    WHERE ps.status = 'pending' AND p.onboarding_status = 'APPROVED'
      AND ps.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'price_change_requests'::text, count(*) FROM public.provider_services ps
    WHERE ps.status = 'approved'
      AND (
        ps.pending_price_override IS NOT NULL
        OR ps.pending_online_price_override IS NOT NULL
      )
      AND ps.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'pending_services'::text, count(*) FROM public.provider_services ps
    WHERE ps.status = 'pending'
      AND ps.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'pending_teaching_groups'::text, count(*) FROM (
    SELECT 1 FROM public.provider_teaching_capabilities c WHERE c.status = 'pending'
      AND c.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
    GROUP BY c.provider_id, c.service_id, c.subject_id, c.curriculum_id,
      c.session_duration_min, c.session_price
  ) groups_pending
  UNION ALL
  SELECT 'pending_documents'::text, count(*) FROM public.provider_documents d
    WHERE d.status = 'pending'
      AND d.provider_id IN (SELECT provider_id FROM public.admin_provider_identity_ids())
  UNION ALL
  SELECT 'open_cases'::text,
    (SELECT count(*) FROM public.disputes d WHERE d.status IN ('open', 'info_requested'))
    + (SELECT count(*) FROM public.support_tickets s WHERE s.status IN ('open', 'pending'))
  UNION ALL
  SELECT 'bookings_needing_action'::text,
    (SELECT count(*) FROM public.bookings b WHERE b.status IN ('disputed', 'no_show'))
    + (SELECT count(*) FROM public.online_session_admin_reviews rc WHERE rc.status = 'open')
  UNION ALL
  SELECT 'online_lesson_issue_reports'::text,
    (SELECT count(*) FROM public.online_lesson_issue_reports r WHERE r.status = 'open')
  UNION ALL
  SELECT 'payments_pending_review'::text, count(*) FROM public.payments pay
    WHERE pay.status = 'pending_review'
  UNION ALL
  SELECT 'bookings_lifecycle_attention'::text, count(*) FROM public.bookings b
    WHERE
      (b.status = 'confirmed' AND b.end_at < now())
      OR (b.status = 'arrived' AND b.status_changed_at < now() - interval '30 minutes')
      OR (b.status = 'completion_requested'
          AND b.completion_requested_at IS NOT NULL
          AND b.completion_requested_at < v_cutoff
          AND b.completion_requested_at < now() - interval '12 hours')
      OR (b.status = 'in_progress' AND now() > b.start_at + (b.end_at - b.start_at) + interval '2 hours')
  UNION ALL
  SELECT 'stale_student_parent_links'::text, count(*) FROM public.student_parent_links spl
    WHERE spl.status = 'pending'
      AND spl.requested_at < now() - interval '48 hours';
END;
$$;

REVOKE ALL ON FUNCTION public.tg_guard_payment_writes() FROM PUBLIC, anon, authenticated;
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
