-- Famy Patch 3 / Module 4: Notification Center core.
-- Additive only. Extends the existing public.notifications table (created
-- in 20260627001502, populated since 20260707095401) with bilingual
-- content, a category, a deep link, a first-class booking_id, and a
-- campaign_id placeholder for the admin campaigns module later in this
-- patch. Historical rows are preserved and backfilled; nothing is dropped.

-- ============================================================
-- 1) Columns. campaign_id has no FK yet — notification_campaigns doesn't
-- exist until a later migration in this module; the FK is added there.
-- ============================================================
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS title_en text,
  ADD COLUMN IF NOT EXISTS title_ar text,
  ADD COLUMN IF NOT EXISTS body_en text,
  ADD COLUMN IF NOT EXISTS body_ar text,
  ADD COLUMN IF NOT EXISTS deep_link text,
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS campaign_id uuid;

UPDATE public.notifications SET
  category = CASE WHEN type LIKE 'booking_%' THEN 'booking' ELSE 'system' END,
  title_en = title,
  body_en = body,
  booking_id = COALESCE(booking_id, NULLIF(payload->>'booking_id', '')::uuid)
WHERE category IS NULL;

ALTER TABLE public.notifications
  ALTER COLUMN category SET NOT NULL,
  ALTER COLUMN category SET DEFAULT 'system';

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_category_check
  CHECK (category IN ('booking','chat','reminder','support','campaign','system'));

CREATE INDEX IF NOT EXISTS idx_notifications_booking ON public.notifications(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(user_id) WHERE read_at IS NULL;

-- ============================================================
-- 2) Immutability. RLS + grants already restrict authenticated users to
-- SELECT/UPDATE on their own rows only (notif_self, 20260627001502) with
-- no INSERT grant — but nothing stopped a user from UPDATEing the content
-- of their own notification (e.g. rewriting title/body/payload) since the
-- policy only checks user_id. This trigger makes read_at the only mutable
-- column, matching the spec's "recipient, type, payload, timestamp are
-- immutable" requirement independent of future grant changes — same
-- defense-in-depth pattern as tg_block_message_mutation (20260714230000).
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_block_notification_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.title_en IS DISTINCT FROM OLD.title_en
     OR NEW.title_ar IS DISTINCT FROM OLD.title_ar
     OR NEW.body_en IS DISTINCT FROM OLD.body_en
     OR NEW.body_ar IS DISTINCT FROM OLD.body_ar
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.deep_link IS DISTINCT FROM OLD.deep_link
     OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Notification content is immutable; only read_at may change.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notifications_immutable ON public.notifications;
CREATE TRIGGER trg_notifications_immutable BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_notification_mutation();

-- ============================================================
-- 3) tg_booking_notify: full replace to populate the new bilingual
-- columns, category='booking', deep_link, and the first-class booking_id
-- column. Trigger conditions (guards against no-op/duplicate firing) are
-- byte-for-byte unchanged from 20260714230000 — only the INSERT payload
-- per branch gains the new fields. Legacy title/body still written so
-- existing client code (n.title/n.body) keeps working unchanged.
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_booking_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider_user uuid;
  v_customer_name text;
  v_service_name text;
  v_conversation_id uuid;
  v_customer_link text;
  v_provider_link text;
