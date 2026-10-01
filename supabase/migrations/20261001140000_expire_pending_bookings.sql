-- Auto-expire unanswered pending booking requests.
-- Additive only. Does not mutate existing bookings. Must not be applied to
-- QA or Production from this draft PR.
--
-- Product rule: a pending booking expires at the earlier of
--   1) pending_ttl_hours after created_at (default 12)
--   2) min_hours_before_start before start_at (default 2)
-- Both values live in settings.booking_expiry.

-- ============================================================
-- 1) Admin-configurable defaults. ON CONFLICT DO NOTHING so a re-run never
-- overwrites an admin-edited row and never touches existing bookings.
-- ============================================================
INSERT INTO public.settings (key, value)
VALUES (
  'booking_expiry',
  jsonb_build_object('pending_ttl_hours', 12, 'min_hours_before_start', 2)
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.cancellation_reasons (
  code, name_en, name_ar, actor_type, requires_note, is_active, display_order
) VALUES (
  'provider_no_response',
  'The provider did not respond in time',
  'مقدم الخدمة لم يرد في الوقت المحدد',
  'admin',
  false,
  false,
  99
)
ON CONFLICT (code) DO NOTHING;

-- Flag captured Paymob rows on an expired pending booking for admin review.
-- No refund is issued. Uncaptured payment rows are left uncaptured.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS needs_admin_review boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_payments_needs_admin_review
  ON public.payments (id)
  WHERE needs_admin_review;

-- ============================================================
-- 2) Shared settings reader used by expire_pending_bookings and create_booking.
-- ============================================================
CREATE OR REPLACE FUNCTION public.booking_expiry_settings()
RETURNS TABLE (pending_ttl_hours numeric, min_hours_before_start numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value jsonb;
  v_ttl numeric;
  v_min numeric;
BEGIN
  SELECT s.value INTO v_value FROM public.settings s WHERE s.key = 'booking_expiry';
  IF jsonb_typeof(v_value->'pending_ttl_hours') = 'number' THEN
    v_ttl := (v_value->>'pending_ttl_hours')::numeric;
  END IF;
  IF jsonb_typeof(v_value->'min_hours_before_start') = 'number' THEN
    v_min := (v_value->>'min_hours_before_start')::numeric;
  END IF;
  pending_ttl_hours := CASE WHEN v_ttl IS NOT NULL AND v_ttl >= 0 THEN v_ttl ELSE 12 END;
  min_hours_before_start := CASE WHEN v_min IS NOT NULL AND v_min >= 0 THEN v_min ELSE 2 END;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.booking_expiry_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_expiry_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.booking_expiry_settings() TO service_role;

-- ============================================================
-- 3) expire_pending_bookings — service_role / scheduler only.
-- System actor (auth.uid() IS NULL) passes the existing transition guard.
-- Idempotent: a second run finds no matching pending rows.
-- ============================================================
CREATE OR REPLACE FUNCTION public.expire_pending_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ttl numeric;
  v_min_before numeric;
  v_row RECORD;
  v_provider_user uuid;
  v_count integer := 0;
  v_reason RECORD;
