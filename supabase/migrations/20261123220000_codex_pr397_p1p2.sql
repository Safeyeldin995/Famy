-- Codex PR #397 P1+P2 fixes: age gate, lesson-report RLS, wallet checkout, payout hold,
-- wallet refund settlement, LiveKit webhook atomicity.

-- ---------------------------------------------------------------------------
-- 1) Restore online learner age gate in create_booking (PO wallet migration dropped it)
-- ---------------------------------------------------------------------------

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
  p_service_mode text DEFAULT 'in_person'
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
  v_age integer;
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

  -- Online bookings never retain an unrelated address reference.
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

  IF v_mode = 'online' THEN
    v_age := public.booking_online_age_years(v_uid, p_family_member_id);
    IF v_age IS NULL THEN
      RAISE EXCEPTION
        'BOOKING_ONLINE_BIRTH_DATE_REQUIRED: Add a date of birth before booking an online lesson.'
        USING ERRCODE = '23514';
    ELSIF v_age < 12 THEN
      RAISE EXCEPTION
        'BOOKING_ONLINE_AGE_MINIMUM: Online lessons are available from age 12.'
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


REVOKE ALL ON FUNCTION public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb,
  uuid, text, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb,
  uuid, text, text, text, text, text
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Lesson issue reports: RPC-only insert, party-safe read, payout hold reversal
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS online_lesson_issue_reports_party_insert
  ON public.online_lesson_issue_reports;
DROP POLICY IF EXISTS online_lesson_issue_reports_party_read
  ON public.online_lesson_issue_reports;

REVOKE INSERT ON public.online_lesson_issue_reports FROM authenticated;

CREATE OR REPLACE VIEW public.online_lesson_issue_reports_party
WITH (security_invoker = true) AS
SELECT
  r.id,
  r.booking_id,
  r.reported_by,
  r.reporter_role,
  r.category,
  r.description,
  r.status,
  r.priority,
  r.minor_involved,
  r.created_at,
  r.resolved_at,
  r.resolved_by
FROM public.online_lesson_issue_reports r
WHERE
  r.reported_by = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.providers p ON p.id = b.provider_id
    WHERE b.id = r.booking_id
      AND (b.customer_id = (SELECT auth.uid()) OR p.profile_id = (SELECT auth.uid()))
  )
  OR public.has_role((SELECT auth.uid()), 'admin');

REVOKE SELECT ON public.online_lesson_issue_reports FROM authenticated;
GRANT SELECT ON public.online_lesson_issue_reports_party TO authenticated;
GRANT SELECT ON public.online_lesson_issue_reports TO authenticated;

DROP POLICY IF EXISTS online_lesson_issue_reports_party_read
  ON public.online_lesson_issue_reports;
CREATE POLICY online_lesson_issue_reports_admin_table_read
  ON public.online_lesson_issue_reports FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));