BEGIN
  SELECT profile_id INTO v_provider_user FROM public.providers WHERE id = NEW.provider_id;
  SELECT full_name INTO v_customer_name FROM public.profiles WHERE id = NEW.customer_id;
  SELECT name_en INTO v_service_name FROM public.services WHERE id = NEW.service_id;
  SELECT id INTO v_conversation_id FROM public.conversations WHERE booking_id = NEW.id;
  v_customer_link := '/booking/' || NEW.id;
  v_provider_link := '/pro/booking/' || NEW.id;

  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        v_provider_user, 'booking_request', 'booking',
        'New booking request',
        COALESCE(v_customer_name, 'A customer') || ' requested ' || COALESCE(v_service_name, 'a service'),
        'New booking request', 'طلب حجز جديد',
        COALESCE(v_customer_name, 'A customer') || ' requested ' || COALESCE(v_service_name, 'a service'),
        COALESCE(v_customer_name, 'عميل') || ' طلب ' || COALESCE(v_service_name, 'خدمة'),
        jsonb_build_object('booking_id', NEW.id), v_provider_link, NEW.id
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP <> 'UPDATE' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'confirmed' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      NEW.customer_id, 'booking_confirmed', 'booking',
      'Booking confirmed', 'Your booking has been accepted.',
      'Booking confirmed', 'تم تأكيد الحجز',
      'Your booking has been accepted.', 'تم قبول حجزك.',
      jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
    );
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Booking confirmed.', 'booking_confirmed');
    END IF;

  ELSIF NEW.status = 'on_the_way' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      NEW.customer_id, 'booking_on_the_way', 'booking',
      'Your provider is on the way', 'Your provider is heading to your location.',
      'Your provider is on the way', 'مزود الخدمة في الطريق إليك',
      'Your provider is heading to your location.', 'مزود الخدمة في طريقه إلى موقعك.',
      jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
    );
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Provider is on the way.', 'on_the_way');
    END IF;

  ELSIF NEW.status = 'arrived' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      NEW.customer_id, 'booking_arrived', 'booking',
      'Your provider has arrived', 'Your provider reported that they have arrived. Please confirm arrival in the app.',
      'Your provider has arrived', 'وصل مزود الخدمة',
      'Your provider reported that they have arrived. Please confirm arrival in the app.', 'أبلغ مزود الخدمة بوصوله. يرجى تأكيد الوصول في التطبيق.',
      jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
    );

  ELSIF NEW.status = 'arrival_confirmed' THEN
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        v_provider_user, 'booking_arrival_confirmed', 'booking',
        'Arrival confirmed', 'The customer confirmed your arrival. You can start the service.',
        'Arrival confirmed', 'تم تأكيد الوصول',
        'The customer confirmed your arrival. You can start the service.', 'أكد العميل وصولك. يمكنك بدء الخدمة.',
        jsonb_build_object('booking_id', NEW.id), v_provider_link, NEW.id
      );
    END IF;

  ELSIF NEW.status = 'in_progress' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      NEW.customer_id, 'booking_in_progress', 'booking',
      'Service started', 'Your service is now in progress.',
      'Service started', 'بدأت الخدمة',
      'Your service is now in progress.', 'خدمتك جارية الآن.',
      jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
    );
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Service started.', 'service_started');
    END IF;

  ELSIF NEW.status = 'completion_requested' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      NEW.customer_id, 'booking_completion_requested', 'booking',
      'Confirm your service', 'Your provider marked this booking as done. Please confirm to complete it.',
      'Confirm your service', 'أكّد إتمام الخدمة',
      'Your provider marked this booking as done. Please confirm to complete it.', 'أشار مزود الخدمة إلى اكتمال الحجز. يرجى التأكيد لإتمامه.',
      jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
    );
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Provider marked the service as complete. Awaiting customer confirmation.', 'completion_requested');
    END IF;

  ELSIF NEW.status = 'completed' THEN
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        v_provider_user, 'booking_completed', 'booking',
        'Booking completed', 'The customer confirmed the service is complete.',
        'Booking completed', 'اكتمل الحجز',
        'The customer confirmed the service is complete.', 'أكد العميل اكتمال الخدمة.',
        jsonb_build_object('booking_id', NEW.id), v_provider_link, NEW.id
      );
    END IF;
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Booking completed.', 'booking_completed');
    END IF;

  ELSIF NEW.status = 'disputed' THEN
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        v_provider_user, 'booking_disputed', 'booking',
        'Booking disputed', 'The customer disputed this booking''s completion. Our team will review it.',
        'Booking disputed', 'حجز محل نزاع',
        'The customer disputed this booking''s completion. Our team will review it.', 'اعترض العميل على إتمام هذا الحجز. سيقوم فريقنا بمراجعته.',
        jsonb_build_object('booking_id', NEW.id), v_provider_link, NEW.id
      );
    END IF;

  ELSIF NEW.status = 'no_show' THEN
    IF NEW.no_show_party = 'provider' AND v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        v_provider_user, 'booking_no_show', 'booking',
        'No-show reported', 'The customer reported that you did not show up for this booking.',
        'No-show reported', 'تم الإبلاغ عن عدم الحضور',
        'The customer reported that you did not show up for this booking.', 'أبلغ العميل بأنك لم تحضر لهذا الحجز.',
        jsonb_build_object('booking_id', NEW.id), v_provider_link, NEW.id
      );
    ELSIF NEW.no_show_party = 'customer' THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        NEW.customer_id, 'booking_no_show', 'booking',
        'No-show reported', 'Your provider reported that you were unavailable for this booking.',
        'No-show reported', 'تم الإبلاغ عن عدم الحضور',
        'Your provider reported that you were unavailable for this booking.', 'أبلغ مزود الخدمة بأنك لم تكن متاحًا لهذا الحجز.',
        jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
      );
    END IF;

  ELSIF NEW.status = 'cancelled' THEN
    IF OLD.status = 'pending' AND NEW.cancelled_by IS DISTINCT FROM NEW.customer_id THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        NEW.customer_id, 'booking_declined', 'booking',
        'Booking declined', 'Your booking request was not accepted. Please try another provider or time.',
        'Booking declined', 'تم رفض الحجز',
        'Your booking request was not accepted. Please try another provider or time.', 'لم يتم قبول طلب حجزك. يرجى تجربة مزود خدمة أو موعد آخر.',
        jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
      );
    ELSIF NEW.cancelled_by = NEW.customer_id THEN
      IF v_provider_user IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
        VALUES (
          v_provider_user, 'booking_cancelled', 'booking',
          'Booking cancelled', 'The customer cancelled this booking.',
          'Booking cancelled', 'تم إلغاء الحجز',
          'The customer cancelled this booking.', 'ألغى العميل هذا الحجز.',
          jsonb_build_object('booking_id', NEW.id), v_provider_link, NEW.id
        );
      END IF;
    ELSE
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        NEW.customer_id, 'booking_cancelled', 'booking',
        'Booking cancelled', 'Your booking was cancelled.',
        'Booking cancelled', 'تم إلغاء الحجز',
        'Your booking was cancelled.', 'تم إلغاء حجزك.',
        jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
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
