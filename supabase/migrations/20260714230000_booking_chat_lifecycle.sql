-- Famy Patch 3 / Module 3: Booking Chat Lifecycle.
-- Additive only. Extends the existing booking-scoped conversations/messages
-- tables (20260628223929) instead of creating a parallel system — that
-- table pair already is a 1:1-per-booking, party-only thread with contact
-- masking; it was just missing lifecycle-status gating, a sender-role/
-- message-type model, immutability guarantees, system messages, and
-- read-state. Nothing here touches existing rows, conversations, or the
-- general /messages list.

-- ============================================================
-- 1) messages: sender_role / message_type / system_key.
-- sender_id becomes nullable to represent system-authored rows (no acting
-- user). Backfill runs before the NOT NULL is added so existing rows are
-- classified from their conversation's known parties.
-- ============================================================
ALTER TABLE public.messages
  ALTER COLUMN sender_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS sender_role text,
  ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS system_key text;

UPDATE public.messages m
SET sender_role = CASE
  WHEN c.customer_id = m.sender_id THEN 'customer'
  WHEN c.provider_user_id = m.sender_id THEN 'provider'
  ELSE 'admin'
END
FROM public.conversations c
WHERE c.id = m.conversation_id AND m.sender_role IS NULL;

ALTER TABLE public.messages ALTER COLUMN sender_role SET NOT NULL;

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_sender_role_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_sender_role_check
  CHECK (sender_role IN ('customer','provider','admin','support','system'));

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN ('text','system'));

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_system_type_role_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_system_type_role_check
  CHECK ((message_type = 'system') = (sender_role = 'system'));

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_system_sender_null_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_system_sender_null_check
  CHECK ((sender_role = 'system') = (sender_id IS NULL));

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_system_key_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_system_key_check
  CHECK ((message_type = 'system') = (system_key IS NOT NULL));

-- ============================================================
-- 2) Defense-in-depth immutability. There is already no UPDATE/DELETE
-- GRANT to `authenticated` on this table (messages_admin_all's FOR ALL
-- policy is structurally inert without it), but a trigger makes the
-- guarantee explicit and independent of future grant changes — same
-- pattern as booking_cancellations (20260714220000).
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_block_message_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Booking chat messages are immutable.' USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS trg_messages_immutable ON public.messages;
CREATE TRIGGER trg_messages_immutable BEFORE UPDATE OR DELETE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_message_mutation();

-- ============================================================
-- 3) Server-authoritative send validation. Fires on every INSERT
-- regardless of path (direct client insert or any future RPC), so it is
-- the actual enforcement point — RLS below only gates broad table access.
--
-- Trusted system-message inserts are the one case that skip role/status
-- derivation: they're marked by a transaction-local flag set immediately
-- before the insert by tg_booking_notify (SECURITY DEFINER, runs with the
-- bypass-RLS privileges already relied on for `notifications` — see
-- 20260707095401). No authenticated client can set that flag.
-- ============================================================
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
    ELSIF NOT (v_status = ANY(v_writable)) THEN
      RAISE EXCEPTION 'This booking chat is not open for new messages.' USING ERRCODE = '42501';
    END IF;
  ELSIF v_role = 'admin' THEN
    IF v_status <> 'disputed' THEN
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

DROP TRIGGER IF EXISTS trg_messages_validate ON public.messages;
CREATE TRIGGER trg_messages_validate BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_booking_message();

-- ============================================================
-- 4) Read state — minimal, server-backed, self-only. A participant may
-- upsert only their own last_read_at for a booking they actually belong
-- to; unread counts are then derived by comparing this against
-- messages.created_at, never from client-local storage.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.booking_message_reads (
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, user_id)
);

GRANT SELECT, INSERT, UPDATE ON public.booking_message_reads TO authenticated;
GRANT ALL ON public.booking_message_reads TO service_role;
ALTER TABLE public.booking_message_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_message_reads_self" ON public.booking_message_reads;
CREATE POLICY "booking_message_reads_self" ON public.booking_message_reads FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND (
        b.customer_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.providers p WHERE p.id = b.provider_id AND p.profile_id = auth.uid())
        OR public.has_role(auth.uid(), 'admin')
      )
    )
  );

-- ============================================================
-- 5) System lifecycle messages. Full replace of tg_booking_notify
-- (20260712140000 body, unchanged) plus a chat-message insert alongside
-- each of the six lifecycle notifications the spec calls out. Guarded by
-- the same TG_OP/status-change checks already in this function, so a
-- no-op update never re-fires and never double-posts. Trigger
-- registration (trg_booking_notify, AFTER INSERT OR UPDATE OF status) is
-- unchanged. Bodies stay generic — no cancellation/dispute reason text —
-- per the no-internal-audit-data-in-chat rule.
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_booking_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider_user uuid;
  v_customer_name text;
  v_service_name text;
  v_conversation_id uuid;
