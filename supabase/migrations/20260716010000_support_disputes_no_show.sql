-- Famy Patch 4 / Module 1: Support, Disputes, and No-Show workflows.
-- Additive only. Extends the existing support_tickets/ticket_messages pair
-- (20260627001502) instead of creating a parallel ticketing system — that
-- table pair already exists but has never been wired to any UI and its RLS
-- lets an opener silently resolve/delete/reassign their own case. Disputes
-- and no-shows reuse the booking_status enum's existing 'disputed'/'no_show'
-- values and bookkeeping columns (20260712130500 / 20260712140000) — this
-- migration adds the missing case-tracking layer (reason, description,
-- evidence, admin resolution, immutable history) on top, and moves every
-- write path for these three flows behind a SECURITY DEFINER RPC, exactly
-- like cancel_booking() already does for cancellations (20260714220000).
--
-- Normal cancellation enforcement (pending/confirmed only, via
-- cancel_booking) is untouched.

-- ============================================================
-- 1) support_tickets — extend with the fields Module 1 needs. `user_id`
-- (existing) is the opener; keep the column name (reuse, not rename) but
-- treat it as `opened_by` everywhere below.
-- ============================================================
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS opened_by_role text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS assigned_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution_notes text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

-- Existing rows (table has never been written to by any app code) get a
-- best-effort backfill so the NOT NULL below is safe; in practice this
-- affects zero rows today.
UPDATE public.support_tickets SET opened_by_role = 'customer' WHERE opened_by_role IS NULL;
UPDATE public.support_tickets SET category = 'other' WHERE category IS NULL;
UPDATE public.support_tickets SET description = subject WHERE description IS NULL;

-- booking_id becomes required (was nullable/SET NULL — no app code has ever
-- written a row, so this is safe); switch the FK action to CASCADE to match,
-- since a required column can never legally be nulled out by a delete.
ALTER TABLE public.support_tickets DROP CONSTRAINT IF EXISTS support_tickets_booking_id_fkey;
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_booking_id_fkey
  FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;

ALTER TABLE public.support_tickets
  ALTER COLUMN opened_by_role SET NOT NULL,
  ALTER COLUMN category SET NOT NULL,
  ALTER COLUMN description SET NOT NULL,
  ALTER COLUMN booking_id SET NOT NULL;

ALTER TABLE public.support_tickets DROP CONSTRAINT IF EXISTS support_tickets_opened_by_role_check;
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_opened_by_role_check
  CHECK (opened_by_role IN ('customer', 'provider'));

ALTER TABLE public.support_tickets DROP CONSTRAINT IF EXISTS support_tickets_category_check;
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_category_check
  CHECK (category IN ('payment', 'service_quality', 'provider_behavior', 'booking_issue', 'app_issue', 'other'));

-- One open/in-review case per (booking, opener, category) — belt-and-
-- suspenders duplicate-submission guard alongside the check inside
-- create_support_ticket() below.
CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_one_active_per_category
  ON public.support_tickets(booking_id, user_id, category) WHERE status IN ('open', 'pending');

-- Replace the original blanket policies: an opener previously had FOR ALL
-- (could resolve/delete/reassign their own ticket) and the *other* booking
-- party couldn't see it at all. Every write now goes through
-- create_support_ticket() (SECURITY DEFINER) or the admin-only UPDATE below.
DROP POLICY IF EXISTS "tickets_self" ON public.support_tickets;
DROP POLICY IF EXISTS "tickets_admin" ON public.support_tickets;

REVOKE INSERT, DELETE ON public.support_tickets FROM authenticated;
GRANT SELECT, UPDATE ON public.support_tickets TO authenticated;

CREATE POLICY support_tickets_party_read ON public.support_tickets FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND (
        b.customer_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.providers p WHERE p.id = b.provider_id AND p.profile_id = auth.uid())
      )
    )
  );