CREATE OR REPLACE FUNCTION public.report_online_lesson_issue(
  p_booking_id uuid,
  p_category text,
  p_description text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_booking public.bookings%ROWTYPE;
  v_role text;
  v_age integer;
  v_minor boolean := false;
  v_id uuid;
  v_credited numeric;
  v_hold_key text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR SHARE;
  IF NOT FOUND OR v_booking.service_mode IS DISTINCT FROM 'online' THEN
    RAISE EXCEPTION 'Not an online lesson booking.' USING ERRCODE = '23514';
  END IF;

  SELECT CASE
    WHEN v_booking.customer_id = v_uid THEN 'customer'
    WHEN EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = v_booking.provider_id AND p.profile_id = v_uid
    ) THEN 'provider'
    ELSE NULL
  END INTO v_role;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
  END IF;

  IF now() < v_booking.start_at - interval '10 minutes'
     OR now() > v_booking.end_at + interval '24 hours' THEN
    RAISE EXCEPTION 'Reporting is closed for this lesson window.' USING ERRCODE = '23514';
  END IF;

  IF p_category NOT IN ('absence', 'connection', 'behavior') THEN
    RAISE EXCEPTION 'Invalid report category.' USING ERRCODE = '23514';
  END IF;

  IF btrim(p_description) = '' OR length(btrim(p_description)) < 10 THEN
    RAISE EXCEPTION 'Description required.' USING ERRCODE = '23514';
  END IF;

  v_age := public.booking_online_age_years(v_booking.customer_id, v_booking.family_member_id);
  v_minor := v_age IS NOT NULL AND v_age < 18;

  SELECT r.id INTO v_id
  FROM public.online_lesson_issue_reports r
  WHERE r.booking_id = p_booking_id
    AND r.reported_by = v_uid
    AND r.status = 'open';

  IF v_id IS NULL THEN
    INSERT INTO public.online_lesson_issue_reports (
      booking_id, reported_by, reporter_role, category, description, priority, minor_involved
    ) VALUES (
      p_booking_id, v_uid, v_role, p_category, btrim(p_description),
      CASE WHEN v_minor THEN 'high' ELSE 'normal' END,
      v_minor
    )
    RETURNING id INTO v_id;
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.bookings
    SET provider_payout_held = true
    WHERE id = p_booking_id AND provider_payout_held IS NOT TRUE;

    IF v_booking.status = 'completed' THEN
      SELECT COALESCE(SUM(e.amount), 0) INTO v_credited
      FROM public.provider_ledger_entries e
      WHERE e.booking_id = p_booking_id
        AND e.kind = 'online_provider_share'
        AND e.direction = 'credit';

      v_hold_key := 'lesson_report_hold:' || p_booking_id::text;

      IF v_credited > 0 AND NOT EXISTS (
        SELECT 1 FROM public.provider_ledger_entries e
        WHERE e.booking_id = p_booking_id
          AND e.kind = 'adjustment'
          AND e.direction = 'debit'
          AND e.note = v_hold_key
      ) THEN
        PERFORM public.ledger_insert_entry(
          v_booking.provider_id,
          p_booking_id,
          'adjustment',
          'debit',
          v_credited,
          NULL,
          v_hold_key,
          NULL,
          NULL
        );
      END IF;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.report_online_lesson_issue(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_online_lesson_issue(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Wallet checkout spend + wallet-only capture
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_customer_wallet_to_booking_payment(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pay public.payments%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_available numeric;
  v_wallet_spend numeric;
  v_key text;
  v_entry_id uuid;
  v_card_due numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_pay.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
  END IF;
  IF v_pay.status = 'captured' THEN
    RETURN jsonb_build_object(
      'wallet_spend', COALESCE((v_pay.metadata->>'wallet_checkout_spend')::numeric, 0),
      'card_due', 0,
      'captured', true
    );
  END IF;
  IF COALESCE(v_pay.payment_method_type, '') <> 'online' THEN
    RAISE EXCEPTION 'Only online booking payments can use wallet at checkout.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_pay.booking_id FOR SHARE;
  IF NOT FOUND OR v_booking.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.lock_customer_wallet(v_uid);
  SELECT available_amount INTO v_available FROM public.customer_wallet_balances(v_uid);

  PERFORM set_config('app.ledger_internal_capture', 'on', true);

  v_wallet_spend := COALESCE((v_pay.metadata->>'wallet_checkout_spend')::numeric, 0);
  IF v_wallet_spend <= 0 THEN
    v_wallet_spend := LEAST(GREATEST(COALESCE(v_available, 0), 0), v_pay.amount);
    IF v_wallet_spend > 0 THEN
      v_key := 'checkout_spend:' || p_payment_id::text;
      v_entry_id := public.customer_wallet_insert_entry(
        v_uid,
        'debit',
        v_wallet_spend,
        'checkout_spend',
        v_pay.booking_id,
        p_payment_id,
        NULL,
        v_key,
        jsonb_build_object('payment_amount', v_pay.amount)
      );
      IF v_entry_id IS NULL THEN
        PERFORM set_config('app.ledger_internal_capture', 'off', true);
        RAISE EXCEPTION 'Could not apply wallet at checkout.' USING ERRCODE = '23514';
      END IF;
      UPDATE public.payments
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'wallet_checkout_spend', v_wallet_spend,
        'wallet_checkout_entry_id', v_entry_id
      )
      WHERE id = p_payment_id;
    END IF;
  END IF;

  v_card_due := GREATEST(v_pay.amount - v_wallet_spend, 0);

  IF v_card_due <= 0.01 THEN
    UPDATE public.payments
    SET status = 'captured',
        captured_at = COALESCE(captured_at, now()),
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'captured_via', 'customer_wallet',
          'wallet_checkout_spend', v_wallet_spend
        )
    WHERE id = p_payment_id AND status IS DISTINCT FROM 'captured';
    PERFORM set_config('app.ledger_internal_capture', 'off', true);
    RETURN jsonb_build_object('wallet_spend', v_wallet_spend, 'card_due', 0, 'captured', true);
  END IF;

  PERFORM set_config('app.ledger_internal_capture', 'off', true);

  RETURN jsonb_build_object('wallet_spend', v_wallet_spend, 'card_due', v_card_due, 'captured', false);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_customer_wallet_to_booking_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_customer_wallet_to_booking_payment(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Wallet provider-cancel credits settle refund obligation on the payment
-- ---------------------------------------------------------------------------
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
    PERFORM set_config('app.ledger_internal_capture', 'on', true);
    UPDATE public.payments
    SET status = 'refunded',
        reviewed_at = COALESCE(reviewed_at, now()),
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'wallet_refund_settled', true,
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

REVOKE ALL ON FUNCTION public.credit_customer_wallet_provider_cancelled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credit_customer_wallet_provider_cancelled(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_record_payment_refund(
  p_payment_id uuid,
  p_reference text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay public.payments%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_fee numeric;
  v_carried numeric;
  v_method text;
  v_customer_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_reference IS NULL OR btrim(p_reference) = '' THEN
    RAISE EXCEPTION 'Refund reference is required' USING ERRCODE = '23514';
  END IF;

  SELECT b.customer_id INTO v_customer_id
  FROM public.payments p
  JOIN public.bookings b ON b.id = p.booking_id
  WHERE p.id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.lock_customer_debts(v_customer_id);

  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  SELECT * INTO v_booking FROM public.bookings b WHERE b.id = v_pay.booking_id;

  IF COALESCE(v_pay.metadata->>'wallet_refund_settled', 'false') = 'true' THEN
    RAISE EXCEPTION 'Refund already settled via customer wallet' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.customer_wallet_entries e
    WHERE e.payment_id = p_payment_id
      AND e.direction = 'credit'
      AND e.reason IN ('provider_cancelled', 'customer_cancelled')
  ) THEN
    RAISE EXCEPTION 'Refund already settled via customer wallet' USING ERRCODE = '23514';
  END IF;

  IF v_booking.status::text NOT IN ('cancelled', 'no_show') THEN
    RAISE EXCEPTION 'Refunds are recorded only for cancelled or no-show bookings' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (v_pay.status = 'captured' AND COALESCE(v_pay.payment_method_type, '') IN ('online', 'manual_transfer'))
    OR (v_pay.status = 'pending_review' AND v_pay.payment_method_type = 'manual_transfer'
        AND v_pay.proof_path IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'This payment has no money to refund' USING ERRCODE = '23514';
  END IF;
  v_method := COALESCE(v_pay.payment_method_code, v_pay.payment_method_type);

  v_carried := LEAST(public.settle_carried_fees(v_booking.id, v_method, auth.uid()), v_pay.amount);

  v_fee := LEAST(public.booking_cancellation_fee(v_booking.id), v_pay.amount - v_carried);
  IF EXISTS (SELECT 1 FROM public.customer_debts d WHERE d.booking_id = v_booking.id AND d.status = 'paid') THEN
    v_fee := 0;
  ELSIF EXISTS (
    SELECT 1 FROM public.customer_debts d
    JOIN public.bookings cb ON cb.id = d.carried_booking_id
    WHERE d.booking_id = v_booking.id AND d.status = 'open'
      AND cb.status::text NOT IN ('cancelled', 'no_show', 'completed')
  ) THEN
    v_fee := 0;
  ELSE
    UPDATE public.customer_debts
    SET status = 'waived', resolved_at = now(), resolved_by = auth.uid(),
        resolution_note = 'Deducted from the refund'
    WHERE booking_id = v_booking.id AND status = 'open';
  END IF;

  PERFORM set_config('app.audit_reason', 'Refund recorded: ' || btrim(p_reference), true);
  PERFORM set_config('app.ledger_internal_capture', 'on', true);
  UPDATE public.payments
  SET status = CASE WHEN v_fee + v_carried > 0 THEN 'partially_refunded'::public.payment_status
                    ELSE 'refunded'::public.payment_status END,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'refund', jsonb_build_object(
          'reference', btrim(p_reference),
          'amount_refunded', v_pay.amount - v_fee - v_carried,
          'cancellation_fee', v_fee,
          'carried_fees', v_carried,
          'recorded_at', now(),
          'recorded_by', auth.uid(),
          'previous_status', v_pay.status
        )
      )
  WHERE id = p_payment_id;
  PERFORM set_config('app.ledger_internal_capture', 'off', true);

  IF v_fee > 0 THEN
    PERFORM public.ledger_insert_entry(
      v_booking.provider_id, v_booking.id, 'cancellation_fee_provider_share', 'credit', v_fee,
      v_method, NULL, auth.uid(), NULL
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_record_payment_refund(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_record_payment_refund(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) LiveKit webhook attendance + dedupe in one transaction
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_livekit_session_webhook(
  p_event_id text,
  p_booking_id uuid,
  p_event_type text,
  p_participant text,
  p_event_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_open_id uuid;
  v_open_joined timestamptz;
  v_rows integer;
BEGIN
  IF p_event_id IS NULL OR btrim(p_event_id) = '' THEN
  RAISE EXCEPTION 'Event id required' USING ERRCODE = '23514';
  END IF;
  IF p_participant NOT IN ('customer', 'provider') THEN
    RAISE EXCEPTION 'Invalid participant' USING ERRCODE = '23514';
  END IF;
  v_role := p_participant;

  INSERT INTO public.session_livekit_webhook_events (
    id, booking_id, event_type, participant, event_at
  ) VALUES (
    p_event_id, p_booking_id, p_event_type, v_role, p_event_at
  )
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN false;
  END IF;

  IF p_event_type = 'participant_joined' THEN
    INSERT INTO public.session_events (
      booking_id, participant, joined_at
    ) VALUES (
      p_booking_id, v_role, p_event_at
    );
    RETURN true;
  END IF;

  IF p_event_type = 'participant_left' THEN
    SELECT se.id, se.joined_at
      INTO v_open_id, v_open_joined
    FROM public.session_events se
    WHERE se.booking_id = p_booking_id
      AND se.participant = v_role
      AND se.left_at IS NULL
    ORDER BY se.joined_at DESC
    LIMIT 1;

    IF v_open_id IS NULL THEN
      INSERT INTO public.session_events (
        booking_id, participant, joined_at, left_at
      ) VALUES (
        p_booking_id, v_role, p_event_at, p_event_at
      );
      RETURN true;
    END IF;

    IF v_open_joined > p_event_at THEN
      INSERT INTO public.session_events (
        booking_id, participant, joined_at, left_at
      ) VALUES (
        p_booking_id, v_role, p_event_at, p_event_at
      );
      RETURN true;
    END IF;

    UPDATE public.session_events
    SET left_at = p_event_at
    WHERE id = v_open_id;
    RETURN true;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_livekit_session_webhook(text, uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_livekit_session_webhook(text, uuid, text, text, timestamptz)
  TO service_role;

