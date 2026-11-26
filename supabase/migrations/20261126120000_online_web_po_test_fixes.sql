-- Online web fixes (PO test 26 Nov):
-- 1) booking_provider_card: a participant-only summary of the booking's provider
--    (name, photo, rating). The lesson page used marketplace_provider_details,
--    which refuses any account with the provider role, so tutors could not open
--    their own lesson page (repeated 403s in the logs).
-- 2) tg_booking_notify (latest body from 20261112130000): online bookings link to
--    /online/lessons/<id>; the customer gets "request sent"; online "accepted" asks
--    the student to pay; the provider message for a cancelled pending request says so.
-- 3) The customer gets a notification when they cancel, with the fee (known only
--    once booking_cancellations is written, after the status change).

CREATE OR REPLACE FUNCTION public.booking_provider_card(p_booking_id uuid)
RETURNS TABLE (
  provider_id uuid,
  full_name text,
  avatar_url text,
  rating_avg numeric,
  rating_count bigint
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
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.providers p ON p.id = b.provider_id
    WHERE b.id = p_booking_id
      AND (b.customer_id = v_uid OR p.profile_id = v_uid OR public.has_role(v_uid, 'admin'))
  ) THEN
    RAISE EXCEPTION 'Not a participant of this booking' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    pr.full_name,
    pr.avatar_url,
    COALESCE(rs.rating_avg, 0)::numeric,
    COALESCE(rs.rating_count, 0)::bigint
  FROM public.bookings b
  JOIN public.providers p ON p.id = b.provider_id
  JOIN public.profiles pr ON pr.id = p.profile_id
  LEFT JOIN public.ratings_summary rs ON rs.provider_id = p.id
  WHERE b.id = p_booking_id;
END;
$$;

