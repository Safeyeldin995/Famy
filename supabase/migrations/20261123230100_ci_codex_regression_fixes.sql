-- CI / Codex regression fixes on top of 20261123230000

-- Party-safe issue report reads (column grants + RLS; security_invoker view)
DROP POLICY IF EXISTS online_lesson_issue_reports_party_select ON public.online_lesson_issue_reports;
CREATE POLICY online_lesson_issue_reports_party_select
  ON public.online_lesson_issue_reports
  FOR SELECT
  TO authenticated
  USING (
    reported_by = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.bookings b
      JOIN public.providers p ON p.id = b.provider_id
      WHERE b.id = online_lesson_issue_reports.booking_id
        AND (
          b.customer_id = (SELECT auth.uid())
          OR p.profile_id = (SELECT auth.uid())
        )
    )
  );

CREATE OR REPLACE VIEW public.online_lesson_issue_reports_party AS
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

GRANT SELECT ON public.online_lesson_issue_reports_party TO authenticated;

-- Wallet checkout: align payable total with the pending payment row (Paymob order amount)
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

  v_due := COALESCE(
    NULLIF((v_pay.metadata->>'checkout_total')::numeric, 0),
    NULLIF(v_pay.amount, 0),
    COALESCE(v_booking.price_total, 0) + COALESCE(v_booking.carried_fees_amount, 0)
  );
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
          'wallet_applied', v_spend,
          'checkout_total', v_due
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

-- Provider-cancel wallet credit must settle the payment record (no duplicate admin refund)
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

NOTIFY pgrst, 'reload schema';