-- Admin operations: wallet refunds and adjustments, the money card, and the
-- operations home.
--
--   * admin_refund_booking_to_wallet: refund a lesson's held money to the
--     customer's wallet, linked to the booking and payment, never above what
--     Famy holds, and never twice (card refund, wallet refund and the automatic
--     cancel/no-show refunds all check the same markers).
--   * admin_wallet_adjust: add or deduct balance with a category and a note,
--     an idempotency key per submit, no negative balance.
--   * admin_customer_wallet_history / admin_wallet_ledger: the full record,
--     with balance after each entry, who did it and why.
--   * admin_booking_money_summary: everything about a booking's money in one
--     call (price, payments, wallet movements, tutor ledger).
--   * admin_ops_today / admin_ops_problems: the operations home.
--
-- Builds on 20261126130100_audit_money_batch_a (#537): the wallet reason list
-- below is a superset of its list, and the admin idempotency key format is the
-- same ('admin_wallet:<customer>:<key>').
-- Every function is SECURITY DEFINER with search_path pinned and checks the
-- admin role. Internal wallet helpers stay service_role only (#429).

-- ---------------------------------------------------------------------------
-- Wallet reasons: add admin_lesson_refund
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_wallet_entries
  DROP CONSTRAINT IF EXISTS customer_wallet_entries_reason_check;
ALTER TABLE public.customer_wallet_entries
  ADD CONSTRAINT customer_wallet_entries_reason_check CHECK (reason IN (
    'provider_cancelled',
    'customer_cancelled_refund',
    'admin_credit',
    'admin_debit',
    'checkout_spend',
    'checkout_release',
    'paymob_superseded_capture',
    'forfeited_on_deletion',
    'online_no_show_refund',
    'admin_lesson_refund'
  ));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_wallet_category_label(p_category text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_category
    WHEN 'compensation' THEN 'تعويض'
    WHEN 'lesson_refund' THEN 'رد فلوس حصة'
    WHEN 'correction' THEN 'تصحيح خطأ'
    WHEN 'gift' THEN 'هدية'
    ELSE 'أخرى'
  END;
$$;

CREATE OR REPLACE FUNCTION public.customer_wallet_balance_internal(p_customer_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    sum(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END),
    0
  )
  FROM public.customer_wallet_entries e
  WHERE e.customer_id = p_customer_id;
$$;
REVOKE ALL ON FUNCTION public.customer_wallet_balance_internal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_wallet_balance_internal(uuid) TO service_role;

-- The payment that holds the booking's money (captured card or approved
-- transfer), newest capture first. Read-only; callers lock it themselves.
CREATE OR REPLACE FUNCTION public.admin_booking_funding_payment_id(p_booking_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
  FROM public.payments p
  WHERE p.booking_id = p_booking_id
    AND p.status IN ('captured', 'partially_refunded')
    AND COALESCE(p.payment_method_type, '') IN ('online', 'manual_transfer')
  ORDER BY (p.status = 'captured') DESC, p.captured_at DESC NULLS LAST, p.created_at DESC
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.admin_booking_funding_payment_id(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_booking_funding_payment_id(uuid) TO service_role;

-- Refund terms for a booking, without side effects. Mirrors
-- admin_record_payment_refund (fee to the tutor, carried fees settled) so a
-- wallet refund and a card refund give the customer the same amount.
CREATE OR REPLACE FUNCTION public.admin_booking_refund_terms(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b public.bookings%ROWTYPE;
  v_pay public.payments%ROWTYPE;
  v_pay_id uuid;
  v_funded numeric := 0;
  v_already numeric := 0;
  v_fee numeric := 0;
  v_carried numeric := 0;
  v_mode text;
  v_max numeric := 0;
  v_blocked text;
BEGIN
  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('blocked', 'booking_not_found');
  END IF;

  v_pay_id := public.admin_booking_funding_payment_id(p_booking_id);
  IF v_pay_id IS NOT NULL THEN
    SELECT * INTO v_pay FROM public.payments WHERE id = v_pay_id;
    v_funded := public.payment_checkout_funded_total(v_pay);
  END IF;

  IF v_b.status::text IN ('cancelled', 'no_show') THEN
    v_mode := 'cancelled';
  ELSIF v_b.status::text = 'completed' THEN
    v_mode := 'completed';
  ELSE
    v_mode := 'active';
  END IF;

  IF v_pay_id IS NULL THEN
    v_blocked := CASE
      WHEN EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.booking_id = p_booking_id AND p.status = 'refunded'
          AND COALESCE(p.payment_method_type, '') IN ('online', 'manual_transfer')
      ) THEN 'already_refunded'
      ELSE 'no_held_money'
    END;
  ELSIF v_mode = 'active' THEN
    v_blocked := 'booking_active';
  ELSIF v_mode = 'cancelled' THEN
    IF v_pay.status <> 'captured'
       OR COALESCE((v_pay.metadata->>'refund_settled_via_wallet')::boolean, false)
       OR COALESCE(v_pay.metadata->>'wallet_refund_settled', 'false') = 'true'
       OR EXISTS (
         SELECT 1 FROM public.customer_wallet_entries e
         WHERE e.payment_id = v_pay.id
           AND e.reason IN (
             'provider_cancelled', 'customer_cancelled_refund',
             'online_no_show_refund', 'admin_lesson_refund'
           )
       ) THEN
      v_blocked := 'already_refunded';
    ELSE
      v_carried := LEAST(COALESCE(v_b.carried_fees_amount, 0), v_funded);
      IF EXISTS (SELECT 1 FROM public.customer_debts d WHERE d.booking_id = v_b.id AND d.status = 'paid') THEN
        v_fee := 0;
      ELSIF EXISTS (
        SELECT 1 FROM public.customer_debts d
        JOIN public.bookings cb ON cb.id = d.carried_booking_id
        WHERE d.booking_id = v_b.id AND d.status = 'open'
          AND cb.status::text NOT IN ('cancelled', 'no_show', 'completed')
      ) THEN
        v_fee := 0;
      ELSE
        v_fee := LEAST(COALESCE(public.booking_cancellation_fee(v_b.id), 0), v_funded - v_carried);
      END IF;
      v_max := GREATEST(v_funded - v_fee - v_carried, 0);
    END IF;
  ELSE
    -- Completed lesson: a goodwill refund, possibly in several parts. The
    -- tutor keeps their share; the money comes from Famy.
    v_already := COALESCE((v_pay.metadata->>'wallet_refunded_total')::numeric, 0);
    IF v_pay.status <> 'captured' THEN
      v_blocked := 'already_refunded';
    END IF;
    v_max := GREATEST(v_funded - v_already, 0);
  END IF;

  IF v_blocked IS NULL AND v_max <= 0 THEN
    v_blocked := 'nothing_left';
  END IF;

  RETURN jsonb_build_object(
    'booking_id', v_b.id,
    'customer_id', v_b.customer_id,
    'booking_status', v_b.status,
    'mode', v_mode,
    'payment_id', v_pay_id,
    'payment_status', v_pay.status,
    'payment_method_type', v_pay.payment_method_type,
    'funded_total', v_funded,
    'already_refunded', v_already,
    'cancellation_fee', v_fee,
    'carried_fees', v_carried,
    'max_refundable', CASE WHEN v_blocked IS NULL THEN v_max ELSE 0 END,
    'blocked', v_blocked
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_booking_refund_terms(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_booking_refund_terms(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Admin: what can be refunded to the wallet for this booking
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_booking_wallet_refund_quote(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required.' USING ERRCODE = '42501';
  END IF;
  RETURN public.admin_booking_refund_terms(p_booking_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_booking_wallet_refund_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_booking_wallet_refund_quote(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Admin: refund a lesson's price to the customer's wallet
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_refund_booking_to_wallet(
  p_booking_id uuid,
  p_amount numeric,
  p_note text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_b public.bookings%ROWTYPE;
  v_pay public.payments%ROWTYPE;
  v_terms jsonb;
  v_key text;
  v_existing public.customer_wallet_entries%ROWTYPE;
  v_entry_id uuid;
  v_max numeric;
  v_fee numeric := 0;
  v_carried numeric := 0;
  v_method text;
  v_amount_txt text;
  v_service_ar text;
  v_service_en text;
  v_already numeric;
BEGIN
  IF v_admin IS NULL OR NOT public.has_role(v_admin, 'admin') THEN
    RAISE EXCEPTION 'Admin required.' USING ERRCODE = '42501';
  END IF;
  IF v_note IS NULL THEN
    RAISE EXCEPTION 'WALLET_REASON_REQUIRED: A reason is required.' USING ERRCODE = '23514';
  END IF;
  IF NULLIF(btrim(COALESCE(p_idempotency_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'WALLET_IDEMPOTENCY_KEY_REQUIRED: An idempotency key is required.' USING ERRCODE = '23514';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'WALLET_AMOUNT_INVALID: The amount must be positive.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Same lock order as the automatic refund paths: debts, wallet, payment.
  PERFORM public.lock_customer_debts(v_b.customer_id);
  PERFORM public.lock_customer_wallet(v_b.customer_id);

  v_key := 'admin_lesson_refund:' || p_booking_id::text || ':' || btrim(p_idempotency_key);
  SELECT * INTO v_existing FROM public.customer_wallet_entries e WHERE e.idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.amount <> p_amount THEN
      RAISE EXCEPTION 'WALLET_IDEMPOTENCY_CONFLICT: This key was already used for a different amount.'
        USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('wallet_entry_id', v_existing.id, 'amount', v_existing.amount, 'replayed', true);
  END IF;

  v_terms := public.admin_booking_refund_terms(p_booking_id);
  IF v_terms->>'blocked' IS NOT NULL THEN
    RAISE EXCEPTION 'WALLET_REFUND_BLOCKED:%', v_terms->>'blocked' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_pay FROM public.payments WHERE id = (v_terms->>'payment_id')::uuid FOR UPDATE;
  -- Re-read the terms now that the payment row is locked.
  v_terms := public.admin_booking_refund_terms(p_booking_id);
  IF v_terms->>'blocked' IS NOT NULL OR (v_terms->>'payment_id')::uuid IS DISTINCT FROM v_pay.id THEN
    RAISE EXCEPTION 'WALLET_REFUND_BLOCKED:%', COALESCE(v_terms->>'blocked', 'changed') USING ERRCODE = '23514';
  END IF;

  v_max := (v_terms->>'max_refundable')::numeric;
  IF p_amount > v_max THEN
    RAISE EXCEPTION 'WALLET_REFUND_TOO_HIGH: At most % can be refunded.', v_max USING ERRCODE = '23514';
  END IF;

  v_method := COALESCE(v_pay.payment_method_code, v_pay.payment_method_type);

  IF v_terms->>'mode' = 'cancelled' THEN
    -- Settle carried fees and the cancellation fee exactly like a card refund.
    v_carried := LEAST(public.settle_carried_fees(v_b.id, v_method, v_admin), (v_terms->>'funded_total')::numeric);
    v_fee := (v_terms->>'cancellation_fee')::numeric;
    -- Same debt handling as admin_record_payment_refund: an open fee debt on
    -- this booking is covered by the refund deduction, unless it was already
    -- paid or carried into a booking that is still active.
    IF NOT EXISTS (SELECT 1 FROM public.customer_debts d WHERE d.booking_id = v_b.id AND d.status = 'paid')
       AND NOT EXISTS (
         SELECT 1 FROM public.customer_debts d
         JOIN public.bookings cb ON cb.id = d.carried_booking_id
         WHERE d.booking_id = v_b.id AND d.status = 'open'
           AND cb.status::text NOT IN ('cancelled', 'no_show', 'completed')
       ) THEN
      UPDATE public.customer_debts
      SET status = 'waived', resolved_at = now(), resolved_by = v_admin,
          resolution_note = 'Deducted from the wallet refund'
      WHERE booking_id = v_b.id AND status = 'open';
    END IF;
    IF v_fee > 0 THEN
      PERFORM public.ledger_insert_entry(
        v_b.provider_id, v_b.id, 'cancellation_fee_provider_share', 'credit', v_fee,
        v_method, NULL, v_admin, NULL
      );
    END IF;
  END IF;

  v_entry_id := public.customer_wallet_insert_entry(
    v_b.customer_id,
    'credit',
    p_amount,
    'admin_lesson_refund',
    v_b.id,
    v_pay.id,
    v_admin,
    v_key,
    jsonb_build_object(
      'admin_reason', v_note,
      'category', 'lesson_refund',
      'mode', v_terms->>'mode'
    )
  );

  PERFORM set_config('app.audit_reason', 'Wallet refund: ' || v_note, true);
  PERFORM set_config('app.wallet_checkout_adjust', 'on', true);
  PERFORM set_config('app.ledger_internal_capture', 'on', true);
  IF v_terms->>'mode' = 'cancelled' THEN
    UPDATE public.payments
    SET status = CASE
          WHEN v_fee + v_carried > 0 OR p_amount < v_max THEN 'partially_refunded'::public.payment_status
          ELSE 'refunded'::public.payment_status
        END,
        reviewed_by = v_admin,
        reviewed_at = now(),
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'refund_settled_via_wallet', true,
          'wallet_refund_settled', true,
          'refund_settled_at', now(),
          'wallet_refunded_total', p_amount,
          'refund', jsonb_build_object(
            'channel', 'customer_wallet',
            'amount_refunded', p_amount,
            'cancellation_fee', v_fee,
            'carried_fees', v_carried,
            'kept_by_famy', GREATEST(v_max - p_amount, 0),
            'funded_total', (v_terms->>'funded_total')::numeric,
            'wallet_entry_id', v_entry_id,
            'note', v_note,
            'recorded_at', now(),
            'recorded_by', v_admin,
            'previous_status', v_pay.status
          )
        )
    WHERE id = v_pay.id;
  ELSE
    -- Completed lesson: the payment stays captured so the tutor's share and
    -- the ledger are untouched; the refunded total is tracked on the payment.
    v_already := COALESCE((v_pay.metadata->>'wallet_refunded_total')::numeric, 0);
    UPDATE public.payments
    SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'wallet_refunded_total', v_already + p_amount,
          'wallet_goodwill_refunds',
            COALESCE(metadata->'wallet_goodwill_refunds', '[]'::jsonb) || jsonb_build_array(
              jsonb_build_object(
                'amount', p_amount,
                'wallet_entry_id', v_entry_id,
                'note', v_note,
                'recorded_at', now(),
                'recorded_by', v_admin
              )
            )
        )
    WHERE id = v_pay.id;
  END IF;
  PERFORM set_config('app.ledger_internal_capture', 'off', true);
  PERFORM set_config('app.wallet_checkout_adjust', 'off', true);

  SELECT s.name_ar, s.name_en INTO v_service_ar, v_service_en
  FROM public.services s WHERE s.id = v_b.service_id;
  v_amount_txt := trim(to_char(p_amount, 'FM999999990.##'));

  INSERT INTO public.notifications (
    user_id, type, category, title, body, title_en, title_ar, body_en, body_ar,
    payload, deep_link, booking_id
  ) VALUES (
    v_b.customer_id,
    'wallet_lesson_refund',
    'booking',
    'Refund added to your wallet',
    v_amount_txt || ' EGP for your ' || COALESCE(v_service_en, 'lesson') || ' booking was added to your Famy wallet.',
    'Refund added to your wallet',
    'رجعنالك فلوس في المحفظة',
    v_amount_txt || ' EGP for your ' || COALESCE(v_service_en, 'lesson') || ' booking was added to your Famy wallet.',
    'رجعنالك ' || v_amount_txt || ' ج.م في محفظتك من حجز ' || COALESCE(v_service_ar, 'الحصة') || '، وتقدر تستخدمهم في أي حجز جاي',
    jsonb_build_object('wallet_entry_id', v_entry_id, 'amount', p_amount, 'booking_id', v_b.id),
    '/wallet',
    v_b.id
  );

  RETURN jsonb_build_object(
    'wallet_entry_id', v_entry_id,
    'amount', p_amount,
    'cancellation_fee', v_fee,
    'carried_fees', v_carried,
    'replayed', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_refund_booking_to_wallet(uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_refund_booking_to_wallet(uuid, numeric, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Admin: add or deduct wallet balance with a category
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_wallet_adjust(
  p_customer_id uuid,
  p_direction text,
  p_amount numeric,
  p_category text,
  p_note text,
  p_booking_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_key text;
  v_existing public.customer_wallet_entries%ROWTYPE;
  v_balance numeric;
  v_entry_id uuid;
  v_reason_text text;
  v_amount_txt text;
BEGIN
  IF v_admin IS NULL OR NOT public.has_role(v_admin, 'admin') THEN
    RAISE EXCEPTION 'Admin required.' USING ERRCODE = '42501';
  END IF;
  IF p_direction NOT IN ('credit', 'debit') THEN
    RAISE EXCEPTION 'Invalid wallet direction.' USING ERRCODE = '23514';
  END IF;
  IF p_category IS NULL OR p_category NOT IN ('compensation', 'lesson_refund', 'correction', 'gift', 'other') THEN
    RAISE EXCEPTION 'WALLET_CATEGORY_INVALID: Pick a reason.' USING ERRCODE = '23514';
  END IF;
  IF p_category = 'other' AND v_note IS NULL THEN
    RAISE EXCEPTION 'WALLET_REASON_REQUIRED: Write the reason.' USING ERRCODE = '23514';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'WALLET_AMOUNT_INVALID: The amount must be positive.' USING ERRCODE = '23514';
  END IF;
  IF NULLIF(btrim(COALESCE(p_idempotency_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'WALLET_IDEMPOTENCY_KEY_REQUIRED: An idempotency key is required.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p_customer_id AND ur.role = 'customer'
  ) THEN
    RAISE EXCEPTION 'Customer not found.' USING ERRCODE = 'P0002';
  END IF;
  IF p_booking_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.bookings b WHERE b.id = p_booking_id AND b.customer_id = p_customer_id
  ) THEN
    RAISE EXCEPTION 'WALLET_BOOKING_MISMATCH: This booking is not the customer''s.' USING ERRCODE = '23514';
  END IF;

  PERFORM public.lock_customer_debts(p_customer_id);
  PERFORM public.lock_customer_wallet(p_customer_id);

  -- Same key format as admin_adjust_customer_wallet so a retry from either
  -- screen is detected.
  v_key := 'admin_wallet:' || p_customer_id::text || ':' || btrim(p_idempotency_key);
  SELECT * INTO v_existing FROM public.customer_wallet_entries e WHERE e.idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.direction <> p_direction OR v_existing.amount <> p_amount
       OR v_existing.customer_id <> p_customer_id THEN
      RAISE EXCEPTION 'WALLET_IDEMPOTENCY_CONFLICT: This key was already used for a different wallet adjustment.'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;

  v_balance := public.customer_wallet_balance_internal(p_customer_id);
  IF p_direction = 'debit' AND v_balance < p_amount THEN
    RAISE EXCEPTION 'WALLET_INSUFFICIENT: Wallet balance is insufficient for this debit.' USING ERRCODE = '23514';
  END IF;

  v_reason_text := public.admin_wallet_category_label(p_category)
    || CASE WHEN v_note IS NOT NULL THEN ': ' || v_note ELSE '' END;

  v_entry_id := public.customer_wallet_insert_entry(
    p_customer_id,
    p_direction,
    p_amount,
    CASE WHEN p_direction = 'credit' THEN 'admin_credit' ELSE 'admin_debit' END,
    p_booking_id,
    NULL,
    v_admin,
    v_key,
    jsonb_build_object('admin_reason', v_reason_text, 'category', p_category, 'note', v_note)
  );

  -- Credits are announced by tg_customer_wallet_credit_notify; tell the
  -- customer about deductions too.
  IF p_direction = 'debit' THEN
    v_amount_txt := trim(to_char(p_amount, 'FM999999990.##'));
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar,
      payload, deep_link, booking_id
    ) VALUES (
      p_customer_id,
      'wallet_debited',
      'system',
      'Wallet balance deducted',
      v_amount_txt || ' EGP was deducted from your Famy wallet.',
      'Wallet balance deducted',
      'اتخصم من رصيد محفظتك',
      v_amount_txt || ' EGP was deducted from your Famy wallet.',
      'اتخصم ' || v_amount_txt || ' ج.م من محفظتك. السبب: ' || v_reason_text,
      jsonb_build_object('wallet_entry_id', v_entry_id, 'amount', p_amount),
      '/wallet',
      p_booking_id
    );
  END IF;

  RETURN v_entry_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_wallet_adjust(uuid, text, numeric, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_wallet_adjust(uuid, text, numeric, text, text, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Admin: one customer's wallet history, with the balance after each entry
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_customer_wallet_history(
  p_customer_id uuid,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit int := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_rows jsonb;
  v_total bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required.' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total FROM public.customer_wallet_entries e WHERE e.customer_id = p_customer_id;

  WITH ordered AS (
    SELECT
      e.*,
      sum(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END)
        OVER (ORDER BY e.created_at, e.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance_after
    FROM public.customer_wallet_entries e
    WHERE e.customer_id = p_customer_id
  ),
  page AS (
    SELECT o.*, a.full_name AS admin_name
    FROM ordered o
    LEFT JOIN public.profiles a ON a.id = o.admin_id
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'created_at', created_at,
    'direction', direction,
    'amount', amount,
    'reason', reason,
    'balance_after', balance_after,
    'booking_id', booking_id,
    'payment_id', payment_id,
    'admin_id', admin_id,
    'admin_name', admin_name,
    'category', metadata->>'category',
    'note', COALESCE(metadata->>'note', metadata->>'admin_reason')
  ) ORDER BY created_at DESC, id DESC), '[]'::jsonb)
  INTO v_rows
  FROM page;

  RETURN jsonb_build_object(
    'balance', public.customer_wallet_balance_internal(p_customer_id),
    'total', v_total,
    'items', v_rows
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_customer_wallet_history(uuid, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_customer_wallet_history(uuid, int, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- Admin: all wallet movements, filterable by date, admin and reason
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_wallet_ledger(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_admin_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit int := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_rows jsonb;
  v_total bigint;
  v_credits numeric;
  v_debits numeric;
  v_admins jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required.' USING ERRCODE = '42501';
  END IF;

  WITH filtered AS (
    SELECT e.*
    FROM public.customer_wallet_entries e
    WHERE (p_from IS NULL OR e.created_at >= p_from)
      AND (p_to IS NULL OR e.created_at < p_to)
      AND (p_admin_id IS NULL OR e.admin_id = p_admin_id)
      AND (p_reason IS NULL OR e.reason = p_reason)
  )
  SELECT
    count(*),
    COALESCE(sum(amount) FILTER (WHERE direction = 'credit'), 0),
    COALESCE(sum(amount) FILTER (WHERE direction = 'debit'), 0)
  INTO v_total, v_credits, v_debits
  FROM filtered;

  WITH filtered AS (
    SELECT e.*
    FROM public.customer_wallet_entries e
    WHERE (p_from IS NULL OR e.created_at >= p_from)
      AND (p_to IS NULL OR e.created_at < p_to)
      AND (p_admin_id IS NULL OR e.admin_id = p_admin_id)
      AND (p_reason IS NULL OR e.reason = p_reason)
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'created_at', f.created_at,
    'customer_id', f.customer_id,
    'customer_name', c.full_name,
    'direction', f.direction,
    'amount', f.amount,
    'reason', f.reason,
    'booking_id', f.booking_id,
    'admin_id', f.admin_id,
    'admin_name', a.full_name,
    'category', f.metadata->>'category',
    'note', COALESCE(f.metadata->>'note', f.metadata->>'admin_reason')
  ) ORDER BY f.created_at DESC, f.id DESC), '[]'::jsonb)
  INTO v_rows
  FROM filtered f
  LEFT JOIN public.profiles c ON c.id = f.customer_id
  LEFT JOIN public.profiles a ON a.id = f.admin_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.admin_id, 'name', x.full_name) ORDER BY x.full_name), '[]'::jsonb)
  INTO v_admins
  FROM (
    SELECT DISTINCT e.admin_id, p.full_name
    FROM public.customer_wallet_entries e
    JOIN public.profiles p ON p.id = e.admin_id
    WHERE e.admin_id IS NOT NULL
  ) x;

  RETURN jsonb_build_object(
    'total', v_total,
    'credits', v_credits,
    'debits', v_debits,
    'admins', v_admins,
    'items', v_rows
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_wallet_ledger(timestamptz, timestamptz, uuid, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_wallet_ledger(timestamptz, timestamptz, uuid, text, int, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- Admin: a booking's money in one call
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_booking_money_summary(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b public.bookings%ROWTYPE;
  v_payments jsonb;
  v_wallet jsonb;
  v_ledger jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'status', p.status,
    'method_type', p.payment_method_type,
    'method', p.method,
    'amount', p.amount,
    'funded_total', public.payment_checkout_funded_total(p),
    'wallet_applied', COALESCE((p.metadata->>'wallet_applied')::numeric, 0),
    'wallet_released', COALESCE((p.metadata->>'wallet_checkout_released')::numeric, 0),
    'refund_amount', COALESCE((p.metadata->'refund'->>'amount_refunded')::numeric, 0),
    'refund_channel', p.metadata->'refund'->>'channel',
    'refund_reference', p.metadata->'refund'->>'reference',
    'wallet_refunded_total', COALESCE((p.metadata->>'wallet_refunded_total')::numeric, 0),
    'captured_at', p.captured_at,
    'created_at', p.created_at
  ) ORDER BY p.created_at), '[]'::jsonb)
  INTO v_payments
  FROM public.payments p
  WHERE p.booking_id = p_booking_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'direction', e.direction,
    'amount', e.amount,
    'reason', e.reason,
    'created_at', e.created_at,
    'admin_name', a.full_name,
    'note', COALESCE(e.metadata->>'note', e.metadata->>'admin_reason')
  ) ORDER BY e.created_at), '[]'::jsonb)
  INTO v_wallet
  FROM public.customer_wallet_entries e
  LEFT JOIN public.profiles a ON a.id = e.admin_id
  WHERE e.booking_id = p_booking_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'kind', l.kind,
    'direction', l.direction,
    'amount', l.amount,
    'created_at', l.created_at
  ) ORDER BY l.created_at), '[]'::jsonb)
  INTO v_ledger
  FROM public.provider_ledger_entries l
  WHERE l.booking_id = p_booking_id;

  RETURN jsonb_build_object(
    'booking_id', v_b.id,
    'status', v_b.status,
    'service_mode', v_b.service_mode,
    'price_total', v_b.price_total,
    'price_discount', v_b.price_discount,
    'carried_fees_amount', v_b.carried_fees_amount,
    'commission_amount', v_b.price_commission_amount,
    'commission_percent', v_b.price_commission_percent,
    'provider_net', v_b.price_provider_net,
    'payments', v_payments,
    'wallet_entries', v_wallet,
    'provider_ledger', v_ledger,
    'refund_terms', public.admin_booking_refund_terms(p_booking_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_booking_money_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_booking_money_summary(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Admin operations home: today, and what is broken
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ops_today()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz := date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo';
  v_end timestamptz := v_start + interval '1 day';
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'lessons_today', (SELECT count(*) FROM public.bookings b
                      WHERE b.start_at >= v_start AND b.start_at < v_end
                        AND b.status::text NOT IN ('cancelled')),
    'requests_today', (SELECT count(*) FROM public.bookings b
                       WHERE b.created_at >= v_start AND b.created_at < v_end),
    'completed_today', (SELECT count(*) FROM public.bookings b
                        WHERE b.status = 'completed'
                          AND COALESCE(b.completed_at, b.status_changed_at, b.end_at) >= v_start
                          AND COALESCE(b.completed_at, b.status_changed_at, b.end_at) < v_end),
    'cancelled_today', (SELECT count(*) FROM public.bookings b
                        WHERE b.status = 'cancelled'
                          AND COALESCE(b.cancelled_at, b.status_changed_at, b.updated_at) >= v_start
                          AND COALESCE(b.cancelled_at, b.status_changed_at, b.updated_at) < v_end),
    'paid_today', (SELECT COALESCE(sum(public.payment_checkout_funded_total(p)), 0)
                   FROM public.payments p
                   WHERE p.status IN ('captured', 'partially_refunded')
                     AND p.captured_at >= v_start AND p.captured_at < v_end),
    'commission_today', (SELECT COALESCE(sum(b.price_commission_amount), 0)
                         FROM public.bookings b
                         WHERE b.status = 'completed'
                           AND COALESCE(b.completed_at, b.status_changed_at, b.end_at) >= v_start
                           AND COALESCE(b.completed_at, b.status_changed_at, b.end_at) < v_end)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ops_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ops_today() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_ops_problems()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paymob bigint;
  v_unmapped bigint;
  v_push bigint;
  v_errors bigint;
  v_stuck_pending bigint;
  v_stuck_active bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required.' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_paymob
  FROM public.payments p
  WHERE p.metadata ? 'capture_shortfall'
     OR (COALESCE((p.metadata->>'needs_admin_review')::boolean, false)
         AND p.metadata->>'paymob_resolved_at' IS NULL);

  SELECT count(*) INTO v_unmapped
  FROM public.paymob_unmapped_captures u
  WHERE u.needs_admin_review AND u.reconciled_payment_id IS NULL;

  SELECT count(*) INTO v_push
  FROM public.notification_outbox o
  WHERE o.status IN ('failed', 'dead')
    AND o.created_at >= now() - interval '7 days';

  SELECT count(*) INTO v_errors
  FROM public.error_logs l
  WHERE l.created_at >= now() - interval '24 hours';

  -- A request still pending after its start time means the expiry job did
  -- not run.
  SELECT count(*) INTO v_stuck_pending
  FROM public.bookings b
  WHERE b.status = 'pending' AND b.start_at < now() - interval '30 minutes';

  -- Accepted or under way, but ended more than 6 hours ago without being
  -- closed.
  SELECT count(*) INTO v_stuck_active
  FROM public.bookings b
  WHERE b.status::text IN ('confirmed', 'on_the_way', 'arrived', 'arrival_confirmed', 'in_progress', 'completion_requested')
    AND b.end_at < now() - interval '6 hours';

  RETURN jsonb_build_object(
    'paymob_flags', v_paymob + v_unmapped,
    'push_failures', v_push,
    'app_errors', v_errors,
    'stuck_pending', v_stuck_pending,
    'stuck_active', v_stuck_active
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ops_problems() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ops_problems() TO authenticated;
