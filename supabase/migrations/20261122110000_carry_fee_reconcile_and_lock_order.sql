-- Carried-fee double-charge rule: bookings.carried_fees_amount never changes after creation.
-- If this booking's own fee debt already rides on a live later booking, refunds and rejected
-- no-shows must not take the fee again or close the debt — the later booking collects it once.
--
-- Global lock order (no path may lock or update a bookings row after lock_customer_debts):
--   booking row (only when this path changes a booking)
--   → customer advisory lock (lock_customer_debts)
--   → no-show report row
--   → customer_debts rows
--   → customer_debt_settlements rows
-- Status-transition triggers run after the booking row is locked by UPDATE (booking → customer → debt).

DROP FUNCTION IF EXISTS public.detach_carried_debt_from_booking(uuid, numeric);

CREATE OR REPLACE FUNCTION public.tg_booking_lock_carried_fees()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.carried_fees_amount := OLD.carried_fees_amount;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_waive_debt_on_rejected_no_show()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer uuid;
BEGIN
  IF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' AND NEW.reported_party = 'customer' THEN
    SELECT customer_id INTO v_customer FROM public.bookings WHERE id = NEW.booking_id;
    PERFORM public.lock_customer_debts(v_customer);
    IF EXISTS (
      SELECT 1 FROM public.customer_debts d
      JOIN public.bookings cb ON cb.id = d.carried_booking_id
      WHERE d.booking_id = NEW.booking_id AND d.kind = 'no_show' AND d.status = 'open'
        AND cb.status::text NOT IN ('cancelled', 'no_show', 'completed')
    ) THEN
      RAISE EXCEPTION
        'This fee is already added to the customer''s next booking. Resolve it after that booking ends.'
        USING ERRCODE = '23514';
    END IF;
    UPDATE public.customer_debts
    SET status = 'waived', resolved_at = now(), resolved_by = auth.uid(),
        resolution_note = 'No-show report rejected'
    WHERE booking_id = NEW.booking_id AND kind = 'no_show' AND status = 'open';
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

CREATE OR REPLACE FUNCTION public.admin_payment_refund_breakdown(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay public.payments%ROWTYPE;
  v_carried numeric;
  v_fee numeric;
  v_booking_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found' USING ERRCODE = 'P0002';
  END IF;
  v_booking_id := v_pay.booking_id;
  SELECT LEAST(COALESCE(sum(d.amount), 0), v_pay.amount) INTO v_carried
  FROM public.customer_debts d
  WHERE d.carried_booking_id = v_booking_id AND d.status = 'open';
  IF EXISTS (SELECT 1 FROM public.customer_debts d WHERE d.booking_id = v_booking_id AND d.status = 'paid') THEN
    v_fee := 0;
  ELSIF EXISTS (
    SELECT 1 FROM public.customer_debts d
    JOIN public.bookings cb ON cb.id = d.carried_booking_id
    WHERE d.booking_id = v_booking_id AND d.status = 'open'
      AND cb.status::text NOT IN ('cancelled', 'no_show', 'completed')
  ) THEN
    v_fee := 0;
  ELSE
    v_fee := LEAST(public.booking_cancellation_fee(v_booking_id), v_pay.amount - v_carried);
  END IF;
  RETURN jsonb_build_object(
    'paid', v_pay.amount, 'fee', v_fee, 'carried', v_carried,
    'refund', v_pay.amount - v_fee - v_carried
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_payment_refund_breakdown(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payment_refund_breakdown(uuid) TO authenticated;

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

CREATE OR REPLACE FUNCTION public.admin_resolve_no_show(
  p_report_id uuid, p_status text, p_admin_notes text DEFAULT NULL, p_booking_status text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_booking_id uuid;
  v_customer uuid;
  v_report public.no_show_reports%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('info_requested', 'resolved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid no-show report status.' USING ERRCODE = '23514';
  END IF;

  SELECT booking_id INTO v_booking_id FROM public.no_show_reports WHERE id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No-show report not found.' USING ERRCODE = '42501';
  END IF;
  SELECT customer_id INTO v_customer FROM public.bookings WHERE id = v_booking_id;

  IF p_booking_status IS NOT NULL THEN
    IF p_status NOT IN ('resolved', 'rejected') THEN
      RAISE EXCEPTION 'Booking status can only be set when resolving or rejecting a no-show report.' USING ERRCODE = '23514';
    END IF;
    IF p_booking_status NOT IN ('completed', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid booking resolution status.' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.bookings WHERE id = v_booking_id FOR UPDATE;
    PERFORM public.lock_customer_debts(v_customer);
    PERFORM set_config('app.no_show_resolution_in_progress', 'on', true);
    UPDATE public.bookings SET status = p_booking_status::public.booking_status
      WHERE id = v_booking_id AND status = 'no_show';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Booking is no longer in no-show status.' USING ERRCODE = '23514';
    END IF;
  ELSE
    PERFORM public.lock_customer_debts(v_customer);
  END IF;

  SELECT * INTO v_report FROM public.no_show_reports WHERE id = p_report_id FOR UPDATE;
  IF v_report.status IN ('resolved', 'rejected') THEN
    RAISE EXCEPTION 'This no-show report has already been closed.' USING ERRCODE = '23514';
  END IF;

  IF p_status IN ('resolved', 'rejected') AND (p_admin_notes IS NULL OR btrim(p_admin_notes) = '') THEN
    RAISE EXCEPTION 'Resolution notes are required to resolve or reject a no-show report.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.no_show_reports SET
    status = p_status,
    admin_notes = COALESCE(NULLIF(btrim(p_admin_notes), ''), admin_notes),
    resolved_by = CASE WHEN p_status IN ('resolved', 'rejected') THEN v_uid ELSE resolved_by END,
    resolved_at = CASE WHEN p_status IN ('resolved', 'rejected') THEN now() ELSE resolved_at END,
    updated_at = now()
  WHERE id = p_report_id;

  RETURN p_report_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_resolve_no_show(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_no_show(uuid, text, text, text) TO authenticated;