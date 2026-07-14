-- Famy Patch 3 / Module 4: Admin notification campaigns.
-- Additive only. Draft creation is a plain admin-gated table write (RLS
-- already restricts it); activation/scheduling/cancellation and — most
-- importantly — recipient expansion into public.notifications are
-- SECURITY DEFINER RPCs so a client can never expand a campaign twice or
-- forge recipients/content outside what was drafted.

-- ============================================================
-- 1) Campaign table.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notification_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_en text NOT NULL CHECK (btrim(title_en) <> ''),
  title_ar text NOT NULL CHECK (btrim(title_ar) <> ''),
  body_en text NOT NULL CHECK (btrim(body_en) <> ''),
  body_ar text NOT NULL CHECK (btrim(body_ar) <> ''),
  target text NOT NULL CHECK (target IN ('customers','providers','all')),
  channel_push boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','cancelled')),
  scheduled_for timestamptz,
  recipient_count int,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CHECK (status <> 'scheduled' OR scheduled_for IS NOT NULL)
);
GRANT SELECT, INSERT, UPDATE ON public.notification_campaigns TO authenticated;
GRANT ALL ON public.notification_campaigns TO service_role;
ALTER TABLE public.notification_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_campaigns_admin_all ON public.notification_campaigns;
CREATE POLICY notification_campaigns_admin_all ON public.notification_campaigns FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_notification_campaigns_updated ON public.notification_campaigns;
CREATE TRIGGER trg_notification_campaigns_updated BEFORE UPDATE ON public.notification_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_audit_notification_campaigns ON public.notification_campaigns;
CREATE TRIGGER trg_audit_notification_campaigns AFTER INSERT OR UPDATE OR DELETE ON public.notification_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

-- Now that the table exists, wire the FK deferred from 20260714233000.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_campaign_id_fkey;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_campaign_id_fkey
  FOREIGN KEY (campaign_id) REFERENCES public.notification_campaigns(id) ON DELETE SET NULL;

-- ============================================================
-- 2) Recipient-count preview. Admin-only; mirrors the exact audience
-- expansion query used at send time so the preview is never a fake number.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_preview_campaign_audience(p_target text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin role required.' USING ERRCODE = '42501';
  END IF;
  IF p_target NOT IN ('customers','providers','all') THEN
    RAISE EXCEPTION 'Invalid target.' USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(DISTINCT ur.user_id) INTO v_count
  FROM public.user_roles ur
  WHERE ur.role = ANY (CASE p_target
      WHEN 'customers' THEN ARRAY['customer']::public.app_role[]
      WHEN 'providers' THEN ARRAY['provider']::public.app_role[]
      ELSE ARRAY['customer','provider']::public.app_role[]
    END);

  RETURN COALESCE(v_count, 0);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_preview_campaign_audience(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_preview_campaign_audience(text) TO authenticated;

-- ============================================================
-- 3) Idempotent recipient expansion. NOT EXISTS against notifications
-- (campaign_id, user_id) means re-invoking this for the same campaign
-- (retry, overlapping cron tick) never creates duplicate recipients.
-- In-app storage is inherent (this IS the insert into the in-app center);
-- push is a separate concern handled entirely by the outbox trigger below,
-- gated by both the campaign's own channel_push and the recipient's
-- personal preference.
-- ============================================================
CREATE OR REPLACE FUNCTION public.expand_campaign_recipients(p_campaign_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_c RECORD;
  v_count integer;
BEGIN
  SELECT * INTO v_c FROM public.notification_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, campaign_id)
  SELECT DISTINCT ur.user_id, 'campaign', 'campaign',
    v_c.title_en, v_c.body_en, v_c.title_en, v_c.title_ar, v_c.body_en, v_c.body_ar,
    jsonb_build_object('campaign_id', v_c.id), v_c.id
  FROM public.user_roles ur
  WHERE ur.role = ANY (CASE v_c.target
      WHEN 'customers' THEN ARRAY['customer']::public.app_role[]
      WHEN 'providers' THEN ARRAY['provider']::public.app_role[]
      ELSE ARRAY['customer','provider']::public.app_role[]
    END)
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n WHERE n.campaign_id = v_c.id AND n.user_id = ur.user_id
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.expand_campaign_recipients(uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 4) Admin actions. Activation sends immediately when there's no future
-- scheduled_for, otherwise parks the campaign as 'scheduled' for the cron
-- worker (process_due_campaigns) to expand later. Both paths are
-- idempotent because they claim the row (status transition guarded by
-- the current status in the WHERE clause) before expanding.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_activate_campaign(p_campaign_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_c RECORD;
  v_n integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin role required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_c FROM public.notification_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND OR v_c.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft campaign can be activated.' USING ERRCODE = '23514';
  END IF;

  IF v_c.scheduled_for IS NOT NULL AND v_c.scheduled_for > now() THEN
    UPDATE public.notification_campaigns SET status = 'scheduled' WHERE id = p_campaign_id;
    RETURN;
  END IF;

  UPDATE public.notification_campaigns SET status = 'sending' WHERE id = p_campaign_id;
  v_n := public.expand_campaign_recipients(p_campaign_id);
  UPDATE public.notification_campaigns
  SET status = 'sent', sent_at = now(), recipient_count = v_n
  WHERE id = p_campaign_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_activate_campaign(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_activate_campaign(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_cancel_campaign(p_campaign_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin role required.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.notification_campaigns SET status = 'cancelled'
  WHERE id = p_campaign_id AND status IN ('draft','scheduled');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a draft or scheduled campaign can be cancelled.' USING ERRCODE = '23514';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_cancel_campaign(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_campaign(uuid) TO authenticated;

-- Worker-only: cron/edge-function tick that fires due scheduled campaigns.
CREATE OR REPLACE FUNCTION public.process_due_campaigns()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_c RECORD;
  v_n integer;
  v_total integer := 0;
BEGIN
  FOR v_c IN
    SELECT * FROM public.notification_campaigns
    WHERE status = 'scheduled' AND scheduled_for <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.notification_campaigns SET status = 'sending' WHERE id = v_c.id;
    v_n := public.expand_campaign_recipients(v_c.id);
    UPDATE public.notification_campaigns
    SET status = 'sent', sent_at = now(), recipient_count = v_n
    WHERE id = v_c.id;
    v_total := v_total + v_n;
  END LOOP;
  RETURN v_total;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.process_due_campaigns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_due_campaigns() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'famy-process-due-campaigns') THEN
      PERFORM cron.unschedule('famy-process-due-campaigns');
    END IF;
    PERFORM cron.schedule('famy-process-due-campaigns', '* * * * *', 'SELECT public.process_due_campaigns();');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron scheduling skipped (%); schedule process_due_campaigns() externally.', SQLERRM;
END $$;

-- ============================================================
-- 5) Outbox gate now also honors the campaign's own channel_push choice,
-- not just the recipient's personal preference — an admin's "in-app only"
-- announcement must never push regardless of individual opt-ins.
-- ============================================================
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

  IF v_push_enabled AND NEW.category = 'campaign' AND NEW.campaign_id IS NOT NULL THEN
    v_push_enabled := EXISTS (
      SELECT 1 FROM public.notification_campaigns c WHERE c.id = NEW.campaign_id AND c.channel_push
    );
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