CREATE POLICY support_tickets_admin_update ON public.support_tickets FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Defense in depth: even an admin update can never rewrite the case's
-- identity/narrative fields, and resolving/closing always requires notes.
CREATE OR REPLACE FUNCTION public.tg_validate_support_ticket_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.booking_id IS DISTINCT FROM OLD.booking_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.opened_by_role IS DISTINCT FROM OLD.opened_by_role
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.subject IS DISTINCT FROM OLD.subject
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Support ticket case details are immutable.' USING ERRCODE = '42501';
  END IF;

  IF NEW.status NOT IN ('open', 'pending', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'Invalid support ticket status.' USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('resolved', 'closed') AND OLD.status NOT IN ('resolved', 'closed')
     AND (NEW.resolution_notes IS NULL OR btrim(NEW.resolution_notes) = '')
  THEN
    RAISE EXCEPTION 'Resolution notes are required to resolve or close a ticket.' USING ERRCODE = '23514';
  END IF;

  NEW.resolved_at := CASE
    WHEN NEW.status IN ('resolved', 'closed') AND OLD.status NOT IN ('resolved', 'closed') THEN now()
    WHEN NEW.status NOT IN ('resolved', 'closed') THEN NULL
    ELSE OLD.resolved_at
  END;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_validate_support_ticket_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_support_tickets_validate_update ON public.support_tickets;
CREATE TRIGGER trg_support_tickets_validate_update BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_support_ticket_update();

DROP TRIGGER IF EXISTS trg_audit_support_tickets ON public.support_tickets;
CREATE TRIGGER trg_audit_support_tickets AFTER INSERT OR UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

-- ============================================================
-- 2) ticket_messages — the case's event/history thread. Widen visibility
-- to both booking parties (previously only the ticket opener), and make
-- rows immutable (previously any party/admin could UPDATE/DELETE any
-- message on a ticket they could see, via the old FOR ALL policy).
-- ============================================================
ALTER TABLE public.ticket_messages
  ADD COLUMN IF NOT EXISTS author_role text;

UPDATE public.ticket_messages tm
SET author_role = CASE
  WHEN t.user_id = tm.author_id THEN t.opened_by_role
  ELSE 'admin'
END
FROM public.support_tickets t
WHERE t.id = tm.ticket_id AND tm.author_role IS NULL;

ALTER TABLE public.ticket_messages ALTER COLUMN author_role SET NOT NULL;
ALTER TABLE public.ticket_messages DROP CONSTRAINT IF EXISTS ticket_messages_author_role_check;
ALTER TABLE public.ticket_messages ADD CONSTRAINT ticket_messages_author_role_check
  CHECK (author_role IN ('customer', 'provider', 'admin'));

DROP POLICY IF EXISTS "tm_party" ON public.ticket_messages;
REVOKE UPDATE, DELETE ON public.ticket_messages FROM authenticated;
GRANT SELECT, INSERT ON public.ticket_messages TO authenticated;

CREATE POLICY ticket_messages_party_read ON public.ticket_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND (
        public.has_role(auth.uid(), 'admin')
        OR t.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.bookings b WHERE b.id = t.booking_id AND (
            b.customer_id = auth.uid()
            OR EXISTS (SELECT 1 FROM public.providers p WHERE p.id = b.provider_id AND p.profile_id = auth.uid())
          )
        )
      )
    )
  );

