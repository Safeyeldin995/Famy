-- Launch gaps: payment, wallet, InstaPay, review request, online reminder links, store_links setting.

INSERT INTO public.settings (key, value)
VALUES ('store_links', '{"play_url":"","app_store_url":""}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.store_links_config()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value FROM public.settings WHERE key = 'store_links'),
  '{"play_url":"","app_store_url":""}'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.store_links_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_links_config() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Payment captured / InstaPay rejected
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_payment_status_change(p_payment public.payments)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_provider_user uuid;
  v_customer_deep_link text;
  v_provider_deep_link text;
  v_amount_text text;
BEGIN
  IF p_payment.booking_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_payment.booking_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT profile_id INTO v_provider_user FROM public.providers WHERE id = v_booking.provider_id;
  v_customer_deep_link := '/booking/' || v_booking.id;
  v_provider_deep_link := '/pro/booking/' || v_booking.id;
  v_amount_text := trim(to_char(p_payment.amount, 'FM999999990.00'));

  IF p_payment.status = 'captured' THEN
    IF EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.type = 'payment_received'
        AND n.payload->>'payment_id' = p_payment.id::text
        AND n.user_id = v_booking.customer_id
    ) THEN
      RETURN;
    END IF;

    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar,
      payload, deep_link, booking_id
    ) VALUES (
      v_booking.customer_id,
      'payment_received',
      'booking',
      'Payment received',
      'Your payment for this booking is confirmed.',
      'Payment received',
      'تم الدفع',
      'Your payment for this booking is confirmed.',
      'تم تأكيد دفع حجزك.',
      jsonb_build_object(
        'payment_id', p_payment.id,
        'booking_id', v_booking.id,
        'amount', p_payment.amount
      ),
      v_customer_deep_link,
      v_booking.id
    );

    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (
        user_id, type, category, title, body, title_en, title_ar, body_en, body_ar,
        payload, deep_link, booking_id
      ) VALUES (
        v_provider_user,
        'payment_received',
        'booking',
        'Booking paid',
        'Payment is in — this booking is ready to go.',
        'Booking paid',
        'الحجز اتدفع وجاهز',
        'Payment is in — this booking is ready to go.',
        'الحصة/الحجز اتدفع وجاهز.',
        jsonb_build_object(
          'payment_id', p_payment.id,
          'booking_id', v_booking.id,
          'amount', p_payment.amount
        ),
        v_provider_deep_link,
        v_booking.id
      );
    END IF;
    RETURN;
  END IF;

  IF p_payment.status = 'rejected'
     AND COALESCE(p_payment.payment_method_type, '') = 'manual_transfer' THEN
    IF EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.type = 'instapay_receipt_rejected'
        AND n.payload->>'payment_id' = p_payment.id::text
    ) THEN
      RETURN;
    END IF;

    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar,
      payload, deep_link, booking_id
    ) VALUES (
      v_booking.customer_id,
      'instapay_receipt_rejected',
      'booking',
      'Transfer not confirmed',
      COALESCE(NULLIF(btrim(p_payment.rejection_reason), ''), 'Your InstaPay receipt was not accepted.'),
      'Transfer not confirmed',
      'لم يتم تأكيد التحويل',
      COALESCE(NULLIF(btrim(p_payment.rejection_reason), ''), 'Your InstaPay receipt was not accepted.'),
      COALESCE(
        NULLIF(btrim(p_payment.rejection_reason), ''),
        'لم يتم قبول إيصال إنستاباي.'
      ),
      jsonb_build_object(
        'payment_id', p_payment.id,
        'booking_id', v_booking.id,
        'rejection_reason', p_payment.rejection_reason,
        'amount', p_payment.amount
      ),
      v_customer_deep_link,
      v_booking.id
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_payment_status_change(public.payments) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_payment_status_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('captured', 'rejected') THEN
    PERFORM public.notify_payment_status_change(NEW);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_status_notify ON public.payments;
CREATE TRIGGER trg_payment_status_notify
  AFTER UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_payment_status_notify();

-- ---------------------------------------------------------------------------
-- Wallet credits (single notification type for customer-visible credits)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_customer_wallet_credit_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount_text text;
BEGIN
  IF NEW.direction <> 'credit' THEN
    RETURN NEW;
  END IF;
  IF NEW.reason NOT IN ('provider_cancelled', 'customer_cancelled_refund', 'admin_credit') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.type = 'wallet_credited'
      AND n.payload->>'wallet_entry_id' = NEW.id::text
  ) THEN
    RETURN NEW;
  END IF;

  v_amount_text := trim(to_char(NEW.amount, 'FM999999990.00'));

  INSERT INTO public.notifications (
    user_id, type, category, title, body, title_en, title_ar, body_en, body_ar,
    payload, deep_link, booking_id
  ) VALUES (
    NEW.customer_id,
    'wallet_credited',
    'system',
    'Wallet credited',
    v_amount_text || ' EGP was added to your Famy wallet. You can use it on your next booking.',
    'Wallet credited',
    'تم إضافة رصيد للمحفظة',
    v_amount_text || ' EGP was added to your Famy wallet. You can use it on your next booking.',
    'اتضاف ' || v_amount_text || ' جنيه لمحفظتك. رصيدك متاح تستخدمه في أي حجز جاي على فامي.',
    jsonb_build_object(
      'wallet_entry_id', NEW.id,
      'amount', NEW.amount,
      'reason', NEW.reason,
      'booking_id', NEW.booking_id
    ),
    '/wallet',
    NEW.booking_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_wallet_credit_notify ON public.customer_wallet_entries;
CREATE TRIGGER trg_customer_wallet_credit_notify
  AFTER INSERT ON public.customer_wallet_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_customer_wallet_credit_notify();

CREATE OR REPLACE FUNCTION public.credit_customer_wallet_provider_cancelled(p_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_pay public.payments%ROWTYPE;
  v_entry_id uuid;
  v_amount numeric;
  v_idempotency_key text;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.lock_customer_debts(v_booking.customer_id);
  PERFORM public.lock_customer_wallet(v_booking.customer_id);

  IF NOT public.booking_money_held(p_booking_id) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_pay
  FROM public.payments pay
  WHERE pay.booking_id = p_booking_id
    AND pay.status = 'captured'
    AND COALESCE(pay.payment_method_type, '') IN ('online', 'manual_transfer')
  ORDER BY pay.captured_at DESC NULLS LAST, pay.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_amount := COALESCE(
    NULLIF((v_pay.metadata->>'checkout_total')::numeric, 0),
    v_pay.amount + COALESCE((v_pay.metadata->>'wallet_applied')::numeric, 0),
    v_booking.price_total
  );
  v_idempotency_key := 'provider_cancelled:' || p_booking_id::text;

  SELECT e.id INTO v_entry_id
  FROM public.customer_wallet_entries e
  WHERE e.idempotency_key = v_idempotency_key;

  IF v_entry_id IS NOT NULL THEN
    RETURN v_entry_id;
  END IF;

  v_entry_id := public.customer_wallet_insert_entry(
    v_booking.customer_id,
    'credit',
    v_amount,
    'provider_cancelled',
    p_booking_id,
    v_pay.id,
    NULL,
    v_idempotency_key,
    jsonb_build_object('payment_method_type', v_pay.payment_method_type)
  );

  IF v_entry_id IS NOT NULL THEN
    PERFORM set_config('app.wallet_checkout_adjust', 'on', true);
    PERFORM set_config('app.ledger_internal_capture', 'on', true);
    UPDATE public.payments
    SET status = 'refunded',
        reviewed_at = COALESCE(reviewed_at, now()),
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'refund_settled_via_wallet', true,
          'wallet_refund_settled', true,
          'refund_settled_at', now(),
          'refund', jsonb_build_object(
            'channel', 'customer_wallet',
            'amount_refunded', v_amount,
            'wallet_entry_id', v_entry_id,
            'recorded_at', now()
          )
        )
    WHERE id = v_pay.id
      AND status = 'captured';
    PERFORM set_config('app.ledger_internal_capture', 'off', true);
    PERFORM set_config('app.wallet_checkout_adjust', 'off', true);

    UPDATE public.providers
    SET paid_booking_cancellations = paid_booking_cancellations + 1
    WHERE id = v_booking.provider_id;
  END IF;

  RETURN v_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_customer_wallet_provider_cancelled(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_customer_wallet_provider_cancelled(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Post-completion review request (customer only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_booking_review_request_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'completed'
     AND OLD.status IS DISTINCT FROM 'completed'
     AND NOT EXISTS (
       SELECT 1 FROM public.reviews r
       WHERE r.booking_id = NEW.id AND r.deleted_at IS NULL
     ) THEN
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar,
      payload, deep_link, booking_id
    ) VALUES (
      NEW.customer_id,
      'booking_review_request',
      'booking',
      'How was your booking?',
      'Tell us how the service went — it helps other families choose.',
      'How was your booking?',
      'قولنا رأيك في الخدمة',
      'Tell us how the service went — it helps other families choose.',
      'قيم الخدمة وساعد عائلات تانية تختار بثقة.',
      jsonb_build_object('booking_id', NEW.id),
      '/booking/' || NEW.id::text || '?review=1',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_review_request_notify ON public.bookings;
CREATE TRIGGER trg_booking_review_request_notify
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_review_request_notify();

-- ---------------------------------------------------------------------------
-- Reminders: online join deep link + 10-minute copy
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_due_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_count integer := 0;
  v_booking public.bookings%ROWTYPE;
  v_rule public.booking_reminder_rules%ROWTYPE;
  v_service_name text;
  v_link text;
  v_type text;
  v_title_en text;
  v_title_ar text;
  v_body_en text;
  v_body_ar text;
  v_online boolean;
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

    SELECT * INTO v_rule FROM public.booking_reminder_rules WHERE id = v_row.rule_id;
    SELECT name_en INTO v_service_name FROM public.services WHERE id = v_booking.service_id;
    v_online := COALESCE(v_booking.service_mode, 'in_person') = 'online';

    IF v_online THEN
      v_link := '/online/lessons/' || v_booking.id || '/room';
    ELSIF v_row.recipient_user_id = v_booking.customer_id THEN
      v_link := '/booking/' || v_booking.id;
    ELSE
      v_link := '/pro/booking/' || v_booking.id;
    END IF;

    IF v_online AND COALESCE(v_rule.lead_minutes, 0) = 10 THEN
      v_type := 'online_lesson_starting';
      v_title_en := 'Your online lesson starts soon';
      v_title_ar := 'درسك الأونلاين يبدأ قريباً';
      v_body_en := 'Your session starts in about 10 minutes. Tap to join when you are ready.';
      v_body_ar := 'درسك يبدأ بعد حوالي ١٠ دقائق. اضغط للدخول لما تكون جاهز.';
    ELSE
      v_type := 'booking_reminder';
      v_title_en := 'Upcoming booking';
      v_title_ar := 'حجز قادم';
      v_body_en := 'You have an upcoming ' || COALESCE(v_service_name, 'booking') || '.';
      v_body_ar := 'لديك حجز قادم' || CASE WHEN v_service_name IS NOT NULL THEN ' لخدمة ' || v_service_name ELSE '' END || '.';
    END IF;

    WITH inserted AS (
      INSERT INTO public.notifications (
        user_id, type, category, title, body, title_en, title_ar, body_en, body_ar,
        payload, deep_link, booking_id
      )
      VALUES (
        v_row.recipient_user_id,
        v_type,
        'reminder',
        v_title_en,
        v_body_en,
        v_title_en,
        v_title_ar,
        v_body_en,
        v_body_ar,
        jsonb_build_object(
          'booking_id', v_booking.id,
          'lead_minutes', COALESCE(v_rule.lead_minutes, null),
          'online', v_online
        ),
        v_link,
        v_booking.id
      )
      RETURNING id
    )
    UPDATE public.booking_reminders
    SET status = 'sent', notification_id = (SELECT id FROM inserted)
    WHERE id = v_row.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_due_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_due_reminders() TO service_role;

-- Default reminder lead times (24h, 60m, 10m) for fresh databases.
INSERT INTO public.booking_reminder_rules (lead_minutes, is_active)
SELECT v, true
FROM (VALUES (1440), (60), (10)) AS t(v)
WHERE NOT EXISTS (
  SELECT 1 FROM public.booking_reminder_rules r WHERE r.lead_minutes = t.v
);

NOTIFY pgrst, 'reload schema';