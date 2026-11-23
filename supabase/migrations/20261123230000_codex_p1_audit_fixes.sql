-- Codex P1/P2 audit fixes: wallet checkout spend, report ACL, payout hold, refund settlement, LiveKit webhook txn.

ALTER TABLE public.session_livekit_webhook_events
  ADD COLUMN IF NOT EXISTS processed_at timestamptz NULL;

CREATE OR REPLACE FUNCTION public.tg_guard_payment_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reviewer boolean;
BEGIN
  IF current_setting('app.ledger_internal_capture', true) = 'on'
     OR current_setting('app.wallet_checkout_adjust', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF auth.role() = 'service_role' OR (v_uid IS NULL AND auth.role() IS NULL) THEN RETURN NEW; END IF;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.customer_id <> v_uid THEN
      RAISE EXCEPTION 'Only the booking customer can initialize payment.' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public.bookings WHERE id = NEW.booking_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.payments WHERE booking_id = NEW.booking_id
               AND status NOT IN ('rejected', 'failed', 'refunded')) THEN
      RAISE EXCEPTION 'A payment already exists for this booking.' USING ERRCODE = '23514';
    END IF;
    NEW.status := CASE WHEN NEW.payment_method_type = 'manual_transfer'
      THEN 'pending_review'::public.payment_status ELSE 'pending'::public.payment_status END;
    NEW.provider_ref := NULL;
    NEW.metadata := '{}'::jsonb;
    NEW.paymob_order_id := NULL;
    NEW.paymob_integration_id := NULL;
    NEW.captured_at := NULL;
    NEW.reviewed_at := NULL;
    NEW.reviewed_by := NULL;
    NEW.rejection_reason := NULL;
    NEW.proof_path := NULL;
    NEW.proof_uploaded_at := NULL;
    NEW.created_at := now();
    RETURN NEW;
  END IF;

  v_reviewer := public.has_role(v_uid, 'admin') OR EXISTS (
    SELECT 1 FROM public.bookings b JOIN public.providers p ON p.id = b.provider_id
    WHERE b.id = OLD.booking_id AND p.profile_id = v_uid
  );
  IF OLD.payment_method_type = 'online' OR OLD.payment_method_code = 'paymob' OR OLD.method = 'paymob' THEN
    RAISE EXCEPTION 'Online payments can only be updated by the payment gateway.' USING ERRCODE = '42501';
  END IF;
  IF OLD.customer_id = v_uid AND NOT public.has_role(v_uid, 'admin') THEN
    IF OLD.status <> 'pending_review' OR OLD.payment_method_type <> 'manual_transfer'
       OR (to_jsonb(NEW) - ARRAY['proof_path','proof_uploaded_at','updated_at'])
          IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['proof_path','proof_uploaded_at','updated_at']) THEN
      RAISE EXCEPTION 'Customers may only upload pending payment proof.' USING ERRCODE = '42501';
    END IF;
    IF NEW.proof_path IS NOT NULL AND split_part(NEW.proof_path, '/', 1) <> OLD.booking_id::text THEN
      RAISE EXCEPTION 'Payment proof must belong to this booking.' USING ERRCODE = '42501';
    END IF;
    NEW.proof_uploaded_at := CASE WHEN NEW.proof_path IS NULL THEN NULL ELSE now() END;
  ELSIF v_reviewer THEN
    IF OLD.status NOT IN ('pending', 'pending_review') OR NEW.status NOT IN ('captured', 'rejected')
       OR (to_jsonb(NEW) - ARRAY['status','captured_at','reviewed_at','reviewed_by','rejection_reason','updated_at'])
          IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','captured_at','reviewed_at','reviewed_by','rejection_reason','updated_at']) THEN
      RAISE EXCEPTION 'Invalid manual payment review.' USING ERRCODE = '42501';
    END IF;
    NEW.reviewed_by := v_uid;
    NEW.reviewed_at := now();
    NEW.captured_at := CASE WHEN NEW.status = 'captured' THEN now() ELSE NULL END;
    NEW.rejection_reason := CASE WHEN NEW.status = 'rejected' THEN NEW.rejection_reason ELSE NULL END;
  ELSE
    RAISE EXCEPTION 'Payment update not authorized.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_guard_payment_writes() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_lock_payment_financials()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.ledger_internal_capture', true) = 'on'
     OR current_setting('app.wallet_checkout_adjust', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.booking_id IS DISTINCT FROM OLD.booking_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.currency IS DISTINCT FROM OLD.currency
  THEN
    RAISE EXCEPTION 'Payment amount, booking, customer, and currency cannot be changed after creation.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Wallet checkout: atomic debit + optional wallet-only capture
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_apply_wallet_at_checkout(
  p_payment_id uuid,
  p_customer_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pay public.payments%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_due numeric;
  v_available numeric;
  v_spend numeric;
  v_card numeric;
  v_key text;
  v_entry_id uuid;
  v_existing jsonb;
BEGIN
  IF v_uid IS NULL THEN
    IF p_customer_id IS NULL THEN
      RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;
    IF current_setting('role', true) <> 'service_role' THEN
      RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;
    v_uid := p_customer_id;
  END IF;

  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND OR v_pay.customer_id <> v_uid THEN
    RAISE EXCEPTION 'Payment not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_pay.status = 'captured' THEN
    RETURN jsonb_build_object(
      'payment_id', v_pay.id,
      'wallet_spent', COALESCE((v_pay.metadata->>'wallet_applied')::numeric, 0),
      'card_amount', 0,
      'paid_via_wallet_only', true
    );
  END IF;
  IF v_pay.status <> 'pending' THEN
    RAISE EXCEPTION 'Payment is not payable.' USING ERRCODE = '23514';
  END IF;

  v_existing := v_pay.metadata->'wallet_checkout';
  IF jsonb_typeof(v_existing) = 'object' AND (v_existing->>'applied')::boolean IS TRUE THEN
    RETURN v_existing || jsonb_build_object('payment_id', v_pay.id);
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_pay.booking_id FOR SHARE;

  PERFORM public.lock_customer_debts(v_uid);
  PERFORM public.lock_customer_wallet(v_uid);

  v_due := COALESCE(v_booking.price_total, 0) + COALESCE(v_booking.carried_fees_amount, 0);
  IF v_due <= 0 THEN
    RAISE EXCEPTION 'Nothing to pay.' USING ERRCODE = '23514';
  END IF;

  SELECT b.available_amount INTO v_available
  FROM public.customer_wallet_balances(v_uid) b;

  v_spend := LEAST(GREATEST(COALESCE(v_available, 0), 0), v_due);
  v_card := GREATEST(v_due - v_spend, 0);

  v_key := 'checkout_spend:' || p_payment_id::text;

  IF v_spend > 0 THEN
    IF v_spend > COALESCE(v_available, 0) + 0.0001 THEN
      RAISE EXCEPTION 'Insufficient wallet balance.' USING ERRCODE = '23514';
    END IF;
    v_entry_id := public.customer_wallet_insert_entry(
      v_uid, 'debit', v_spend, 'checkout_spend', v_booking.id, p_payment_id, NULL, v_key,
      jsonb_build_object('checkout_total', v_due)
    );
    IF v_entry_id IS NULL THEN
      SELECT e.id, e.amount INTO v_entry_id, v_spend
      FROM public.customer_wallet_entries e
      WHERE e.idempotency_key = v_key;
      IF v_entry_id IS NULL THEN
        RAISE EXCEPTION 'Wallet checkout debit could not be recorded.' USING ERRCODE = '23514';
      END IF;
      v_card := GREATEST(v_due - v_spend, 0);
    END IF;
  END IF;

  IF v_card <= 0.01 THEN
    PERFORM set_config('app.wallet_checkout_adjust', 'on', true);
    PERFORM set_config('app.ledger_internal_capture', 'on', true);
    UPDATE public.payments
    SET status = 'captured',
        captured_at = now(),
        amount = v_due,
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'wallet_checkout',
          jsonb_build_object(
            'applied', true,
            'checkout_total', v_due,
            'wallet_spent', v_spend,
            'card_amount', 0,
            'paid_via_wallet_only', true
          ),
          'wallet_applied', v_spend
        )
    WHERE id = p_payment_id;
    PERFORM set_config('app.ledger_internal_capture', 'off', true);
    PERFORM set_config('app.wallet_checkout_adjust', 'off', true);
    RETURN jsonb_build_object(
      'payment_id', p_payment_id,
      'wallet_spent', v_spend,
      'card_amount', 0,
      'paid_via_wallet_only', true
    );
  END IF;

  PERFORM set_config('app.wallet_checkout_adjust', 'on', true);
  UPDATE public.payments
  SET amount = round(v_card, 2),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'wallet_checkout',
        jsonb_build_object(
          'applied', true,
          'checkout_total', v_due,
          'wallet_spent', v_spend,
          'card_amount', round(v_card, 2),
          'paid_via_wallet_only', false
        ),
        'wallet_applied', v_spend,
        'checkout_total', v_due
      )
  WHERE id = p_payment_id;
  PERFORM set_config('app.wallet_checkout_adjust', 'off', true);

  RETURN jsonb_build_object(
    'payment_id', p_payment_id,
    'wallet_spent', v_spend,
    'card_amount', round(v_card, 2),
    'paid_via_wallet_only', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.customer_apply_wallet_at_checkout(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_apply_wallet_at_checkout(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_apply_wallet_at_checkout(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Lesson issue reports: no direct participant INSERT; participant-safe read view
-- ---------------------------------------------------------------------------
REVOKE INSERT ON public.online_lesson_issue_reports FROM authenticated;

DROP POLICY IF EXISTS online_lesson_issue_reports_party_insert ON public.online_lesson_issue_reports;

REVOKE SELECT ON public.online_lesson_issue_reports FROM authenticated;
GRANT SELECT (
  id,
  booking_id,
  reported_by,
  reporter_role,
  category,
  description,
  status,
  priority,
  minor_involved,
  created_at,
  resolved_at
) ON public.online_lesson_issue_reports TO authenticated;

GRANT SELECT (
  id,
  booking_id,
  reported_by,
  reporter_role,
  category,
  description,
  status,
  priority,
  minor_involved,
  created_at,
  resolved_at,
  resolved_by,
  admin_notes
) ON public.online_lesson_issue_reports TO service_role;

-- ---------------------------------------------------------------------------
-- Provider payout: reserve earnings under open lesson reports / holds
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_record_provider_payout(
  p_provider_id uuid,
  p_amount numeric,
  p_reference text,
  p_reason text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_net numeric;
  v_held numeric;
  v_payable numeric;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_reference IS NULL OR btrim(p_reference) = ''
     OR p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Amount, reference and reason are required' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('famy_provider_wallet:' || p_provider_id::text, 0));

  SELECT COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END), 0)
    INTO v_net
  FROM public.provider_ledger_entries e
  WHERE e.provider_id = p_provider_id;

  SELECT COALESCE(SUM(e.amount), 0) INTO v_held
  FROM public.provider_ledger_entries e
  JOIN public.bookings b ON b.id = e.booking_id
  WHERE e.provider_id = p_provider_id
    AND e.direction = 'credit'
    AND e.booking_id IS NOT NULL
    AND (
      COALESCE(b.provider_payout_held, false)
      OR EXISTS (
        SELECT 1 FROM public.online_lesson_issue_reports r
        WHERE r.booking_id = b.id AND r.status = 'open'
      )
    );

  v_payable := GREATEST(v_net - v_held, 0);

  IF p_amount > v_payable THEN
    RAISE EXCEPTION 'Payout exceeds payable balance after lesson-report holds' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.audit_reason', btrim(p_reason), true);
  v_id := public.ledger_insert_entry(
    p_provider_id, NULL, 'payout_sent', 'debit', p_amount,
    'manual_transfer', concat('ref:', btrim(p_reference), ' ', coalesce(btrim(p_note), '')), auth.uid(), NULL
  );
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Wallet cancellation credits settle external refund obligation on the payment
-- ---------------------------------------------------------------------------
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
    UPDATE public.payments
    SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'refund_settled_via_wallet', true,
      'refund_settled_at', now()
    )
    WHERE id = v_pay.id;
    PERFORM set_config('app.wallet_checkout_adjust', 'off', true);

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
      'The provider cancelled your booking. The full amount is in your wallet for your next Famy booking.',
      'Amount added to your Famy wallet',
      'تم إضافة المبلغ لمحفظة فامي',
      'The provider cancelled your booking. The full amount is in your wallet for your next Famy booking.',
      'ألغى مقدم الخدمة حجزك. المبلغ بالكامل في محفظتك لحجزك الجاي على فامي.',
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

CREATE OR REPLACE FUNCTION public.credit_customer_wallet_customer_cancelled(p_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_pay public.payments%ROWTYPE;
  v_fee numeric;
  v_credit numeric;
  v_entry_id uuid;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR COALESCE(v_booking.service_mode, 'in_person') <> 'online' THEN
    RETURN NULL;
  END IF;

  PERFORM public.lock_customer_debts(v_booking.customer_id);
  PERFORM public.lock_customer_wallet(v_booking.customer_id);

  IF NOT public.booking_money_held(p_booking_id) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_pay
  FROM public.payments
  WHERE booking_id = p_booking_id
    AND status = 'captured'
    AND COALESCE(payment_method_type, '') IN ('online', 'manual_transfer')
  ORDER BY captured_at DESC NULLS LAST, created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_fee := LEAST(public.booking_cancellation_fee(p_booking_id), v_pay.amount);
  v_credit := GREATEST(
    COALESCE(
      NULLIF((v_pay.metadata->>'checkout_total')::numeric, 0),
      v_pay.amount + COALESCE((v_pay.metadata->>'wallet_applied')::numeric, 0)
    ) - v_fee,
    0
  );

  IF v_credit > 0 THEN
    v_entry_id := public.customer_wallet_insert_entry(
      v_booking.customer_id,
      'credit',
      v_credit,
      'customer_cancelled_refund',
      p_booking_id,
      v_pay.id,
      NULL,
      'customer_cancelled:' || p_booking_id::text,
      jsonb_build_object('cancellation_fee', v_fee)
    );

    IF v_entry_id IS NOT NULL THEN
      PERFORM set_config('app.wallet_checkout_adjust', 'on', true);
      UPDATE public.payments
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'refund_settled_via_wallet', true,
        'refund_settled_at', now(),
        'wallet_refund_portion', v_credit,
        'cancellation_fee', v_fee
      )
      WHERE id = v_pay.id;
      PERFORM set_config('app.wallet_checkout_adjust', 'off', true);
    END IF;
  END IF;

  IF v_fee > 0 THEN
    PERFORM public.ledger_insert_entry(
      v_booking.provider_id,
      v_booking.id,
      'cancellation_fee_provider_share',
      'credit',
      v_fee,
      COALESCE(v_pay.payment_method_code, v_pay.payment_method_type),
      NULL,
      NULL,
      NULL
    );
  END IF;

  RETURN v_entry_id;
END;
$$;

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

  IF COALESCE((v_pay.metadata->>'refund_settled_via_wallet')::boolean, false) THEN
    RAISE EXCEPTION 'Refund already settled via customer wallet.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.customer_wallet_entries e
    WHERE e.payment_id = p_payment_id
      AND e.reason IN ('provider_cancelled', 'customer_cancelled_refund')
  ) THEN
    RAISE EXCEPTION 'Refund already settled via customer wallet.' USING ERRCODE = '23514';
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

-- ---------------------------------------------------------------------------
-- LiveKit webhook: dedupe + attendance in one transaction
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_livekit_session_webhook_event(
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
  v_rowcount integer;
  v_open record;
BEGIN
  IF p_event_id IS NULL OR btrim(p_event_id) = '' THEN
    RAISE EXCEPTION 'Event id required' USING ERRCODE = '23514';
  END IF;
  IF p_participant NOT IN ('customer', 'provider') THEN
    RETURN false;
  END IF;

  INSERT INTO public.session_livekit_webhook_events (
    id, booking_id, event_type, participant, event_at, processed_at
  ) VALUES (
    p_event_id, p_booking_id, p_event_type, p_participant, p_event_at, NULL
  )
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount = 0 THEN
    IF EXISTS (
      SELECT 1 FROM public.session_livekit_webhook_events e
      WHERE e.id = p_event_id AND e.processed_at IS NOT NULL
    ) THEN
      RETURN false;
    END IF;
  END IF;

  IF p_event_type = 'participant_joined' THEN
    INSERT INTO public.session_events (booking_id, participant, joined_at)
    VALUES (p_booking_id, p_participant, p_event_at);
  ELSIF p_event_type = 'participant_left' THEN
    SELECT se.id, se.joined_at INTO v_open
    FROM public.session_events se
    WHERE se.booking_id = p_booking_id
      AND se.participant = p_participant
      AND se.left_at IS NULL
    ORDER BY se.joined_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO public.session_events (booking_id, participant, joined_at, left_at)
      VALUES (p_booking_id, p_participant, p_event_at, p_event_at);
    ELSIF v_open.joined_at > p_event_at THEN
      INSERT INTO public.session_events (booking_id, participant, joined_at, left_at)
      VALUES (p_booking_id, p_participant, p_event_at, p_event_at);
    ELSE
      UPDATE public.session_events
      SET left_at = p_event_at
      WHERE id = v_open.id AND left_at IS NULL;
    END IF;
  ELSE
    UPDATE public.session_livekit_webhook_events
    SET processed_at = now()
    WHERE id = p_event_id;
    RETURN true;
  END IF;

  UPDATE public.session_livekit_webhook_events
  SET processed_at = now()
  WHERE id = p_event_id;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  DELETE FROM public.session_livekit_webhook_events
  WHERE id = p_event_id AND processed_at IS NULL;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_livekit_session_webhook_event(text, uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_livekit_session_webhook_event(text, uuid, text, text, timestamptz)
  TO service_role;

NOTIFY pgrst, 'reload schema';