REVOKE ALL ON FUNCTION public.booking_provider_card(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_provider_card(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_booking_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider_user uuid;
  v_customer_name text;
  v_service_name text;
  v_service_name_ar text;
  v_is_online boolean;
  v_conversation_id uuid;
  v_customer_link text;
  v_provider_link text;
  v_auto_hours numeric;
  v_auto_hours_n integer;
  v_hours_en text;
  v_hours_ar text;
BEGIN
  SELECT profile_id INTO v_provider_user FROM public.providers WHERE id = NEW.provider_id;
  SELECT full_name INTO v_customer_name FROM public.profiles WHERE id = NEW.customer_id;
  SELECT name_en, name_ar INTO v_service_name, v_service_name_ar FROM public.services WHERE id = NEW.service_id;
  v_is_online := COALESCE(NEW.service_mode, 'in_person') = 'online';
  SELECT id INTO v_conversation_id FROM public.conversations WHERE booking_id = NEW.id;
  -- Online lessons live on the /online web surface; the mobile apps map this
  -- path to their own booking screens (mapNotificationDeepLink).
  IF v_is_online THEN
    v_customer_link := '/online/lessons/' || NEW.id;
    v_provider_link := '/online/lessons/' || NEW.id;
  ELSE
    v_customer_link := '/booking/' || NEW.id;
    v_provider_link := '/pro/booking/' || NEW.id;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        v_provider_user, 'booking_request', 'booking',
        'New booking request',
        COALESCE(v_customer_name, 'A customer') || ' requested ' || COALESCE(v_service_name, 'a service'),
        'New booking request', 'طلب حجز جديد',
        COALESCE(v_customer_name, 'A customer') || ' requested ' || COALESCE(v_service_name, 'a service'),
        COALESCE(v_customer_name, 'عميل') || ' طلب ' || COALESCE(v_service_name_ar, v_service_name, 'خدمة'),
        jsonb_build_object('booking_id', NEW.id), v_provider_link, NEW.id
      );
    END IF;
    -- The customer also gets a record that the request was sent and what happens next.
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      NEW.customer_id, 'booking_requested', 'booking',
      'Request sent',
      CASE WHEN v_is_online
        THEN 'Your lesson request was sent to the tutor. We will tell you as soon as they accept, then you pay to confirm the lesson.'
        ELSE 'Your booking request was sent. We will tell you as soon as the provider accepts.'
      END,
      'Request sent', 'طلبك اتبعت',
      CASE WHEN v_is_online
        THEN 'Your lesson request was sent to the tutor. We will tell you as soon as they accept, then you pay to confirm the lesson.'
        ELSE 'Your booking request was sent. We will tell you as soon as the provider accepts.'
      END,
      CASE WHEN v_is_online
        THEN 'طلب الحصة اتبعت للمدرس، وهنبلغك أول ما يقبل وبعدها تدفع عشان تتأكد الحصة'
        ELSE 'طلب الحجز اتبعت، وهنبلغك أول ما مقدم الخدمة يقبل'
      END,
      jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
    );
    RETURN NEW;
  END IF;

  IF TG_OP <> 'UPDATE' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'confirmed' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      NEW.customer_id, 'booking_confirmed', 'booking',
      'Booking confirmed',
      CASE WHEN v_is_online THEN 'The tutor accepted your lesson. Pay now to confirm it.' ELSE 'Your booking has been accepted.' END,
      'Booking confirmed', CASE WHEN v_is_online THEN 'المدرس قبل الحصة' ELSE 'تم تأكيد الحجز' END,
      CASE WHEN v_is_online THEN 'The tutor accepted your lesson. Pay now to confirm it.' ELSE 'Your booking has been accepted.' END,
      CASE WHEN v_is_online THEN 'المدرس قبل طلبك، ادفع دلوقتي عشان تتأكد الحصة' ELSE 'تم قبول حجزك' END,
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
    SELECT s.auto_complete_hours INTO v_auto_hours
    FROM public.booking_expiry_settings() s;
    v_auto_hours_n := GREATEST(1, LEAST(24, ROUND(COALESCE(v_auto_hours, 6))))::integer;
    v_hours_en := v_auto_hours_n::text || CASE WHEN v_auto_hours_n = 1 THEN ' hour' ELSE ' hours' END;
    v_hours_ar := CASE
      WHEN v_auto_hours_n = 1 THEN 'ساعة'
      WHEN v_auto_hours_n = 2 THEN 'ساعتين'
      ELSE v_auto_hours_n::text || ' ساعات'
    END;
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      NEW.customer_id, 'booking_completion_requested', 'booking',
      'Confirm your service',
      'Your provider marked this booking as done. Please confirm to complete it. If there is no problem, it will close automatically after ' || v_hours_en || '.',
      'Confirm your service', 'أكد إتمام الخدمة',
      'Your provider marked this booking as done. Please confirm to complete it. If there is no problem, it will close automatically after ' || v_hours_en || '.',
      'مقدم الخدمة قال إن الخدمة خلصت، ولو مفيش مشكلة الحجز هيتقفل لوحده بعد ' || v_hours_ar,
      jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
    );
    IF v_conversation_id IS NOT NULL THEN
      PERFORM set_config('app.system_message_in_progress', 'on', true);
      INSERT INTO public.messages (conversation_id, body, system_key)
      VALUES (v_conversation_id, 'Provider marked the service as complete. Awaiting customer confirmation.', 'completion_requested');
    END IF;

  ELSIF NEW.status = 'completed' THEN
    IF current_setting('app.auto_complete_in_progress', true) = 'on' THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        NEW.customer_id, 'booking_completed', 'booking',
        'Booking completed', 'This booking was completed automatically because no problem was reported.',
        'Booking completed', 'الحجز خلص لوحده',
        'This booking was completed automatically because no problem was reported.',
        'الحجز اتقفل لوحده عشان مفيش مشكلة اتبلغ عنها',
        jsonb_build_object('booking_id', NEW.id, 'reason', 'auto_complete'), v_customer_link, NEW.id
      );
      IF v_provider_user IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
        VALUES (
          v_provider_user, 'booking_completed', 'booking',
          'Booking completed', 'This booking was completed automatically because the customer did not report a problem.',
          'Booking completed', 'الحجز خلص لوحده',
          'This booking was completed automatically because the customer did not report a problem.',
          'الحجز اتقفل لوحده عشان العميل مبلغش عن مشكلة',
          jsonb_build_object('booking_id', NEW.id, 'reason', 'auto_complete'), v_provider_link, NEW.id
        );
      END IF;
    ELSIF v_provider_user IS NOT NULL THEN
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
    -- Latest body from 20260714233000, plus an expiry skip so we do not
    -- send a second customer "declined" notification. Expiry already
    -- inserts customer + provider notifications in expire_pending_bookings().
    IF NEW.cancellation_reason = 'provider_no_response'
       OR current_setting('app.pending_expiry_in_progress', true) = 'on' THEN
      NULL;
    ELSIF OLD.status = 'pending' AND NEW.cancelled_by IS DISTINCT FROM NEW.customer_id THEN
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
          CASE WHEN OLD.status = 'pending' THEN 'Request cancelled' ELSE 'Booking cancelled' END,
          CASE WHEN OLD.status = 'pending' THEN 'The customer cancelled the request before you answered.' ELSE 'The customer cancelled this booking.' END,
          CASE WHEN OLD.status = 'pending' THEN 'Request cancelled' ELSE 'Booking cancelled' END,
          CASE WHEN OLD.status = 'pending' THEN 'الطلب اتلغى' ELSE 'تم إلغاء الحجز' END,
          CASE WHEN OLD.status = 'pending' THEN 'The customer cancelled the request before you answered.' ELSE 'The customer cancelled this booking.' END,
          CASE WHEN OLD.status = 'pending' THEN 'العميل لغى الطلب قبل ما ترد عليه' ELSE 'العميل لغى الحجز ده' END,
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
      IF NEW.cancellation_reason = 'provider_no_response'
         OR current_setting('app.pending_expiry_in_progress', true) = 'on' THEN
        INSERT INTO public.messages (conversation_id, body, system_key)
        VALUES (v_conversation_id, 'Booking request expired.', 'booking_expired');
      ELSE
        INSERT INTO public.messages (conversation_id, body, system_key)
        VALUES (v_conversation_id, 'Booking cancelled.', 'booking_cancelled');
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_booking_notify() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_booking_cancellation_notify_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer uuid;
  v_mode text;
  v_link text;
  v_fee numeric := COALESCE(NEW.cancellation_fee, 0);
  v_fee_text text;
  v_title_ar text;
  v_title_en text;
  v_body_ar text;
  v_body_en text;
