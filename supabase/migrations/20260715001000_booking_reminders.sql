-- Famy Patch 3 / Module 4: booking reminders.
-- Additive only. Picks up exactly where 20260713180000's header note left
-- off ("Reminder scheduling is explicitly out of scope ... a dedicated
-- later module owns that and will hook into accept_reschedule() once it
-- exists"). Rather than editing respond_reschedule()/admin_resolve_reschedule()
-- (already-applied migrations), this hooks a generic AFTER trigger on
-- bookings(start_at, status) — respond_reschedule's plain `UPDATE
-- public.bookings SET start_at = ...` already fires it, so no reschedule
-- function needs to change.

-- ============================================================
-- 1) Admin-configurable lead-time rules. No rule => no reminder, per spec
-- ("Do not invent fixed business timing when no approved setting exists").
-- ============================================================
CREATE TABLE IF NOT EXISTS public.booking_reminder_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_minutes int NOT NULL CHECK (lead_minutes > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_minutes)
);
GRANT SELECT ON public.booking_reminder_rules TO authenticated;
GRANT ALL ON public.booking_reminder_rules TO service_role;
ALTER TABLE public.booking_reminder_rules ENABLE ROW LEVEL SECURITY;

-- GRANT SELECT above is scoped to admins in practice: RLS still filters
-- every row to has_role(admin), matching every other admin_all policy.
DROP POLICY IF EXISTS booking_reminder_rules_admin_all ON public.booking_reminder_rules;
CREATE POLICY booking_reminder_rules_admin_all ON public.booking_reminder_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_booking_reminder_rules_updated ON public.booking_reminder_rules;
CREATE TRIGGER trg_booking_reminder_rules_updated BEFORE UPDATE ON public.booking_reminder_rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_audit_booking_reminder_rules ON public.booking_reminder_rules;
CREATE TRIGGER trg_audit_booking_reminder_rules AFTER INSERT OR UPDATE OR DELETE ON public.booking_reminder_rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

-- ============================================================
-- 2) Scheduled reminder instances. One row per (booking, rule, recipient),
-- enforced idempotent by the unique constraint — recompute always upserts
-- the same row rather than inserting a duplicate.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.booking_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.booking_reminder_rules(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','cancelled')),
  notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, rule_id, recipient_user_id)
);
CREATE INDEX IF NOT EXISTS idx_booking_reminders_due
  ON public.booking_reminders(scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_booking_reminders_booking ON public.booking_reminders(booking_id);

-- No client access at all: reminders are purely server-scheduled/read by
-- the worker, and their existence isn't meaningful UI state for either party.
GRANT ALL ON public.booking_reminders TO service_role;
ALTER TABLE public.booking_reminders ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_booking_reminders_updated ON public.booking_reminders;
CREATE TRIGGER trg_booking_reminders_updated BEFORE UPDATE ON public.booking_reminders
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- 3) Scheduling trigger. Recomputes reminders whenever a booking becomes
-- (or remains) confirmed with a future start_at — covering initial
-- confirmation, and reschedules via respond_reschedule/admin_resolve_reschedule
-- (both do plain UPDATEs on start_at). Any other status transition
-- (cancelled, completed, on_the_way, etc.) suppresses pending reminders,
-- satisfying "cancellation and terminal states suppress pending reminders."
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_schedule_booking_reminders()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider_user uuid;
  v_rule RECORD;
  v_scheduled timestamptz;
BEGIN
  IF NEW.status = 'confirmed' AND NEW.start_at > now() THEN
    SELECT profile_id INTO v_provider_user FROM public.providers WHERE id = NEW.provider_id;

    FOR v_rule IN SELECT * FROM public.booking_reminder_rules WHERE is_active LOOP
      v_scheduled := NEW.start_at - make_interval(mins => v_rule.lead_minutes);
      IF v_scheduled > now() THEN
        INSERT INTO public.booking_reminders (booking_id, rule_id, recipient_user_id, scheduled_for, status, notification_id)
        VALUES (NEW.id, v_rule.id, NEW.customer_id, v_scheduled, 'pending', NULL)
        ON CONFLICT (booking_id, rule_id, recipient_user_id) DO UPDATE SET
          scheduled_for = EXCLUDED.scheduled_for, status = 'pending', notification_id = NULL;

        IF v_provider_user IS NOT NULL THEN
          INSERT INTO public.booking_reminders (booking_id, rule_id, recipient_user_id, scheduled_for, status, notification_id)
          VALUES (NEW.id, v_rule.id, v_provider_user, v_scheduled, 'pending', NULL)
          ON CONFLICT (booking_id, rule_id, recipient_user_id) DO UPDATE SET
            scheduled_for = EXCLUDED.scheduled_for, status = 'pending', notification_id = NULL;
        END IF;
      ELSE
        -- Lead time no longer fits before start_at (e.g. rescheduled to very soon).
        UPDATE public.booking_reminders SET status = 'cancelled'
        WHERE booking_id = NEW.id AND rule_id = v_rule.id AND status = 'pending';
      END IF;
    END LOOP;
  ELSE
    UPDATE public.booking_reminders SET status = 'cancelled'
    WHERE booking_id = NEW.id AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_schedule_booking_reminders() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_schedule_booking_reminders ON public.bookings;
CREATE TRIGGER trg_schedule_booking_reminders AFTER INSERT OR UPDATE OF start_at, status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_schedule_booking_reminders();

-- ============================================================
-- 4) Due-reminder processor. Idempotent (claims rows with FOR UPDATE SKIP
-- LOCKED and flips them to 'sent' in the same pass), defensively re-checks
-- the booking is still confirmed/future before firing (belt-and-braces —
-- the scheduling trigger should already have cancelled otherwise). Each
-- fire inserts one notifications row (category='reminder'), which the
-- existing outbox trigger (20260714235000) then enqueues for push exactly
-- like any other notification — no separate delivery path needed.
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_due_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row RECORD;
  v_count integer := 0;
  v_booking RECORD;
  v_service_name text;
  v_link text;
BEGIN
  FOR v_row IN
    SELECT * FROM public.booking_reminders
    WHERE status = 'pending' AND scheduled_for <= now()
    ORDER BY scheduled_for
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT * INTO v_booking FROM public.bookings WHERE id = v_row.booking_id;
    IF NOT FOUND OR v_booking.status <> 'confirmed' OR v_booking.start_at <= now() THEN
      UPDATE public.booking_reminders SET status = 'cancelled' WHERE id = v_row.id;
      CONTINUE;
    END IF;

    SELECT name_en INTO v_service_name FROM public.services WHERE id = v_booking.service_id;
    v_link := CASE WHEN v_row.recipient_user_id = v_booking.customer_id
                THEN '/booking/' || v_booking.id ELSE '/pro/booking/' || v_booking.id END;

    WITH inserted AS (
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        v_row.recipient_user_id, 'booking_reminder', 'reminder',
        'Upcoming booking', 'You have an upcoming ' || COALESCE(v_service_name, 'booking') || '.',
        'Upcoming booking', 'حجز قادم',
        'You have an upcoming ' || COALESCE(v_service_name, 'booking') || '.',
        'لديك حجز قادم' || CASE WHEN v_service_name IS NOT NULL THEN ' لخدمة ' || v_service_name ELSE '' END || '.',
        jsonb_build_object('booking_id', v_booking.id), v_link, v_booking.id
      )
      RETURNING id
    )
    UPDATE public.booking_reminders SET status = 'sent', notification_id = (SELECT id FROM inserted)
    WHERE id = v_row.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.process_due_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_due_reminders() TO service_role;

-- ============================================================
-- 5) Best-effort pg_cron schedule so reminders fire without the app open
-- or any external caller. Wrapped so environments where pg_cron can't be
-- created (permissions/tier) don't fail this migration — reminders still
-- work correctly once process_due_reminders() is invoked by any scheduler.
-- ============================================================
DO $$
BEGIN
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron extension unavailable (%); schedule process_due_reminders() externally.', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'famy-process-due-reminders') THEN
      PERFORM cron.unschedule('famy-process-due-reminders');
    END IF;
    PERFORM cron.schedule('famy-process-due-reminders', '* * * * *', 'SELECT public.process_due_reminders();');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron scheduling skipped (%); schedule process_due_reminders() externally.', SQLERRM;
END $$;