BEGIN
  SELECT s.pending_ttl_hours, s.min_hours_before_start
    INTO v_ttl, v_min_before
  FROM public.booking_expiry_settings() s;

  SELECT * INTO v_reason
  FROM public.cancellation_reasons
  WHERE code = 'provider_no_response';

  PERFORM set_config('app.cancellation_in_progress', 'on', true);
  PERFORM set_config('app.pending_expiry_in_progress', 'on', true);
  PERFORM set_config('app.audit_reason', 'provider_no_response', true);

  FOR v_row IN
    SELECT b.id, b.customer_id, b.provider_id, b.status, b.created_at, b.start_at
    FROM public.bookings b
    WHERE b.status = 'pending'
      AND LEAST(
        b.created_at + (v_ttl * interval '1 hour'),
        b.start_at - (v_min_before * interval '1 hour')
      ) <= now()
    ORDER BY b.created_at
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    UPDATE public.bookings
    SET
      status = 'cancelled',
      cancellation_reason = 'provider_no_response',
      cancelled_at = now(),
      cancelled_by = NULL
    WHERE id = v_row.id
      AND status = 'pending';

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT profile_id INTO v_provider_user
    FROM public.providers
    WHERE id = v_row.provider_id;

    INSERT INTO public.notifications (
      user_id, type, category, title, body,
      title_en, title_ar, body_en, body_ar,
      payload, deep_link, booking_id
    ) VALUES (
      v_row.customer_id, 'booking_expired', 'booking',
      'Request expired',
      COALESCE(v_reason.name_en, 'The provider did not respond in time'),
      'Request expired',
      'انتهت صلاحية الطلب',
      COALESCE(v_reason.name_en, 'The provider did not respond in time'),
      COALESCE(v_reason.name_ar, 'مقدم الخدمة لم يرد في الوقت المحدد'),
      jsonb_build_object('booking_id', v_row.id, 'reason_code', 'provider_no_response'),
      '/booking/' || v_row.id,
      v_row.id
    );

    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.notifications (
        user_id, type, category, title, body,
        title_en, title_ar, body_en, body_ar,
        payload, deep_link, booking_id
      ) VALUES (
        v_provider_user, 'booking_expired', 'booking',
        'Booking request expired',
        'You did not respond in time. The request was cancelled.',
        'Booking request expired',
        'انتهت صلاحية طلب الحجز',
        'You did not respond in time. The request was cancelled.',
        'لم ترد في الوقت المحدد. تم إلغاء الطلب.',
        jsonb_build_object('booking_id', v_row.id, 'reason_code', 'provider_no_response'),
        '/pro/booking/' || v_row.id,
        v_row.id
      );
    END IF;

    INSERT INTO public.audit_logs (
      actor_id, actor_role, action, entity, entity_id, booking_id, reason,
      old_values, new_values
    ) VALUES (
      NULL, 'system', 'expire_pending', 'bookings', v_row.id, v_row.id, 'provider_no_response',
      jsonb_build_object('status', v_row.status),
      jsonb_build_object('status', 'cancelled', 'cancellation_reason', 'provider_no_response')
    );

    -- Never capture. Never refund. Flag an already-captured Paymob row.
    UPDATE public.payments
    SET
      needs_admin_review = true,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'admin_review_reason', 'expired_pending_captured',
        'admin_review_at', now()
      )
    WHERE booking_id = v_row.id
      AND status = 'captured'
      AND needs_admin_review IS DISTINCT FROM true;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_pending_bookings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_pending_bookings() TO service_role;