BEGIN
  IF NEW.cancelled_by_role IS DISTINCT FROM 'customer' THEN
    RETURN NEW;
  END IF;

  SELECT b.customer_id, COALESCE(b.service_mode, 'in_person')
  INTO v_customer, v_mode
  FROM public.bookings b
  WHERE b.id = NEW.booking_id;

  IF v_customer IS NULL THEN
    RETURN NEW;
  END IF;

  v_link := CASE WHEN v_mode = 'online'
    THEN '/online/lessons/' || NEW.booking_id
    ELSE '/booking/' || NEW.booking_id
  END;
  v_fee_text := trim(to_char(v_fee, 'FM999999990.##'));

  IF NEW.previous_status = 'pending' THEN
    v_title_en := 'Request cancelled';
    v_title_ar := 'طلبك اتلغى';
    v_body_en := CASE WHEN v_mode = 'online'
      THEN 'Your lesson request was cancelled. No fee, because the tutor had not accepted yet.'
      ELSE 'Your booking request was cancelled. No fee, because the provider had not accepted yet.'
    END;
    v_body_ar := CASE WHEN v_mode = 'online'
      THEN 'طلب الحصة اتلغى ومفيش أي رسوم، لأن المدرس لسه ماكانش قبل'
      ELSE 'طلب الحجز اتلغى ومفيش أي رسوم، لأن مقدم الخدمة لسه ماكانش قبل'
    END;
  ELSIF v_fee > 0 THEN
    v_title_en := 'Booking cancelled';
    v_title_ar := 'الحجز اتلغى';
    v_body_en := 'Your booking was cancelled. Cancellation fee: ' || v_fee_text || ' EGP. Details are on the booking page.';
    v_body_ar := 'الحجز اتلغى، ورسوم الإلغاء ' || v_fee_text || ' ج.م، والتفاصيل في صفحة الحجز';
  ELSE
    v_title_en := 'Booking cancelled';
    v_title_ar := 'الحجز اتلغى';
    v_body_en := 'Your booking was cancelled with no fee.';
    v_body_ar := 'الحجز اتلغى ومفيش رسوم إلغاء';
  END IF;

  INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
  VALUES (
    v_customer, 'booking_cancelled_by_you', 'booking',
    v_title_en, v_body_en, v_title_en, v_title_ar, v_body_en, v_body_ar,
    jsonb_build_object('booking_id', NEW.booking_id, 'cancellation_fee', v_fee),
    v_link, NEW.booking_id
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_booking_cancellation_notify_customer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_booking_cancellation_notify_customer ON public.booking_cancellations;
CREATE TRIGGER trg_booking_cancellation_notify_customer
  AFTER INSERT ON public.booking_cancellations
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_cancellation_notify_customer();
