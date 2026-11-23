-- PO v1: wallet credits stay in Famy (no refund-to-payment requests / holds).
-- PO: no automatic online attendance refunds — evidence + normal end-time completion only.

ALTER TABLE public.bookings
  DROP COLUMN IF EXISTS guardian_consent_at;

DROP FUNCTION IF EXISTS public.customer_request_wallet_refund(uuid);
DROP FUNCTION IF EXISTS public.admin_reject_wallet_refund_request(uuid, text);
DROP FUNCTION IF EXISTS public.admin_mark_wallet_refund_approved(uuid);
DROP FUNCTION IF EXISTS public.admin_complete_wallet_refund_request(uuid, text, text);
DROP FUNCTION IF EXISTS public.admin_fail_wallet_refund_request(uuid, text);

DROP TABLE IF EXISTS public.customer_wallet_holds CASCADE;
DROP TABLE IF EXISTS public.customer_wallet_refund_requests CASCADE;

CREATE OR REPLACE FUNCTION public.customer_wallet_balances(p_customer_id uuid DEFAULT NULL)
RETURNS TABLE (
  ledger_balance numeric,
  held_amount numeric,
  available_amount numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer uuid := COALESCE(p_customer_id, auth.uid());
BEGIN
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF p_customer_id IS NOT NULL
     AND p_customer_id <> auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(
      sum(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END),
      0
    ),
    0::numeric,
    COALESCE(
      sum(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END),
      0
    )
  FROM public.customer_wallet_entries e
  WHERE e.customer_id = v_customer;
END;
$$;

CREATE OR REPLACE FUNCTION public.credit_customer_wallet_provider_cancelled(p_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_pay public.payments%ROWTYPE;
  v_amount numeric;
  v_idempotency_key text;
  v_entry_id uuid;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR SHARE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_pay
  FROM public.payments
  WHERE booking_id = p_booking_id
    AND status = 'captured'
  ORDER BY captured_at DESC NULLS LAST, created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_amount := v_pay.amount;
  v_idempotency_key := 'provider_cancelled:' || p_booking_id::text;

  SELECT e.id INTO v_entry_id
  FROM public.customer_wallet_entries e
  WHERE e.idempotency_key = v_idempotency_key;

  IF v_entry_id IS NOT NULL THEN
    RETURN v_entry_id;
  END IF;

  PERFORM public.lock_customer_debts(v_booking.customer_id);
  PERFORM public.lock_customer_wallet(v_booking.customer_id);

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
    UPDATE public.providers
    SET paid_booking_cancellations = paid_booking_cancellations + 1
    WHERE id = v_booking.provider_id;

    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar,
      payload, deep_link, booking_id
    ) VALUES (
      v_booking.customer_id,
      'wallet_provider_cancelled',
      'booking',
      'Amount added to your Famy wallet',
      'The provider cancelled your booking. The full amount is in your wallet for your next booking.',
      'Amount added to your Famy wallet',
      'تم إضافة المبلغ لمحفظة فامي',
      'The provider cancelled your booking. The full amount is in your wallet for your next booking.',
      'ألغى مقدم الخدمة حجزك. المبلغ كاملًا في محفظتك للحجز الجاي.',
      jsonb_build_object(
        'booking_id', p_booking_id,
        'wallet_entry_id', v_entry_id,
        'amount', v_amount
      ),
      '/wallet',
      p_booking_id
    );
  END IF;

  RETURN v_entry_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_online_session_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_settings record;
  v_overlap numeric;
  v_required numeric;
  v_duration_min numeric;
  v_outcome text;
  v_event_count integer;
  v_customer_present boolean;
  v_provider_present boolean;
  v_participant_minutes integer;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_settings FROM public.online_session_settings() LIMIT 1;

  FOR v_booking IN
    SELECT b.*, p.profile_id AS provider_user_id
    FROM public.bookings b
    JOIN public.providers p ON p.id = b.provider_id
    WHERE b.service_mode = 'online'
      AND b.status = 'confirmed'
      AND b.end_at + (COALESCE(v_settings.grace_minutes_after_end, 15) * interval '1 minute') <= now()
      AND EXISTS (
        SELECT 1
        FROM public.payments pay
        WHERE pay.booking_id = b.id
          AND pay.status = 'captured'
          AND COALESCE(pay.payment_method_type, '') IN ('online', 'manual_transfer')
      )
    ORDER BY b.end_at, b.id
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    SELECT count(*)::integer INTO v_event_count
    FROM public.session_events se
    WHERE se.booking_id = v_booking.id;

    v_duration_min := GREATEST(
      EXTRACT(epoch FROM (v_booking.end_at - v_booking.start_at)) / 60.0,
      0
    );
    v_required := v_duration_min * COALESCE(v_settings.overlap_ratio, 0.5);
    v_overlap := public.online_session_overlap_minutes(v_booking.id);
    v_customer_present := public.online_session_participant_present(v_booking.id, 'customer');
    v_provider_present := public.online_session_participant_present(v_booking.id, 'provider');

    IF v_event_count = 0 THEN
      v_outcome := 'admin_review_no_events';
    ELSIF v_overlap < v_required THEN
      v_outcome := 'admin_review_overlap';
    ELSE
      v_outcome := 'complete';
    END IF;

    UPDATE public.bookings
    SET online_session_outcome = v_outcome
    WHERE id = v_booking.id;

    IF v_outcome IN ('admin_review_no_events', 'admin_review_overlap') THEN
      PERFORM public.open_online_session_admin_review(
        v_booking.id,
        'Online session attendance evidence: ' || v_outcome,
        jsonb_build_object(
          'overlap_minutes', v_overlap,
          'required_overlap_minutes', v_required,
          'event_count', v_event_count,
          'customer_present', v_customer_present,
          'provider_present', v_provider_present
        )
      );
    END IF;

    SELECT COALESCE(
      sum(
        GREATEST(
          EXTRACT(
            epoch FROM (
              COALESCE(se.left_at, LEAST(now(), v_booking.end_at)) - se.joined_at
            )
          ),
          0
        )
      )::integer / 60,
      0
    ) INTO v_participant_minutes
    FROM public.session_events se
    WHERE se.booking_id = v_booking.id;

    PERFORM set_config('app.auto_complete_in_progress', 'on', true);
    PERFORM set_config('app.audit_reason', 'online_session_auto_complete', true);

    UPDATE public.bookings
    SET status = 'completed',
        online_participant_minutes = v_participant_minutes,
        session_started_at = COALESCE(session_started_at, v_booking.start_at),
        session_ended_at = COALESCE(session_ended_at, v_booking.end_at),
        completion_requested_at = COALESCE(completion_requested_at, v_booking.end_at),
        completed_at = COALESCE(completed_at, now()),
        status_changed_at = now(),
        status_changed_by = NULL
    WHERE id = v_booking.id
      AND status = 'confirmed';

    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

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
    WHERE ps.pending_price_override IS NOT NULL AND ps.status = 'approved'
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

REVOKE ALL ON FUNCTION public.admin_work_queue_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_work_queue_counts() TO authenticated;

-- Students 12+ book online without guardian consent (PO 2026-11-23).
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
  p_requirement_selections jsonb DEFAULT '[]'::jsonb,
  p_teaching_capability_id uuid DEFAULT NULL,
  p_teaching_subject_code text DEFAULT NULL,
  p_teaching_curriculum_code text DEFAULT NULL,
  p_teaching_level_code text DEFAULT NULL,
  p_supervision_mode text DEFAULT NULL,
  p_service_mode text DEFAULT 'in_person',
  p_online_guardian_consent boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mode text := COALESCE(NULLIF(btrim(p_service_mode), ''), 'in_person');
  v_address uuid;
  v_fingerprint text;
  v_existing RECORD;
  v_booking_id uuid;
  v_created boolean := false;
  v_min_hours_before_start numeric;
  v_provider_min_notice integer;
  v_required_hours numeric;
  v_category_slug text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '42501';
  END IF;
  IF public.is_not_suspended(v_uid) IS NOT TRUE THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Account is suspended.'
      USING ERRCODE = '42501';
  END IF;
  IF v_mode NOT IN ('in_person', 'online') THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Invalid service mode.'
      USING ERRCODE = '23514';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Idempotency key is required.'
      USING ERRCODE = '23514';
  END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Invalid booking time range.'
      USING ERRCODE = '23514';
  END IF;

  v_address := CASE WHEN v_mode = 'online' THEN NULL ELSE p_address_id END;

  SELECT cat.slug INTO v_category_slug
  FROM public.services s
  JOIN public.categories cat ON cat.id = s.category_id
  WHERE s.id = p_service_id;

  IF v_mode = 'in_person' AND v_category_slug IN ('babysitting', 'tutoring') THEN
    IF p_supervision_mode IS NULL
       OR p_supervision_mode NOT IN ('cameras', 'adult_present') THEN
      RAISE EXCEPTION
        'BOOKING_SUPERVISION_REQUIRED: Choose how your child will be supervised during this service.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  v_fingerprint := public.booking_request_fingerprint(
    p_provider_id,
    p_service_id,
    v_address,
    p_start_at,
    p_end_at,
    p_family_member_id,
    p_notes,
    p_promo_code_id,
    coalesce(p_requirement_selections, '[]'::jsonb),
    p_teaching_capability_id,
    p_teaching_subject_code,
    p_teaching_curriculum_code,
    p_teaching_level_code,
    p_supervision_mode,
    v_mode
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':' || p_idempotency_key::text, 0)
  );

  SELECT id, request_fingerprint INTO v_existing
  FROM public.bookings
  WHERE customer_id = v_uid AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION
        'BOOKING_DUPLICATE_REQUEST_CONFLICT: Idempotency key reused with different booking details.'
        USING ERRCODE = '23514';
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
  FROM public.providers
  WHERE id = p_provider_id;

  v_required_hours := GREATEST(
    COALESCE(v_min_hours_before_start, 2),
    COALESCE(v_provider_min_notice, 0)::numeric
  );
  IF p_start_at < now() + (v_required_hours * interval '1 hour') THEN
    RAISE EXCEPTION
      'BOOKING_INVALID_BOOKING_REQUEST: This start time is too soon for the provider to respond in time.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.marketplace_eligibility_internal(
      p_provider_id, p_service_id, v_address, v_mode
    ) e
    WHERE e.is_eligible
  ) THEN
    RAISE EXCEPTION
      'BOOKING_PROVIDER_INELIGIBLE: Provider is not eligible for this service mode and address.'
      USING ERRCODE = '23514';
  END IF;

  IF public.provider_cash_debt_blocked(p_provider_id) THEN
    RAISE EXCEPTION
      'BOOKING_PROVIDER_SETTLEMENT_BLOCKED: Provider cannot receive new bookings until platform balance is settled.'
      USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.create_booking_in_progress', 'on', true);

  BEGIN
    INSERT INTO public.bookings (
      customer_id,
      provider_id,
      service_id,
      address_id,
      start_at,
      end_at,
      status,
      notes,
      family_member_id,
      requirement_selections,
      promo_code_id,
      price_subtotal,
      price_discount,
      price_total,
      price_platform_fee,
      price_vat,
      price_extras_total,
      price_travel_fee,
      idempotency_key,
      request_fingerprint,
      currency,
      teaching_capability_id,
      teaching_subject_code,
      teaching_curriculum_code,
      teaching_level_code,
      supervision_mode,
      service_mode
    ) VALUES (
      v_uid,
      p_provider_id,
      p_service_id,
      v_address,
      p_start_at,
      p_end_at,
      'pending',
      NULLIF(btrim(p_notes), ''),
      p_family_member_id,
      coalesce(p_requirement_selections, '[]'::jsonb),
      p_promo_code_id,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      p_idempotency_key,
      v_fingerprint,
      'EGP',
      p_teaching_capability_id,
      NULLIF(btrim(p_teaching_subject_code), ''),
      NULLIF(btrim(p_teaching_curriculum_code), ''),
      NULLIF(btrim(p_teaching_level_code), ''),
      p_supervision_mode,
      v_mode
    )
    RETURNING id INTO v_booking_id;
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
      RAISE EXCEPTION
        'BOOKING_DUPLICATE_REQUEST_CONFLICT: Concurrent duplicate booking request.'
        USING ERRCODE = '23514';
    WHEN exclusion_violation THEN
      RAISE EXCEPTION
        'BOOKING_SLOT_UNAVAILABLE: That time slot is no longer available.'
        USING ERRCODE = '23514';
    WHEN SQLSTATE '23514' THEN
      RAISE;
    WHEN SQLSTATE '42501' THEN
      RAISE;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'BOOKING_%' THEN
        RAISE;
      END IF;
      RAISE EXCEPTION
        'BOOKING_INVALID_BOOKING_REQUEST: Unable to create booking.'
        USING ERRCODE = '23514';
  END;

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'created', v_created,
    'idempotent_replay', false
  );
END;
$$;