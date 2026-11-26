-- UGC report + chat block (Apple 1.2 / Play UGC). Issue #432.

-- ---------------------------------------------------------------------------
-- 1) Chat pair blocks + hide conversations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_user_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NULL REFERENCES public.conversations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_user_blocks_pair_uq UNIQUE (customer_id, provider_user_id),
  CONSTRAINT chat_user_blocks_participant_chk CHECK (
    blocked_by = customer_id OR blocked_by = provider_user_id
  )
);

CREATE INDEX IF NOT EXISTS idx_chat_user_blocks_customer ON public.chat_user_blocks (customer_id);
CREATE INDEX IF NOT EXISTS idx_chat_user_blocks_provider_user ON public.chat_user_blocks (provider_user_id);

ALTER TABLE public.chat_user_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_user_blocks FROM PUBLIC, anon;
GRANT SELECT ON public.chat_user_blocks TO authenticated;
GRANT ALL ON public.chat_user_blocks TO service_role;

CREATE POLICY chat_user_blocks_party_read ON public.chat_user_blocks FOR SELECT TO authenticated
  USING (
    customer_id = (SELECT auth.uid())
    OR provider_user_id = (SELECT auth.uid())
    OR public.has_role((SELECT auth.uid()), 'admin')
  );

CREATE POLICY chat_user_blocks_admin_all ON public.chat_user_blocks FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz NULL;

CREATE OR REPLACE FUNCTION public.chat_pair_is_blocked(p_customer_id uuid, p_provider_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_user_blocks b
    WHERE b.customer_id = p_customer_id
      AND b.provider_user_id = p_provider_user_id
  );