BEGIN
  SELECT profile_id INTO v_provider_user FROM public.providers WHERE id = NEW.provider_id;
  SELECT full_name INTO v_customer_name FROM public.profiles WHERE id = NEW.customer_id;
  SELECT name_en INTO v_service_name FROM public.services WHERE id = NEW.service_id;
  SELECT id INTO v_conversation_id FROM public.conversations WHERE booking_id = NEW.id;

  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, payload)
      VALUES (
        v_provider_user, 'booking_request',
        'New booking request',
        COALESCE(v_customer_name, 'A customer') || ' requested ' || COALESCE(v_service_name, 'a service'),
        jsonb_build_object('booking_id', NEW.id)
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP <> 'UPDATE' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'confirmed' THEN
    INSERT INTO public.notifications (user_id, type, title, body, payload)
    VALUES (
      NEW.customer_id, 'booking_confirmed',
      'Booking confirmed',
      'Your booking has been accepted.',
      jsonb_build_object('booking_id', NEW.id)
    );
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Booking confirmed.', 'booking_confirmed');
    END IF;

  ELSIF NEW.status = 'on_the_way' THEN
    INSERT INTO public.notifications (user_id, type, title, body, payload)
    VALUES (
      NEW.customer_id, 'booking_on_the_way',
      'Your provider is on the way',
      'Your provider is heading to your location.',
      jsonb_build_object('booking_id', NEW.id)
    );
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Provider is on the way.', 'on_the_way');
    END IF;

  ELSIF NEW.status = 'arrived' THEN
    INSERT INTO public.notifications (user_id, type, title, body, payload)
    VALUES (
      NEW.customer_id, 'booking_arrived',
      'Your provider has arrived',
      'Your provider reported that they have arrived. Please confirm arrival in the app.',
      jsonb_build_object('booking_id', NEW.id)
    );

  ELSIF NEW.status = 'arrival_confirmed' THEN
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, payload)
      VALUES (
        v_provider_user, 'booking_arrival_confirmed',
        'Arrival confirmed',
        'The customer confirmed your arrival. You can start the service.',
        jsonb_build_object('booking_id', NEW.id)
      );
    END IF;

  ELSIF NEW.status = 'in_progress' THEN
    INSERT INTO public.notifications (user_id, type, title, body, payload)
    VALUES (
      NEW.customer_id, 'booking_in_progress',
      'Service started',
      'Your service is now in progress.',
      jsonb_build_object('booking_id', NEW.id)
    );
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Service started.', 'service_started');
    END IF;

  ELSIF NEW.status = 'completion_requested' THEN
    INSERT INTO public.notifications (user_id, type, title, body, payload)
    VALUES (
      NEW.customer_id, 'booking_completion_requested',
      'Confirm your service',
      'Your provider marked this booking as done. Please confirm to complete it.',
      jsonb_build_object('booking_id', NEW.id)
    );
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Provider marked the service as complete. Awaiting customer confirmation.', 'completion_requested');
    END IF;

  ELSIF NEW.status = 'completed' THEN
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, payload)
      VALUES (
        v_provider_user, 'booking_completed',
        'Booking completed',
        'The customer confirmed the service is complete.',
        jsonb_build_object('booking_id', NEW.id)
      );
    END IF;
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Booking completed.', 'booking_completed');
    END IF;

  ELSIF NEW.status = 'disputed' THEN
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, payload)
      VALUES (
        v_provider_user, 'booking_disputed',
        'Booking disputed',
        'The customer disputed this booking''s completion. Our team will review it.',
        jsonb_build_object('booking_id', NEW.id)
      );
    END IF;

  ELSIF NEW.status = 'no_show' THEN
    IF NEW.no_show_party = 'provider' AND v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, payload)
      VALUES (
        v_provider_user, 'booking_no_show',
        'No-show reported',
        'The customer reported that you did not show up for this booking.',
        jsonb_build_object('booking_id', NEW.id)
      );
    ELSIF NEW.no_show_party = 'customer' THEN
      INSERT INTO public.notifications (user_id, type, title, body, payload)
      VALUES (
        NEW.customer_id, 'booking_no_show',
        'No-show reported',
        'Your provider reported that you were unavailable for this booking.',
        jsonb_build_object('booking_id', NEW.id)
      );
    END IF;

  ELSIF NEW.status = 'cancelled' THEN
    IF OLD.status = 'pending' AND NEW.cancelled_by IS DISTINCT FROM NEW.customer_id THEN
      INSERT INTO public.notifications (user_id, type, title, body, payload)
      VALUES (
        NEW.customer_id, 'booking_declined',
        'Booking declined',
        'Your booking request was not accepted. Please try another provider or time.',
        jsonb_build_object('booking_id', NEW.id)
      );
    ELSIF NEW.cancelled_by = NEW.customer_id THEN
      IF v_provider_user IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, title, body, payload)
        VALUES (
          v_provider_user, 'booking_cancelled',
          'Booking cancelled',
          'The customer cancelled this booking.',
          jsonb_build_object('booking_id', NEW.id)
        );
      END IF;
    ELSE
      INSERT INTO public.notifications (user_id, type, title, body, payload)
      VALUES (
        NEW.customer_id, 'booking_cancelled',
        'Booking cancelled',
        'Your booking was cancelled.',
        jsonb_build_object('booking_id', NEW.id)
      );
    END IF;
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Booking cancelled.', 'booking_cancelled');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_booking_notify() FROM PUBLIC, anon, authenticated;