-- ============================================================
-- 4) Skip the generic cancelled notify path when expiry already notified
-- both parties above. Full replace of the current body with one added
-- branch; every other branch is unchanged.
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
    -- Expiry already inserts customer + provider notifications.
    IF NEW.cancellation_reason = 'provider_no_response'
       OR current_setting('app.pending_expiry_in_progress', true) = 'on' THEN
      IF v_conversation_id IS NOT NULL THEN
        PERFORM set_config('app.system_message_in_progress', 'on', true);
        INSERT INTO public.messages (conversation_id, body, system_key)
        VALUES (v_conversation_id, 'Booking request expired.', 'booking_expired');
      END IF;
    ELSIF OLD.status = 'pending' AND NEW.cancelled_by IS DISTINCT FROM NEW.customer_id THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
      VALUES (
        NEW.customer_id, 'booking_declined', 'booking',
        'Booking declined', 'Your booking request was not accepted. Please try another provider or time.',
        'Booking declined', 'تم رفض الحجز',
        'Your booking request was not accepted. Please try another provider or time.', 'لم يتم قبول طلب حجزك. يرجى تجربة مزود خدمة أو موعد آخر.',
        jsonb_build_object('booking_id', NEW.id), v_customer_link, NEW.id
      );
      IF v_conversation_id IS NOT NULL THEN
        PERFORM set_config('app.system_message_in_progress', 'on', true);
        INSERT INTO public.messages (conversation_id, body, system_key)
        VALUES (v_conversation_id, 'Booking cancelled.', 'booking_cancelled');
      END IF;
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
      IF v_conversation_id IS NOT NULL THEN
        PERFORM set_config('app.system_message_in_progress', 'on', true);
        INSERT INTO public.messages (conversation_id, body, system_key)
        VALUES (v_conversation_id, 'Booking cancelled.', 'booking_cancelled');
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
      IF v_conversation_id IS NOT NULL THEN
        PERFORM set_config('app.system_message_in_progress', 'on', true);
        INSERT INTO public.messages (conversation_id, body, system_key)
        VALUES (v_conversation_id, 'Booking cancelled.', 'booking_cancelled');
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_booking_notify() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 5) create_booking: reject a start_at that is already inside the
-- "min_hours_before_start" window (stricter of that setting and the
-- provider's min_notice_hours). tg_validate_booking_service is untouched.
-- ============================================================
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
  p_requirement_selections jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_fingerprint text;
  v_existing RECORD;
  v_booking_id uuid;
  v_created boolean := false;
  v_min_hours_before_start numeric;
  v_provider_min_notice integer;
  v_required_hours numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF public.is_not_suspended(v_uid) IS NOT TRUE THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Account is suspended.' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Idempotency key is required.' USING ERRCODE = '23514';
  END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Invalid booking time range.' USING ERRCODE = '23514';
  END IF;

  v_fingerprint := public.booking_request_fingerprint(
    p_provider_id, p_service_id, p_address_id, p_start_at, p_end_at,
    p_family_member_id, p_notes, p_promo_code_id, coalesce(p_requirement_selections, '[]'::jsonb)
  );

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_idempotency_key::text, 0));

  SELECT id, request_fingerprint INTO v_existing
  FROM public.bookings
  WHERE customer_id = v_uid AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'BOOKING_DUPLICATE_REQUEST_CONFLICT: Idempotency key reused with different booking details.' USING ERRCODE = '23514';
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
  FROM public.providers WHERE id = p_provider_id;
  v_required_hours := GREATEST(COALESCE(v_min_hours_before_start, 2), COALESCE(v_provider_min_notice, 0)::numeric);
  IF p_start_at < now() + (v_required_hours * interval '1 hour') THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: This start time is too soon for the provider to respond in time.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.marketplace_eligibility_internal(p_provider_id, p_service_id, p_address_id) e
    WHERE e.is_eligible
  ) THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Provider is not eligible for this service and address.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.create_booking_in_progress', 'on', true);

  BEGIN
    INSERT INTO public.bookings (
      customer_id, provider_id, service_id, address_id,
      start_at, end_at, status, notes, family_member_id,
      requirement_selections, promo_code_id,
      price_subtotal, price_discount, price_total,
      price_platform_fee, price_vat, price_extras_total, price_travel_fee,
      idempotency_key, request_fingerprint, currency
    ) VALUES (
      v_uid, p_provider_id, p_service_id, p_address_id,
      p_start_at, p_end_at, 'pending', NULLIF(btrim(p_notes), ''), p_family_member_id,
      coalesce(p_requirement_selections, '[]'::jsonb), p_promo_code_id,
      0, 0, 0, 0, 0, 0, 0,
      p_idempotency_key, v_fingerprint, 'EGP'
    ) RETURNING id INTO v_booking_id;
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
      RAISE EXCEPTION 'BOOKING_DUPLICATE_REQUEST_CONFLICT: Concurrent duplicate booking request.' USING ERRCODE = '23514';
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'BOOKING_SLOT_UNAVAILABLE: That time slot is no longer available.' USING ERRCODE = '23514';
    WHEN SQLSTATE '23514' THEN
      RAISE;
    WHEN SQLSTATE '42501' THEN
      RAISE;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'BOOKING_%' THEN
        RAISE;
      END IF;
      RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Unable to create booking.' USING ERRCODE = '23514';
  END;

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'created', v_created,
    'idempotent_replay', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.create_booking(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,text,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,text,uuid,jsonb) TO authenticated;

-- ============================================================
-- 6) Best-effort pg_cron, same pattern as process_due_reminders
-- (20260715001000). Every 5 minutes. Environments without pg_cron still
-- work once expire_pending_bookings() is invoked by any scheduler.
-- ============================================================
DO $$
BEGIN
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron extension unavailable (%); schedule expire_pending_bookings() externally.', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'famy-expire-pending-bookings') THEN
      PERFORM cron.unschedule('famy-expire-pending-bookings');
    END IF;
    PERFORM cron.schedule('famy-expire-pending-bookings', '*/5 * * * *', 'SELECT public.expire_pending_bookings();');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron scheduling skipped (%); schedule expire_pending_bookings() externally.', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