$$;
REVOKE ALL ON FUNCTION public.chat_pair_is_blocked(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_pair_is_blocked(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.my_chat_block_status(p_conversation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_conv public.conversations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_conv
  FROM public.conversations c
  WHERE c.id = p_conversation_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_uid <> v_conv.customer_id AND v_uid <> v_conv.provider_user_id THEN
    RAISE EXCEPTION 'not_a_participant' USING ERRCODE = '42501';
  END IF;

  RETURN public.chat_pair_is_blocked(v_conv.customer_id, v_conv.provider_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.my_chat_block_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_chat_block_status(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) UGC reports queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ugc_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('chat_message', 'chat_thread', 'review')),
  reason text NOT NULL CHECK (reason IN ('harassment', 'spam', 'inappropriate', 'other')),
  detail text NULL,
  message_id uuid NULL REFERENCES public.messages(id) ON DELETE SET NULL,
  conversation_id uuid NULL REFERENCES public.conversations(id) ON DELETE SET NULL,
  review_id uuid NULL REFERENCES public.reviews(id) ON DELETE SET NULL,
  booking_id uuid NULL REFERENCES public.bookings(id) ON DELETE SET NULL,
  reported_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reporter_role text NOT NULL CHECK (reporter_role IN ('customer', 'provider')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  admin_notes text NULL,
  resolved_at timestamptz NULL,
  resolved_by uuid NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ugc_reports_subject_ref_chk CHECK (
    (subject_type = 'chat_message' AND message_id IS NOT NULL AND conversation_id IS NOT NULL)
    OR (subject_type = 'chat_thread' AND conversation_id IS NOT NULL AND message_id IS NULL)
    OR (subject_type = 'review' AND review_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_ugc_reports_open_created ON public.ugc_reports (created_at)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_ugc_reports_conversation ON public.ugc_reports (conversation_id)
  WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ugc_reports_review ON public.ugc_reports (review_id)
  WHERE review_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ugc_reports_reported_by ON public.ugc_reports (reported_by);
CREATE INDEX IF NOT EXISTS idx_ugc_reports_resolved_by ON public.ugc_reports (resolved_by);
CREATE INDEX IF NOT EXISTS idx_ugc_reports_message_id ON public.ugc_reports (message_id);
CREATE INDEX IF NOT EXISTS idx_ugc_reports_booking_id ON public.ugc_reports (booking_id);
CREATE INDEX IF NOT EXISTS idx_chat_user_blocks_blocked_by ON public.chat_user_blocks (blocked_by);
CREATE INDEX IF NOT EXISTS idx_chat_user_blocks_conversation_id ON public.chat_user_blocks (conversation_id);

ALTER TABLE public.ugc_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ugc_reports FROM PUBLIC, anon;
GRANT SELECT ON public.ugc_reports TO authenticated;
GRANT ALL ON public.ugc_reports TO service_role;

CREATE POLICY ugc_reports_admin_select ON public.ugc_reports FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));

CREATE POLICY ugc_reports_admin_write ON public.ugc_reports FOR UPDATE TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

DROP TRIGGER IF EXISTS trg_audit_ugc_reports ON public.ugc_reports;
CREATE TRIGGER trg_audit_ugc_reports
  AFTER INSERT OR UPDATE ON public.ugc_reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

DROP TRIGGER IF EXISTS trg_audit_chat_user_blocks ON public.chat_user_blocks;
CREATE TRIGGER trg_audit_chat_user_blocks
  AFTER INSERT ON public.chat_user_blocks
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

-- Review moderation hide (admin action)
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS moderation_hidden_at timestamptz NULL;

CREATE OR REPLACE FUNCTION public.tg_refresh_ratings_summary()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid;
BEGIN
  pid := COALESCE(NEW.provider_id, OLD.provider_id);
  INSERT INTO public.ratings_summary(provider_id, rating_avg, rating_count, updated_at)
  SELECT pid, COALESCE(AVG(rating),0)::numeric(3,2), COUNT(*), now()
  FROM public.reviews
  WHERE provider_id = pid AND moderation_hidden_at IS NULL
  ON CONFLICT (provider_id) DO UPDATE
    SET rating_avg = EXCLUDED.rating_avg, rating_count = EXCLUDED.rating_count, updated_at = now();
  RETURN NULL;
END; $$;

DROP POLICY IF EXISTS "reviews_public_read" ON public.reviews;
CREATE POLICY "reviews_public_read" ON public.reviews FOR SELECT TO anon, authenticated
  USING (
    moderation_hidden_at IS NULL
    OR public.has_role((SELECT auth.uid()), 'admin')
  );

CREATE OR REPLACE FUNCTION public.tg_guard_review_writes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.moderation_hidden_at IS DISTINCT FROM OLD.moderation_hidden_at THEN
    RAISE EXCEPTION 'Review moderation status can only be changed by an admin.' USING ERRCODE = '42501';
  END IF;

  IF NEW.booking_id IS DISTINCT FROM OLD.booking_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN
    RAISE EXCEPTION 'Review booking, customer, and provider cannot be changed.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.providers p
    WHERE p.id = OLD.provider_id AND p.profile_id = auth.uid()
  ) THEN
    IF NEW.rating IS DISTINCT FROM OLD.rating
       OR NEW.comment IS DISTINCT FROM OLD.comment
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Providers may only update the provider reply on a review.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.customer_id = auth.uid() THEN
    IF NEW.provider_reply IS DISTINCT FROM OLD.provider_reply
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Customers may only update rating and comment on their review.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Not allowed to update this review.' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.tg_guard_review_writes() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) RLS: hide blocked conversations from participants
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS conv_select ON public.conversations;
CREATE POLICY conv_select ON public.conversations FOR SELECT TO authenticated
USING (
  public.has_role((SELECT auth.uid()), 'admin')
  OR (
    hidden_at IS NULL
    AND (
      (SELECT auth.uid()) = customer_id
      OR (SELECT auth.uid()) = provider_user_id
    )
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = booking_id AND b.status <> 'pending'
    )
  )
);

-- ---------------------------------------------------------------------------
-- 4) Enforce blocks on message send
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_validate_booking_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_conv RECORD;
  v_status public.booking_status;
  v_role text;
  v_writable CONSTANT public.booking_status[] := ARRAY[
    'confirmed','on_the_way','arrived','arrival_confirmed','in_progress','completion_requested'
  ]::public.booking_status[];
  v_terminal CONSTANT public.booking_status[] := ARRAY[
    'completed','cancelled','no_show'
  ]::public.booking_status[];
BEGIN
  IF current_setting('app.system_message_in_progress', true) = 'on' THEN
    NEW.sender_id := NULL;
    NEW.sender_role := 'system';
    NEW.message_type := 'system';
    NEW.created_at := now();
    NEW.body := btrim(NEW.body);
    IF NEW.body = '' THEN
      RAISE EXCEPTION 'Message body cannot be empty.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT c.id, c.booking_id, c.customer_id, c.provider_user_id INTO v_conv
  FROM public.conversations c WHERE c.id = NEW.conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found.' USING ERRCODE = '42501';
  END IF;

  IF public.chat_pair_is_blocked(v_conv.customer_id, v_conv.provider_user_id) THEN
    RAISE EXCEPTION 'user_blocked' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status FROM public.bookings WHERE id = v_conv.booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = '42501';
  END IF;

  IF v_conv.customer_id = v_uid THEN
    v_role := 'customer';
  ELSIF v_conv.provider_user_id = v_uid THEN
    v_role := 'provider';
  ELSIF public.has_role(v_uid, 'admin') THEN
    v_role := 'admin';
  ELSE
    RAISE EXCEPTION 'You are not a participant in this booking chat.' USING ERRCODE = '42501';
  END IF;

  IF v_role IN ('customer', 'provider') THEN
    IF v_status = 'disputed' THEN
      RAISE EXCEPTION 'This booking is under dispute review. Only Famy support can send messages.' USING ERRCODE = '42501';
    ELSIF v_status = ANY(v_terminal) THEN
      RAISE EXCEPTION 'chat_closed' USING ERRCODE = '42501';
    ELSIF NOT (v_status = ANY(v_writable)) THEN
      RAISE EXCEPTION 'This booking chat is not open for new messages.' USING ERRCODE = '42501';
    END IF;
  ELSIF v_role = 'admin' THEN
    IF v_status = ANY(v_terminal) OR v_status = 'disputed' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Admin/support may only send messages on disputed bookings.' USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.sender_id := v_uid;
  NEW.sender_role := v_role;
  NEW.message_type := 'text';
  NEW.system_key := NULL;
  NEW.created_at := now();
  NEW.body := btrim(NEW.body);
  IF NEW.body = '' THEN
    RAISE EXCEPTION 'Message body cannot be empty.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_validate_booking_message() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_booking_reject_chat_block()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider_user uuid;
BEGIN
  SELECT profile_id INTO v_provider_user FROM public.providers WHERE id = NEW.provider_id;
  IF v_provider_user IS NOT NULL
     AND public.chat_pair_is_blocked(NEW.customer_id, v_provider_user) THEN
    RAISE EXCEPTION 'user_blocked' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_booking_reject_chat_block() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_booking_reject_chat_block ON public.bookings;
CREATE TRIGGER trg_booking_reject_chat_block
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_reject_chat_block();

-- ---------------------------------------------------------------------------
-- 5) RPCs: report, block, admin resolve / hide review
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_ugc(
  p_subject_type text,
  p_reason text,
  p_detail text DEFAULT NULL,
  p_message_id uuid DEFAULT NULL,
  p_conversation_id uuid DEFAULT NULL,
  p_review_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_conv RECORD;
  v_msg RECORD;
  v_review RECORD;
  v_booking_id uuid;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  IF p_subject_type NOT IN ('chat_message', 'chat_thread', 'review') THEN
    RAISE EXCEPTION 'Invalid subject type.' USING ERRCODE = '23514';
  END IF;
  IF p_reason NOT IN ('harassment', 'spam', 'inappropriate', 'other') THEN
    RAISE EXCEPTION 'Invalid report reason.' USING ERRCODE = '23514';
  END IF;

  IF p_subject_type IN ('chat_message', 'chat_thread') THEN
  IF p_conversation_id IS NULL THEN
      RAISE EXCEPTION 'Conversation required.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO v_conv FROM public.conversations WHERE id = p_conversation_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Conversation not found.' USING ERRCODE = '42501';
    END IF;
    IF v_conv.customer_id = v_uid THEN
      v_role := 'customer';
    ELSIF v_conv.provider_user_id = v_uid THEN
      v_role := 'provider';
    ELSE
      RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
    END IF;
    v_booking_id := v_conv.booking_id;

    IF p_subject_type = 'chat_message' THEN
      IF p_message_id IS NULL THEN
        RAISE EXCEPTION 'Message required.' USING ERRCODE = '23514';
      END IF;
      SELECT * INTO v_msg FROM public.messages
      WHERE id = p_message_id AND conversation_id = p_conversation_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Message not found.' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSE
    IF p_review_id IS NULL THEN
      RAISE EXCEPTION 'Review required.' USING ERRCODE = '23514';
    END IF;
    SELECT r.*, p.profile_id AS provider_profile_id INTO v_review
    FROM public.reviews r
    JOIN public.providers p ON p.id = r.provider_id
    WHERE r.id = p_review_id AND r.moderation_hidden_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Review not found.' USING ERRCODE = '42501';
    END IF;
    IF v_review.customer_id = v_uid THEN
      RAISE EXCEPTION 'Cannot report your own review.' USING ERRCODE = '42501';
    END IF;
    IF v_review.provider_profile_id = v_uid THEN
      v_role := 'provider';
    ELSE
      v_role := 'customer';
    END IF;
    v_booking_id := v_review.booking_id;
  END IF;

  SELECT r.id INTO v_id
  FROM public.ugc_reports r
  WHERE r.reported_by = v_uid
    AND r.subject_type = p_subject_type
    AND r.status = 'open'
    AND (
      (p_subject_type = 'chat_message' AND r.message_id = p_message_id)
      OR (p_subject_type = 'chat_thread' AND r.conversation_id = p_conversation_id)
      OR (p_subject_type = 'review' AND r.review_id = p_review_id)
    );

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.ugc_reports (
    subject_type, reason, detail, message_id, conversation_id, review_id, booking_id,
    reported_by, reporter_role
  ) VALUES (
    p_subject_type,
    p_reason,
    NULLIF(btrim(p_detail), ''),
    p_message_id,
    p_conversation_id,
    p_review_id,
    v_booking_id,
    v_uid,
    v_role
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.report_ugc(text, text, text, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_ugc(text, text, text, uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.block_chat_conversation(p_conversation_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_conv RECORD;
  v_block_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_conv FROM public.conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found.' USING ERRCODE = '42501';
  END IF;

  IF v_uid <> v_conv.customer_id AND v_uid <> v_conv.provider_user_id THEN
    RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.chat_user_blocks (
    customer_id, provider_user_id, blocked_by, conversation_id
  ) VALUES (
    v_conv.customer_id, v_conv.provider_user_id, v_uid, v_conv.id
  )
  ON CONFLICT (customer_id, provider_user_id) DO UPDATE
    SET blocked_by = EXCLUDED.blocked_by,
        conversation_id = EXCLUDED.conversation_id
  RETURNING id INTO v_block_id;

  UPDATE public.conversations
  SET hidden_at = COALESCE(hidden_at, now()),
      updated_at = now()
  WHERE id = p_conversation_id;

  RETURN v_block_id;
END;
$$;
REVOKE ALL ON FUNCTION public.block_chat_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.block_chat_conversation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_resolve_ugc_report(
  p_report_id uuid,
  p_status text,
  p_admin_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_report RECORD;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Invalid report status.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_report FROM public.ugc_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found.' USING ERRCODE = '42501';
  END IF;
  IF v_report.status <> 'open' THEN
    RAISE EXCEPTION 'Report is already closed.' USING ERRCODE = '23514';
  END IF;

  IF p_admin_notes IS NULL OR btrim(p_admin_notes) = '' THEN
    RAISE EXCEPTION 'Admin notes are required.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.ugc_reports SET
    status = p_status,
    admin_notes = btrim(p_admin_notes),
    resolved_by = v_uid,
    resolved_at = now()
  WHERE id = p_report_id;

  RETURN p_report_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_resolve_ugc_report(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_ugc_report(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_hide_ugc_review(
  p_review_id uuid,
  p_admin_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_admin_notes IS NULL OR btrim(p_admin_notes) = '' THEN
    RAISE EXCEPTION 'Admin notes are required.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.reviews
  SET moderation_hidden_at = now(),
      updated_at = now()
  WHERE id = p_review_id AND moderation_hidden_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review not found or already hidden.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_logs (
    actor_id, actor_role, action, entity, entity_id, booking_id, reason, diff
  )
  SELECT
    v_uid,
    'admin',
    'hide_review',
    'reviews',
    p_review_id,
    r.booking_id,
    btrim(p_admin_notes),
    jsonb_build_object('source', 'admin_hide_ugc_review')
  FROM public.reviews r
  WHERE r.id = p_review_id;

  RETURN p_review_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_hide_ugc_review(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_hide_ugc_review(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_ugc_reports()
RETURNS TABLE (
  id uuid,
  subject_type text,
  reason text,
  status text,
  message_id uuid,
  conversation_id uuid,
  review_id uuid,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id,
    r.subject_type,
    r.reason,
    r.status,
    r.message_id,
    r.conversation_id,
    r.review_id,
    r.created_at
  FROM public.ugc_reports r
  WHERE r.reported_by = auth.uid()
  ORDER BY r.created_at DESC
  LIMIT 50;
$$;
REVOKE ALL ON FUNCTION public.list_my_ugc_reports() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_ugc_reports() TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Admin work queue badge
-- ---------------------------------------------------------------------------
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
  SELECT 'ugc_reports'::text,
    (SELECT count(*) FROM public.ugc_reports u WHERE u.status = 'open')
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
      OR (b.status = 'in_progress' AND now() > b.start_at + (b.end_at - b.start_at) + interval '2 hours');
END;
$$;