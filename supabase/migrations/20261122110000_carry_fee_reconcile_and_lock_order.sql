-- Rule: when an open fee debt is resolved (paid, waived, or deducted from a refund) while it
-- is attached to a live booking (customer_debts.carried_booking_id), that booking's
-- carried_fees_amount is reduced so the customer cannot be charged twice.
-- Lock order: every path that touches debts and settlements takes lock_customer_debts first.

-- Allow internal reconciliation to adjust bookings.carried_fees_amount (normally frozen).
CREATE OR REPLACE FUNCTION public.tg_booking_lock_carried_fees()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.adjust_carried_fees', true) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.carried_fees_amount := OLD.carried_fees_amount;
  RETURN NEW;
END;
$$;

-- Drop carried amounts from a live booking when a fee debt stops riding on it.
CREATE OR REPLACE FUNCTION public.detach_carried_debt_from_booking(p_debt_id uuid, p_amount numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.customer_debts%ROWTYPE;
  v_cb public.bookings%ROWTYPE;
BEGIN
  SELECT * INTO v_d FROM public.customer_debts WHERE id = p_debt_id;
  IF v_d.carried_booking_id IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO v_cb FROM public.bookings WHERE id = v_d.carried_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_cb.status::text NOT IN ('cancelled', 'no_show') OR public.booking_money_held(v_cb.id) THEN
    PERFORM set_config('app.adjust_carried_fees', 'on', true);
    UPDATE public.bookings
    SET carried_fees_amount = GREATEST(carried_fees_amount - p_amount, 0)
    WHERE id = v_cb.id;
    PERFORM set_config('app.adjust_carried_fees', 'off', true);
  END IF;
  UPDATE public.customer_debts SET carried_booking_id = NULL WHERE id = p_debt_id;
END;
$$;
REVOKE ALL ON FUNCTION public.detach_carried_debt_from_booking(uuid, numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_waive_debt_on_rejected_no_show()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.customer_debts%ROWTYPE;
BEGIN
  IF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' AND NEW.reported_party = 'customer' THEN
    FOR v_d IN
      SELECT * FROM public.customer_debts
      WHERE booking_id = NEW.booking_id AND kind = 'no_show' AND status = 'open'
      FOR UPDATE
    LOOP
      PERFORM public.lock_customer_debts(v_d.customer_id);
      PERFORM public.detach_carried_debt_from_booking(v_d.id, v_d.amount);
      UPDATE public.customer_debts
      SET status = 'waived', resolved_at = now(), resolved_by = auth.uid(),
          resolution_note = 'No-show report rejected',
          carried_booking_id = NULL
      WHERE id = v_d.id;
    END LOOP;
  END IF;
  RETURN NEW;
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
  v_d public.customer_debts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_reference IS NULL OR btrim(p_reference) = '' THEN
    RAISE EXCEPTION 'Refund reference is required' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_booking FROM public.bookings b WHERE b.id = v_pay.booking_id;

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
  PERFORM public.lock_customer_debts(v_booking.customer_id);
  IF EXISTS (SELECT 1 FROM public.customer_debts d WHERE d.booking_id = v_booking.id AND d.status = 'paid') THEN
    v_fee := 0;
  ELSIF v_fee > 0 THEN
    FOR v_d IN
      SELECT * FROM public.customer_debts
      WHERE booking_id = v_booking.id AND status = 'open'
      FOR UPDATE
    LOOP
      PERFORM public.detach_carried_debt_from_booking(v_d.id, v_d.amount);
      UPDATE public.customer_debts
      SET status = 'paid', resolved_at = now(), resolved_by = auth.uid(),
          resolution_note = 'Deducted from the refund', carried_booking_id = NULL
      WHERE id = v_d.id;
    END LOOP;
  ELSE
    FOR v_d IN
      SELECT * FROM public.customer_debts
      WHERE booking_id = v_booking.id AND status = 'open'
      FOR UPDATE
    LOOP
      PERFORM public.detach_carried_debt_from_booking(v_d.id, v_d.amount);
      UPDATE public.customer_debts
      SET status = 'waived', resolved_at = now(), resolved_by = auth.uid(),
          resolution_note = 'Deducted from the refund', carried_booking_id = NULL
      WHERE id = v_d.id;
    END LOOP;
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

CREATE OR REPLACE FUNCTION public.paymob_apply_debt_settlement(
  p_paymob_transaction_id bigint, p_order_id bigint, p_integration_id bigint, p_currency text,
  p_success boolean, p_pending boolean, p_amount_cents bigint, p_provider_ref text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s public.customer_debt_settlements%ROWTYPE;
  v_customer_id uuid;
BEGIN
  SELECT customer_id INTO v_customer_id
  FROM public.customer_debt_settlements
  WHERE paymob_order_id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trusted Paymob order mapping not found.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.lock_customer_debts(v_customer_id);

  SELECT * INTO v_s FROM public.customer_debt_settlements WHERE paymob_order_id = p_order_id FOR UPDATE;
  IF v_s.method <> 'card' OR v_s.paymob_integration_id IS DISTINCT FROM p_integration_id
     OR v_s.currency IS DISTINCT FROM p_currency
     OR p_amount_cents IS NULL OR ROUND(v_s.amount * 100)::bigint <> p_amount_cents THEN
    RAISE EXCEPTION 'Paymob transaction does not match settlement.' USING ERRCODE = '23514';
  END IF;
  IF v_s.status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'ignored', true, 'reason', 'already_paid');
  END IF;
  IF p_pending THEN
    RETURN jsonb_build_object('ok', true, 'ignored', true, 'reason', 'pending');
  END IF;
  IF NOT p_success THEN
    UPDATE public.customer_debt_settlements
    SET status = CASE WHEN status = 'pending' THEN 'failed' ELSE status END, updated_at = now()
    WHERE id = v_s.id;
    RETURN jsonb_build_object('ok', true, 'settlement_id', v_s.id, 'status', 'failed');
  END IF;
  UPDATE public.customer_debt_settlements
  SET status = 'paid', paymob_transaction_id = p_paymob_transaction_id, updated_at = now()
  WHERE id = v_s.id;
  PERFORM public.settle_customer_debts(v_s.id, NULL);
  RETURN jsonb_build_object('ok', true, 'settlement_id', v_s.id, 'status', 'paid');
END;
$$;
REVOKE ALL ON FUNCTION public.paymob_apply_debt_settlement(bigint, bigint, bigint, text, boolean, boolean, bigint, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.settle_customer_debts(p_settlement_id uuid, p_actor uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s public.customer_debt_settlements%ROWTYPE;
  v_d public.customer_debts%ROWTYPE;
  v_count integer := 0;
  v_paid numeric := 0;
  v_customer_id uuid;
BEGIN
  SELECT customer_id INTO v_customer_id
  FROM public.customer_debt_settlements WHERE id = p_settlement_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  PERFORM public.lock_customer_debts(v_customer_id);
  SELECT * INTO v_s FROM public.customer_debt_settlements WHERE id = p_settlement_id FOR UPDATE;
  FOR v_d IN
    SELECT d.* FROM public.customer_debts d
    LEFT JOIN public.bookings cb ON cb.id = d.carried_booking_id
    WHERE d.id = ANY(v_s.debt_ids) AND d.status = 'open'
      AND (d.carried_booking_id IS NULL
           OR (cb.status::text IN ('cancelled', 'no_show') AND NOT public.booking_money_held(cb.id)))
    FOR UPDATE OF d
  LOOP
    UPDATE public.customer_debts
    SET status = 'paid', settlement_id = v_s.id, resolved_at = now(), resolved_by = p_actor,
        carried_booking_id = NULL
    WHERE id = v_d.id;
    PERFORM public.ledger_insert_entry(
      v_d.provider_id, v_d.booking_id, 'cancellation_fee_provider_share', 'credit', v_d.amount,
      v_s.method, NULL, p_actor, NULL
    );
    v_count := v_count + 1;
    v_paid := v_paid + v_d.amount;
  END LOOP;
  IF v_paid < v_s.amount THEN
    UPDATE public.customer_debt_settlements
    SET needs_refund = true, refund_amount = v_s.amount - v_paid, updated_at = now()
    WHERE id = v_s.id;
  END IF;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_customer_debts(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Same lock order when an admin confirms a debt settlement.
CREATE OR REPLACE FUNCTION public.admin_review_debt_settlement(p_settlement_id uuid, p_approve boolean, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s public.customer_debt_settlements%ROWTYPE;
  v_customer_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  SELECT customer_id INTO v_customer_id
  FROM public.customer_debt_settlements WHERE id = p_settlement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Settlement not found.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.lock_customer_debts(v_customer_id);
  SELECT * INTO v_s FROM public.customer_debt_settlements WHERE id = p_settlement_id FOR UPDATE;
  IF v_s.status <> 'pending_review' THEN
    RAISE EXCEPTION 'This payment is not waiting for review.' USING ERRCODE = '23514';
  END IF;
  IF NOT p_approve AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'A reason is required to reject.' USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('app.audit_reason', COALESCE(NULLIF(btrim(p_reason), ''), 'Debt settlement confirmed'), true);
  UPDATE public.customer_debt_settlements
  SET status = CASE WHEN p_approve THEN 'paid' ELSE 'rejected' END,
      reviewed_at = now(), reviewed_by = auth.uid(),
      rejection_reason = CASE WHEN p_approve THEN NULL ELSE btrim(p_reason) END,
      updated_at = now()
  WHERE id = v_s.id;
  IF p_approve THEN
    PERFORM public.settle_customer_debts(v_s.id, auth.uid());
  END IF;
END;
$$;