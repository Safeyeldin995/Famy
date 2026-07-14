-- Famy Patch 3 / Module 4: server-authoritative push delivery outbox.
-- Additive only. No RLS policies are created for authenticated on this
-- table (RLS is enabled with zero policies => default deny), so customers
-- and providers cannot read it at all; only service_role (the delivery
-- worker) can. Clients can never enqueue arbitrary notifications because
-- rows are only ever created by the trigger below, off a notifications
-- INSERT — which is itself server-only (see notif_self / no INSERT grant).

CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','sent','failed','dead')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_safe text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_due
  ON public.notification_outbox(next_attempt_at) WHERE status IN ('queued','failed');
CREATE INDEX IF NOT EXISTS idx_notification_outbox_recipient
  ON public.notification_outbox(recipient_user_id);

GRANT ALL ON public.notification_outbox TO service_role;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

-- Enqueue on every notification insert, gated by the recipient's push
-- preference for that category. A missing preferences row (user never
-- opened Preferences) defaults to "push on" for every category except
-- campaign, matching notification_preferences' own column defaults.
CREATE OR REPLACE FUNCTION public.tg_enqueue_notification_outbox()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pref RECORD;
  v_push_enabled boolean;
BEGIN
  SELECT * INTO v_pref FROM public.notification_preferences WHERE user_id = NEW.user_id;
  IF NOT FOUND THEN
    v_push_enabled := (NEW.category <> 'campaign');
  ELSE
    v_push_enabled := CASE NEW.category
      WHEN 'booking' THEN v_pref.booking_push
      WHEN 'chat' THEN v_pref.chat_push
      WHEN 'reminder' THEN v_pref.reminder_push
      WHEN 'support' THEN v_pref.support_push
      WHEN 'campaign' THEN v_pref.campaign_push
      ELSE true
    END;
  END IF;

  IF v_push_enabled THEN
    INSERT INTO public.notification_outbox (idempotency_key, recipient_user_id, notification_id)
    VALUES (NEW.id::text, NEW.user_id, NEW.id)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_enqueue_notification_outbox() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notifications_enqueue_outbox ON public.notifications;
CREATE TRIGGER trg_notifications_enqueue_outbox AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_notification_outbox();