CREATE POLICY ticket_messages_party_insert ON public.ticket_messages FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND (
        public.has_role(auth.uid(), 'admin')
        OR t.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.bookings b WHERE b.id = t.booking_id AND (
            b.customer_id = auth.uid()
            OR EXISTS (SELECT 1 FROM public.providers p WHERE p.id = b.provider_id AND p.profile_id = auth.uid())
          )
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION public.tg_block_ticket_message_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Support ticket messages are immutable.' USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS trg_ticket_messages_immutable ON public.ticket_messages;
CREATE TRIGGER trg_ticket_messages_immutable BEFORE UPDATE OR DELETE ON public.ticket_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_ticket_message_mutation();

-- Server-authoritative author_role/timestamp + block new messages on a
-- closed case from anyone but admin (keeps the thread from reopening a
-- dead case; admin can still add a closing note).
CREATE OR REPLACE FUNCTION public.tg_validate_ticket_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ticket RECORD;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501'; END IF;

  SELECT t.id, t.status, t.user_id, t.booking_id INTO v_ticket
  FROM public.support_tickets t WHERE t.id = NEW.ticket_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support ticket not found.' USING ERRCODE = '42501'; END IF;

  IF public.has_role(v_uid, 'admin') THEN
    v_role := 'admin';
  ELSIF EXISTS (
    SELECT 1 FROM public.bookings b WHERE b.id = v_ticket.booking_id AND b.customer_id = v_uid
  ) THEN
    v_role := 'customer';
  ELSIF EXISTS (
    SELECT 1 FROM public.bookings b JOIN public.providers p ON p.id = b.provider_id
    WHERE b.id = v_ticket.booking_id AND p.profile_id = v_uid
  ) THEN
    v_role := 'provider';
  ELSE
    RAISE EXCEPTION 'You are not a participant in this support case.' USING ERRCODE = '42501';
  END IF;

  IF v_role <> 'admin' AND v_ticket.status IN ('resolved', 'closed') THEN
    RAISE EXCEPTION 'This support case is closed. Open a new request if you need further help.' USING ERRCODE = '42501';
  END IF;

  NEW.author_id := v_uid;
  NEW.author_role := v_role;
  NEW.created_at := now();
  NEW.body := btrim(NEW.body);
  IF NEW.body = '' THEN RAISE EXCEPTION 'Message body cannot be empty.' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_validate_ticket_message() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ticket_messages_validate ON public.ticket_messages;
CREATE TRIGGER trg_ticket_messages_validate BEFORE INSERT ON public.ticket_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_ticket_message();

-- ============================================================
-- 3) disputes — case record layered on top of the existing
-- bookings.status = 'disputed' value. One active dispute per booking;
-- snapshot fields are immutable once written.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  opened_by uuid NOT NULL REFERENCES auth.users(id),
  opened_by_role text NOT NULL CHECK (opened_by_role IN ('customer', 'provider')),
  previous_status public.booking_status NOT NULL,
  reason text NOT NULL,
  description text NOT NULL,
  evidence_paths text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'info_requested', 'resolved', 'rejected')),
  admin_notes text,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS disputes_one_active_per_booking
  ON public.disputes(booking_id) WHERE status IN ('open', 'info_requested');
CREATE INDEX IF NOT EXISTS idx_disputes_booking ON public.disputes(booking_id);

GRANT SELECT ON public.disputes TO authenticated;
GRANT ALL ON public.disputes TO service_role;
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;

-- No INSERT/UPDATE/DELETE policy for `authenticated` — every write goes
-- through open_booking_dispute() / admin_resolve_dispute() below, exactly
-- like booking_cancellations (20260714220000).
CREATE POLICY disputes_party_read ON public.disputes FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND (
        b.customer_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.providers p WHERE p.id = b.provider_id AND p.profile_id = auth.uid())
      )
    )
  );

CREATE OR REPLACE FUNCTION public.tg_validate_dispute_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.booking_id IS DISTINCT FROM OLD.booking_id
     OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
     OR NEW.opened_by_role IS DISTINCT FROM OLD.opened_by_role
     OR NEW.previous_status IS DISTINCT FROM OLD.previous_status
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.evidence_paths IS DISTINCT FROM OLD.evidence_paths
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Dispute case snapshot is immutable.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_disputes_validate_update ON public.disputes;
CREATE TRIGGER trg_disputes_validate_update BEFORE UPDATE ON public.disputes
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_dispute_update();

DROP TRIGGER IF EXISTS trg_audit_disputes ON public.disputes;
CREATE TRIGGER trg_audit_disputes AFTER INSERT OR UPDATE ON public.disputes
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

-- ============================================================
-- 4) no_show_reports — case record layered on top of the existing
-- bookings.status = 'no_show' value. Mirrors disputes.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.no_show_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  reported_by uuid NOT NULL REFERENCES auth.users(id),
  reporter_role text NOT NULL CHECK (reporter_role IN ('customer', 'provider')),
  reported_party text NOT NULL CHECK (reported_party IN ('customer', 'provider')),
  previous_status public.booking_status NOT NULL,
  reason text NOT NULL,
  evidence_paths text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'info_requested', 'resolved', 'rejected')),
  admin_notes text,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS no_show_reports_one_active_per_booking
  ON public.no_show_reports(booking_id) WHERE status IN ('open', 'info_requested');
CREATE INDEX IF NOT EXISTS idx_no_show_reports_booking ON public.no_show_reports(booking_id);

GRANT SELECT ON public.no_show_reports TO authenticated;
GRANT ALL ON public.no_show_reports TO service_role;
ALTER TABLE public.no_show_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY no_show_reports_party_read ON public.no_show_reports FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND (
        b.customer_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.providers p WHERE p.id = b.provider_id AND p.profile_id = auth.uid())
      )
    )
  );

CREATE OR REPLACE FUNCTION public.tg_validate_no_show_report_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.booking_id IS DISTINCT FROM OLD.booking_id
     OR NEW.reported_by IS DISTINCT FROM OLD.reported_by
     OR NEW.reporter_role IS DISTINCT FROM OLD.reporter_role
     OR NEW.reported_party IS DISTINCT FROM OLD.reported_party
     OR NEW.previous_status IS DISTINCT FROM OLD.previous_status
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.evidence_paths IS DISTINCT FROM OLD.evidence_paths
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'No-show case snapshot is immutable.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_no_show_reports_validate_update ON public.no_show_reports;
CREATE TRIGGER trg_no_show_reports_validate_update BEFORE UPDATE ON public.no_show_reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_no_show_report_update();

DROP TRIGGER IF EXISTS trg_audit_no_show_reports ON public.no_show_reports;
CREATE TRIGGER trg_audit_no_show_reports AFTER INSERT OR UPDATE ON public.no_show_reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

-- ============================================================
-- 5) case-evidence storage bucket — private, path convention
-- <booking_id>/<filename>, shared by disputes and no-show reports (neither
-- of the three existing private buckets fits: avatars/provider-documents
-- are identity documents, payment-proofs is customer-only-insert and
-- payment-specific).
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('case-evidence', 'case-evidence', false, 10485760, ARRAY['image/*', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS "case_evidence_party_insert" ON storage.objects;
CREATE POLICY "case_evidence_party_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'case-evidence'
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id::text = (storage.foldername(name))[1] AND (
        b.customer_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.providers p WHERE p.id = b.provider_id AND p.profile_id = auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "case_evidence_party_read" ON storage.objects;
CREATE POLICY "case_evidence_party_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'case-evidence'
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id::text = (storage.foldername(name))[1] AND (
        b.customer_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.providers p WHERE p.id = b.provider_id AND p.profile_id = auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "case_evidence_admin_all" ON storage.objects;
CREATE POLICY "case_evidence_admin_all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'case-evidence' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'case-evidence' AND public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 6) Widen the booking transition state machine (full replace, identical
-- to 20260714222000's body otherwise) so that:
--  a) dispute transitions are allowed for BOTH customer and provider, from
--     anywhere in on_the_way..completion_requested (previously: customer
--     only, from completion_requested only), gated behind
--     app.dispute_in_progress — settable only by open_booking_dispute().
--  b) no-show transitions keep their existing states/party rules, but are
--     now gated behind app.no_show_in_progress — settable only by
--     report_no_show() — so a no_show_reports row always exists alongside
--     the booking transition.
--  c) admin resolution of disputed/no_show -> completed/cancelled is gated
--     behind app.dispute_resolution_in_progress / app.no_show_resolution_in_progress
--     — settable only by admin_resolve_dispute() / admin_resolve_no_show() —
--     so a booking can no longer leave disputed/no_show via the generic
--     admin status dropdown without a resolved case record.
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_validate_booking_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_customer boolean := false;
  v_is_provider boolean := false;
  v_is_admin boolean := false;
  v_allowed boolean := false;
  v_changing boolean := (NEW.status IS DISTINCT FROM OLD.status);
  v_dispute_eligible CONSTANT public.booking_status[] := ARRAY[
    'on_the_way', 'arrived', 'arrival_confirmed', 'in_progress', 'completion_requested'
  ]::public.booking_status[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
     OR NEW.service_id IS DISTINCT FROM OLD.service_id
     OR NEW.address_id IS DISTINCT FROM OLD.address_id
     OR NEW.family_member_id IS DISTINCT FROM OLD.family_member_id
     OR NEW.price_subtotal IS DISTINCT FROM OLD.price_subtotal
     OR NEW.price_discount IS DISTINCT FROM OLD.price_discount
     OR NEW.price_total IS DISTINCT FROM OLD.price_total
     OR NEW.price_platform_fee IS DISTINCT FROM OLD.price_platform_fee
     OR NEW.price_vat IS DISTINCT FROM OLD.price_vat
     OR NEW.price_extras_total IS DISTINCT FROM OLD.price_extras_total
     OR NEW.price_travel_fee IS DISTINCT FROM OLD.price_travel_fee
     OR NEW.promo_code_id IS DISTINCT FROM OLD.promo_code_id
     OR NEW.promo_code IS DISTINCT FROM OLD.promo_code
     OR NEW.promo_discount_type IS DISTINCT FROM OLD.promo_discount_type
     OR NEW.promo_discount_value IS DISTINCT FROM OLD.promo_discount_value
     OR NEW.promo_description_en IS DISTINCT FROM OLD.promo_description_en
     OR NEW.promo_description_ar IS DISTINCT FROM OLD.promo_description_ar
  THEN
    RAISE EXCEPTION 'Booking customer, provider, service, address, family member, and pricing cannot be changed after creation.'
      USING ERRCODE = '42501';
  END IF;

  IF (NEW.start_at IS DISTINCT FROM OLD.start_at OR NEW.end_at IS DISTINCT FROM OLD.end_at)
     AND current_setting('app.reschedule_in_progress', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Booking schedule can only be changed through an accepted reschedule request.'
      USING ERRCODE = '42501';
  END IF;

  -- Normal cancellation (pending/confirmed) must go through cancel_booking().
  IF v_changing AND NEW.status = 'cancelled' AND OLD.status IN ('pending', 'confirmed')
     AND current_setting('app.cancellation_in_progress', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Bookings can only be cancelled through the cancel_booking function.'
      USING ERRCODE = '42501';
  END IF;

  IF v_changing THEN
    v_is_customer := (OLD.customer_id = v_uid);
    v_is_provider := EXISTS (SELECT 1 FROM public.providers p WHERE p.id = OLD.provider_id AND p.profile_id = v_uid);
    v_is_admin := public.has_role(v_uid, 'admin');

    IF v_is_admin AND (
         (OLD.status = 'disputed' AND NEW.status IN ('completed', 'cancelled') AND current_setting('app.dispute_resolution_in_progress', true) = 'on')
      OR (OLD.status = 'no_show' AND NEW.status IN ('completed', 'cancelled') AND current_setting('app.no_show_resolution_in_progress', true) = 'on')
      OR (OLD.status IN ('pending', 'confirmed') AND NEW.status = 'cancelled')
    ) THEN
      v_allowed := true;
    END IF;

    IF NOT v_allowed AND v_is_provider AND (
         (OLD.status = 'pending' AND NEW.status = 'confirmed')
      OR (OLD.status = 'pending' AND NEW.status = 'cancelled')
      OR (OLD.status = 'confirmed' AND NEW.status = 'on_the_way')
      OR (OLD.status = 'confirmed' AND NEW.status = 'cancelled')
      OR (OLD.status = 'on_the_way' AND NEW.status = 'arrived')
      OR (OLD.status = 'arrival_confirmed' AND NEW.status = 'in_progress')
      OR (OLD.status = 'in_progress' AND NEW.status = 'completion_requested')
    ) THEN
      v_allowed := true;
    END IF;

    IF NOT v_allowed AND v_is_customer AND (
         (OLD.status = 'pending' AND NEW.status = 'cancelled')
      OR (OLD.status = 'confirmed' AND NEW.status = 'cancelled')
      OR (OLD.status = 'arrived' AND NEW.status = 'arrival_confirmed')
      OR (OLD.status = 'completion_requested' AND NEW.status = 'completed')
    ) THEN
      v_allowed := true;
    END IF;

    -- Dispute: customer or provider, from anywhere in the active lifecycle
    -- through completion_requested, only via open_booking_dispute().
    IF NOT v_allowed AND (v_is_customer OR v_is_provider) AND NEW.status = 'disputed'
       AND OLD.status = ANY(v_dispute_eligible)
       AND current_setting('app.dispute_in_progress', true) = 'on'
    THEN
      v_allowed := true;
    END IF;

    -- No-show: customer reports provider, provider reports customer, only
    -- via report_no_show(). Eligible states unchanged from the pre-Module-1
    -- lifecycle (on_the_way, arrived).
    IF NOT v_allowed AND (
         (v_is_customer AND NEW.no_show_party = 'provider')
      OR (v_is_provider AND NEW.no_show_party = 'customer')
       )
       AND NEW.status = 'no_show'
       AND OLD.status IN ('on_the_way', 'arrived')
       AND current_setting('app.no_show_in_progress', true) = 'on'
    THEN
      v_allowed := true;
    END IF;

    IF NOT v_allowed THEN
      RAISE EXCEPTION 'Booking transition % -> % is not permitted for this user', OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.status_changed_at := CASE WHEN v_changing THEN now() ELSE OLD.status_changed_at END;
  NEW.status_changed_by := CASE WHEN v_changing THEN v_uid ELSE OLD.status_changed_by END;
  NEW.completion_requested_at := CASE WHEN v_changing AND NEW.status = 'completion_requested' THEN now() ELSE OLD.completion_requested_at END;
  NEW.completed_at := CASE WHEN v_changing AND NEW.status = 'completed' THEN now() ELSE OLD.completed_at END;

  IF v_changing AND NEW.status = 'arrival_confirmed' THEN
    NEW.arrival_confirmed_at := now(); NEW.arrival_confirmed_by := v_uid;
  ELSE
    NEW.arrival_confirmed_at := OLD.arrival_confirmed_at; NEW.arrival_confirmed_by := OLD.arrival_confirmed_by;
  END IF;

  IF v_changing AND NEW.status = 'cancelled' THEN
    NEW.cancelled_at := now(); NEW.cancelled_by := v_uid;
  ELSE
    NEW.cancelled_at := OLD.cancelled_at; NEW.cancelled_by := OLD.cancelled_by; NEW.cancellation_reason := OLD.cancellation_reason;
  END IF;

  IF v_changing AND NEW.status = 'no_show' THEN
    NEW.no_show_reported_by := v_uid;
  ELSE
    NEW.no_show_party := OLD.no_show_party; NEW.no_show_reported_by := OLD.no_show_reported_by; NEW.no_show_reason := OLD.no_show_reason;
  END IF;

  IF v_changing AND NEW.status = 'disputed' THEN
    NEW.disputed_at := now();
  ELSE
    NEW.disputed_at := OLD.disputed_at; NEW.dispute_reason := OLD.dispute_reason;
  END IF;

  IF v_changing AND v_is_admin AND OLD.status = 'disputed' AND NEW.status IN ('completed', 'cancelled') THEN
    NEW.dispute_resolved_at := now(); NEW.dispute_resolved_by := v_uid;
  ELSE
    NEW.dispute_resolved_at := OLD.dispute_resolved_at; NEW.dispute_resolved_by := OLD.dispute_resolved_by;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_validate_booking_transition() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 7) create_support_ticket — the one write path for opening a case.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_support_ticket(
  p_booking_id uuid, p_category text, p_subject text, p_description text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_booking RECORD;
  v_role text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.' USING ERRCODE = '42501'; END IF;

  IF v_booking.customer_id = v_uid THEN
    v_role := 'customer';
  ELSIF EXISTS (SELECT 1 FROM public.providers p WHERE p.id = v_booking.provider_id AND p.profile_id = v_uid) THEN
    v_role := 'provider';
  ELSE
    RAISE EXCEPTION 'You are not a participant in this booking.' USING ERRCODE = '42501';
  END IF;

  IF p_category NOT IN ('payment', 'service_quality', 'provider_behavior', 'booking_issue', 'app_issue', 'other') THEN
    RAISE EXCEPTION 'Invalid ticket category.' USING ERRCODE = '23514';
  END IF;
  IF p_subject IS NULL OR btrim(p_subject) = '' THEN
    RAISE EXCEPTION 'A subject is required.' USING ERRCODE = '23514';
  END IF;
  IF p_description IS NULL OR length(btrim(p_description)) < 10 THEN
    RAISE EXCEPTION 'Please provide a more detailed description.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.support_tickets
    WHERE booking_id = p_booking_id AND user_id = v_uid AND category = p_category AND status IN ('open', 'pending')
  ) THEN
    RAISE EXCEPTION 'You already have an open support request in this category for this booking.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.support_tickets (booking_id, user_id, opened_by_role, category, subject, description)
  VALUES (p_booking_id, v_uid, v_role, p_category, btrim(p_subject), btrim(p_description))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_support_ticket(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(uuid, text, text, text) TO authenticated;

-- ============================================================
-- 8) open_booking_dispute — the one write path for opening a dispute.
-- ============================================================
CREATE OR REPLACE FUNCTION public.open_booking_dispute(
  p_booking_id uuid, p_reason text, p_description text, p_evidence_paths text[] DEFAULT '{}'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_booking RECORD;
  v_role text;
  v_id uuid;
  v_eligible CONSTANT public.booking_status[] := ARRAY[
    'on_the_way', 'arrived', 'arrival_confirmed', 'in_progress', 'completion_requested'
  ]::public.booking_status[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.' USING ERRCODE = '42501'; END IF;

  IF v_booking.customer_id = v_uid THEN
    v_role := 'customer';
  ELSIF EXISTS (SELECT 1 FROM public.providers p WHERE p.id = v_booking.provider_id AND p.profile_id = v_uid) THEN
    v_role := 'provider';
  ELSE
    RAISE EXCEPTION 'You are not authorized to dispute this booking.' USING ERRCODE = '42501';
  END IF;

  IF NOT (v_booking.status = ANY(v_eligible)) THEN
    RAISE EXCEPTION 'This booking cannot be disputed in its current status.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (SELECT 1 FROM public.disputes WHERE booking_id = p_booking_id AND status IN ('open', 'info_requested')) THEN
    RAISE EXCEPTION 'This booking already has an active dispute.' USING ERRCODE = '23514';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required.' USING ERRCODE = '23514';
  END IF;
  IF p_description IS NULL OR length(btrim(p_description)) < 10 THEN
    RAISE EXCEPTION 'Please provide a more detailed description.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_evidence_paths, '{}')) AS ep(path)
    WHERE left(ep.path, length(p_booking_id::text) + 1) IS DISTINCT FROM (p_booking_id::text || '/')
  ) THEN
    RAISE EXCEPTION 'Evidence must belong to this booking.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.dispute_in_progress', 'on', true);
  UPDATE public.bookings SET status = 'disputed', dispute_reason = btrim(p_reason) WHERE id = p_booking_id;

  INSERT INTO public.disputes (
    booking_id, opened_by, opened_by_role, previous_status, reason, description, evidence_paths
  ) VALUES (
    p_booking_id, v_uid, v_role, v_booking.status, btrim(p_reason), btrim(p_description), COALESCE(p_evidence_paths, '{}')
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.open_booking_dispute(uuid, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_booking_dispute(uuid, text, text, text[]) TO authenticated;

-- ============================================================
-- 9) report_no_show — the one write path for reporting a no-show. The
-- reported party is always derived from the reporter's own role, never
-- trusted from the client.
-- ============================================================
CREATE OR REPLACE FUNCTION public.report_no_show(
  p_booking_id uuid, p_reason text, p_evidence_paths text[] DEFAULT '{}'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_booking RECORD;
  v_role text;
  v_reported_party text;
  v_id uuid;
  v_eligible CONSTANT public.booking_status[] := ARRAY['on_the_way', 'arrived']::public.booking_status[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.' USING ERRCODE = '42501'; END IF;

  IF v_booking.customer_id = v_uid THEN
    v_role := 'customer'; v_reported_party := 'provider';
  ELSIF EXISTS (SELECT 1 FROM public.providers p WHERE p.id = v_booking.provider_id AND p.profile_id = v_uid) THEN
    v_role := 'provider'; v_reported_party := 'customer';
  ELSE
    RAISE EXCEPTION 'You are not authorized to report this booking.' USING ERRCODE = '42501';
  END IF;

  IF NOT (v_booking.status = ANY(v_eligible)) THEN
    RAISE EXCEPTION 'A no-show can only be reported while the provider is on the way or has arrived.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (SELECT 1 FROM public.no_show_reports WHERE booking_id = p_booking_id AND status IN ('open', 'info_requested')) THEN
    RAISE EXCEPTION 'This booking already has an active no-show report.' USING ERRCODE = '23514';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_evidence_paths, '{}')) AS ep(path)
    WHERE left(ep.path, length(p_booking_id::text) + 1) IS DISTINCT FROM (p_booking_id::text || '/')
  ) THEN
    RAISE EXCEPTION 'Evidence must belong to this booking.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.no_show_in_progress', 'on', true);
  UPDATE public.bookings SET status = 'no_show', no_show_party = v_reported_party, no_show_reason = btrim(p_reason) WHERE id = p_booking_id;

  INSERT INTO public.no_show_reports (
    booking_id, reported_by, reporter_role, reported_party, previous_status, reason, evidence_paths
  ) VALUES (
    p_booking_id, v_uid, v_role, v_reported_party, v_booking.status, btrim(p_reason), COALESCE(p_evidence_paths, '{}')
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.report_no_show(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_no_show(uuid, text, text[]) TO authenticated;

-- ============================================================
-- 10) admin_resolve_dispute / admin_resolve_no_show — the one write path
-- for admin case resolution. Never touches payments/wallets/penalties;
-- p_booking_status (if given) only ever moves disputed/no_show -> completed
-- or cancelled, mirroring what the pre-Module-1 admin dropdown could
-- already do to those two statuses.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_resolve_dispute(
  p_dispute_id uuid, p_status text, p_admin_notes text DEFAULT NULL, p_booking_status text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_dispute RECORD;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('info_requested', 'resolved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid dispute status.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_dispute FROM public.disputes WHERE id = p_dispute_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dispute not found.' USING ERRCODE = '42501'; END IF;
  IF v_dispute.status IN ('resolved', 'rejected') THEN
    RAISE EXCEPTION 'This dispute has already been closed.' USING ERRCODE = '23514';
  END IF;

  IF p_status IN ('resolved', 'rejected') AND (p_admin_notes IS NULL OR btrim(p_admin_notes) = '') THEN
    RAISE EXCEPTION 'Resolution notes are required to resolve or reject a dispute.' USING ERRCODE = '23514';
  END IF;

  IF p_booking_status IS NOT NULL THEN
    IF p_status NOT IN ('resolved', 'rejected') THEN
      RAISE EXCEPTION 'Booking status can only be set when resolving or rejecting a dispute.' USING ERRCODE = '23514';
    END IF;
    IF p_booking_status NOT IN ('completed', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid booking resolution status.' USING ERRCODE = '23514';
    END IF;
    PERFORM set_config('app.dispute_resolution_in_progress', 'on', true);
    UPDATE public.bookings SET status = p_booking_status::public.booking_status
      WHERE id = v_dispute.booking_id AND status = 'disputed';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Booking is no longer in disputed status.' USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.disputes SET
    status = p_status,
    admin_notes = COALESCE(NULLIF(btrim(p_admin_notes), ''), admin_notes),
    resolved_by = CASE WHEN p_status IN ('resolved', 'rejected') THEN v_uid ELSE resolved_by END,
    resolved_at = CASE WHEN p_status IN ('resolved', 'rejected') THEN now() ELSE resolved_at END,
    updated_at = now()
  WHERE id = p_dispute_id;

  RETURN p_dispute_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_resolve_dispute(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_dispute(uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_resolve_no_show(
  p_report_id uuid, p_status text, p_admin_notes text DEFAULT NULL, p_booking_status text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_report RECORD;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('info_requested', 'resolved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid no-show report status.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_report FROM public.no_show_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No-show report not found.' USING ERRCODE = '42501'; END IF;
  IF v_report.status IN ('resolved', 'rejected') THEN
    RAISE EXCEPTION 'This no-show report has already been closed.' USING ERRCODE = '23514';
  END IF;

  IF p_status IN ('resolved', 'rejected') AND (p_admin_notes IS NULL OR btrim(p_admin_notes) = '') THEN
    RAISE EXCEPTION 'Resolution notes are required to resolve or reject a no-show report.' USING ERRCODE = '23514';
  END IF;

  IF p_booking_status IS NOT NULL THEN
    IF p_status NOT IN ('resolved', 'rejected') THEN
      RAISE EXCEPTION 'Booking status can only be set when resolving or rejecting a no-show report.' USING ERRCODE = '23514';
    END IF;
    IF p_booking_status NOT IN ('completed', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid booking resolution status.' USING ERRCODE = '23514';
    END IF;
    PERFORM set_config('app.no_show_resolution_in_progress', 'on', true);
    UPDATE public.bookings SET status = p_booking_status::public.booking_status
      WHERE id = v_report.booking_id AND status = 'no_show';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Booking is no longer in no-show status.' USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.no_show_reports SET
    status = p_status,
    admin_notes = COALESCE(NULLIF(btrim(p_admin_notes), ''), admin_notes),
    resolved_by = CASE WHEN p_status IN ('resolved', 'rejected') THEN v_uid ELSE resolved_by END,
    resolved_at = CASE WHEN p_status IN ('resolved', 'rejected') THEN now() ELSE resolved_at END,
    updated_at = now()
  WHERE id = p_report_id;

  RETURN p_report_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_resolve_no_show(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_no_show(uuid, text, text, text) TO authenticated;
