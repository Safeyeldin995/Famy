-- Unpaid cancellation / no-show fees ride on the customer's next booking (Product Owner
-- decision, replaces the booking block):
--   * A customer with unpaid fees can book. The fees are added to the new booking as
--     bookings.carried_fees_amount; the amount to pay is price_total + carried_fees_amount.
--   * Cash: the new provider collects everything; the carried fees are debited from their
--     wallet (kind carried_fee_collected) when the booking completes.
--   * Card / InstaPay: Famy receives the fees with the booking payment.
--   * Either way the original provider is credited the fee when the booking completes.
--   * If the new booking is cancelled with no money held, the fees go back to unpaid and
--     ride on the next booking. If money is held, the refund keeps them.
--   * Paying fees on their own is still possible: card, or InstaPay with a receipt upload
--     (no transfer reference any more).

-- 1) Columns ----------------------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS carried_fees_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_carried_fees_amount_chk;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_carried_fees_amount_chk CHECK (carried_fees_amount >= 0);

ALTER TABLE public.customer_debts
  ADD COLUMN IF NOT EXISTS carried_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS customer_debts_carried_booking_idx
  ON public.customer_debts (carried_booking_id) WHERE carried_booking_id IS NOT NULL;

ALTER TABLE public.customer_debt_settlements ADD COLUMN IF NOT EXISTS proof_path text;
-- How much of a settlement must go back (it paid fees that were settled another way).
ALTER TABLE public.customer_debt_settlements ADD COLUMN IF NOT EXISTS refund_amount numeric(12,2);

-- 2) Ledger kind for fees the new provider collected in cash ------------------------------
ALTER TABLE public.provider_ledger_entries DROP CONSTRAINT IF EXISTS provider_ledger_entries_kind_check;
ALTER TABLE public.provider_ledger_entries ADD CONSTRAINT provider_ledger_entries_kind_check CHECK (kind IN (
  'cash_collected_platform_share', 'online_provider_share', 'payout_sent',
  'debt_payment_received', 'adjustment', 'cancellation_fee_provider_share', 'carried_fee_collected'
));
ALTER TABLE public.provider_ledger_entries DROP CONSTRAINT IF EXISTS provider_ledger_kind_direction_chk;
ALTER TABLE public.provider_ledger_entries ADD CONSTRAINT provider_ledger_kind_direction_chk CHECK (
  (kind = 'cash_collected_platform_share' AND direction = 'debit')
  OR (kind = 'online_provider_share' AND direction = 'credit')
  OR (kind = 'payout_sent' AND direction = 'debit')
  OR (kind = 'debt_payment_received' AND direction = 'credit')
  OR (kind = 'cancellation_fee_provider_share' AND direction = 'credit')
  OR (kind = 'carried_fee_collected' AND direction = 'debit')
  OR kind = 'adjustment'
);
DROP INDEX IF EXISTS public.provider_ledger_booking_kind_uidx;
CREATE UNIQUE INDEX provider_ledger_booking_kind_uidx
  ON public.provider_ledger_entries (provider_id, booking_id, kind)
  WHERE booking_id IS NOT NULL
    AND kind IN ('cash_collected_platform_share', 'online_provider_share',
                 'cancellation_fee_provider_share', 'carried_fee_collected');

-- 3) Which unpaid fees are free to carry or pay now ---------------------------------------
-- Open, not riding on a live booking, and not inside an InstaPay receipt waiting for review.
-- A fee whose booking was cancelled with no money held is free again (self-healing).
CREATE OR REPLACE FUNCTION public.customer_carryable_debt_ids(p_customer_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(d.id ORDER BY d.created_at), '{}'::uuid[])
  FROM public.customer_debts d
  LEFT JOIN public.bookings cb ON cb.id = d.carried_booking_id
  WHERE d.customer_id = p_customer_id
    AND d.status = 'open'
    AND (
      d.carried_booking_id IS NULL
      OR (cb.status::text IN ('cancelled', 'no_show') AND NOT public.booking_money_held(cb.id))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.customer_debt_settlements s
      WHERE s.customer_id = p_customer_id AND s.status = 'pending_review' AND d.id = ANY(s.debt_ids)
    )
$$;
REVOKE ALL ON FUNCTION public.customer_carryable_debt_ids(uuid) FROM PUBLIC, anon, authenticated;

-- The signed-in customer's unpaid fees that will be added to their next booking.
CREATE OR REPLACE FUNCTION public.my_unpaid_fees()
RETURNS TABLE (id uuid, booking_id uuid, kind text, amount numeric, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id, d.booking_id, d.kind, d.amount, d.created_at
  FROM public.customer_debts d
  WHERE auth.uid() IS NOT NULL
    AND d.id = ANY(public.customer_carryable_debt_ids(auth.uid()))
  ORDER BY d.created_at
$$;
REVOKE ALL ON FUNCTION public.my_unpaid_fees() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_unpaid_fees() TO authenticated;

-- 4) Booking no longer blocked: fees are added to it -----------------------------------
DROP TRIGGER IF EXISTS booking_requires_no_open_debt ON public.bookings;
DROP FUNCTION IF EXISTS public.tg_booking_requires_no_open_debt();

CREATE OR REPLACE FUNCTION public.tg_booking_carry_unpaid_fees()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Same lock as fee creation and settlements, held to the end of the transaction, so the
  -- AFTER INSERT attach sees exactly the fees summed here.
  PERFORM pg_advisory_xact_lock(hashtextextended('famy_customer_debt:' || NEW.customer_id::text, 0));
  SELECT COALESCE(sum(d.amount), 0) INTO NEW.carried_fees_amount
  FROM public.customer_debts d
  WHERE d.id = ANY(public.customer_carryable_debt_ids(NEW.customer_id));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_booking_carry_unpaid_fees() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS booking_carry_unpaid_fees ON public.bookings;
CREATE TRIGGER booking_carry_unpaid_fees BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_carry_unpaid_fees();

CREATE OR REPLACE FUNCTION public.tg_booking_attach_unpaid_fees()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attached numeric;
BEGIN
  IF NEW.carried_fees_amount <= 0 THEN
    RETURN NEW;
  END IF;
  WITH moved AS (
    UPDATE public.customer_debts
    SET carried_booking_id = NEW.id
    WHERE id = ANY(public.customer_carryable_debt_ids(NEW.customer_id))
    RETURNING amount
  )
  SELECT COALESCE(sum(amount), 0) INTO v_attached FROM moved;
  IF v_attached <> NEW.carried_fees_amount THEN
    RAISE EXCEPTION 'Unpaid fees changed while booking. Please try again.' USING ERRCODE = '40001';
  END IF;
  -- An unfinished card payment for these fees is replaced by the booking payment.
  UPDATE public.customer_debt_settlements
  SET status = 'abandoned', updated_at = now()
  WHERE customer_id = NEW.customer_id AND status = 'pending';
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_booking_attach_unpaid_fees() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS booking_attach_unpaid_fees ON public.bookings;
CREATE TRIGGER booking_attach_unpaid_fees AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_attach_unpaid_fees();

-- The carried amount is fixed at creation.
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
REVOKE ALL ON FUNCTION public.tg_booking_lock_carried_fees() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS booking_lock_carried_fees ON public.bookings;
CREATE TRIGGER booking_lock_carried_fees BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_lock_carried_fees();

-- New fees take the same lock, so they never slip between the sum and the attach.
CREATE OR REPLACE FUNCTION public.tg_record_customer_fee_debt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b public.bookings%ROWTYPE;
  v_kind text;
BEGIN
  IF COALESCE(NEW.cancellation_fee, 0) <= 0 THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'booking_cancellations' THEN
    IF NEW.cancelled_by_role IS DISTINCT FROM 'customer' THEN RETURN NEW; END IF;
    v_kind := 'late_cancellation';
  ELSE
    IF NEW.reported_party IS DISTINCT FROM 'customer' THEN RETURN NEW; END IF;
    v_kind := 'no_show';
  END IF;
  IF public.booking_money_held(NEW.booking_id) THEN
    RETURN NEW; -- deducted from the refund instead
  END IF;
  SELECT * INTO v_b FROM public.bookings WHERE id = NEW.booking_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('famy_customer_debt:' || v_b.customer_id::text, 0));
  INSERT INTO public.customer_debts (customer_id, booking_id, provider_id, kind, amount)
  VALUES (v_b.customer_id, v_b.id, v_b.provider_id, v_kind, NEW.cancellation_fee)
  ON CONFLICT (booking_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_record_customer_fee_debt() FROM PUBLIC, anon, authenticated;

-- 5) The booking payment covers the carried fees -----------------------------------------
CREATE OR REPLACE FUNCTION public.tg_validate_payment_amount()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking RECORD;
BEGIN
  SELECT customer_id, price_total, carried_fees_amount, currency INTO v_booking
  FROM public.bookings WHERE id = NEW.booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found for this payment.' USING ERRCODE = '23514';
  END IF;
  IF v_booking.customer_id IS DISTINCT FROM NEW.customer_id THEN
    RAISE EXCEPTION 'Payment customer does not match the booking''s customer.' USING ERRCODE = '23514';
  END IF;
  IF ABS(NEW.amount - (v_booking.price_total + COALESCE(v_booking.carried_fees_amount, 0))) > 0.01 THEN
    RAISE EXCEPTION 'Payment amount must match the booking total.' USING ERRCODE = '23514';
  END IF;
  IF NEW.currency IS DISTINCT FROM v_booking.currency THEN
    RAISE EXCEPTION 'Payment currency must match the booking currency.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_validate_payment_amount() FROM PUBLIC, anon, authenticated;

-- 6) Settle the carried fees: mark paid, credit each original provider ---------------------
CREATE OR REPLACE FUNCTION public.settle_carried_fees(p_booking_id uuid, p_method text, p_actor uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.customer_debts%ROWTYPE;
  v_total numeric := 0;
BEGIN
  FOR v_d IN
    SELECT * FROM public.customer_debts
    WHERE carried_booking_id = p_booking_id AND status = 'open'
    ORDER BY created_at
    FOR UPDATE
  LOOP
    UPDATE public.customer_debts
    SET status = 'paid', resolved_at = now(), resolved_by = p_actor,
        resolution_note = 'Paid with a later booking'
    WHERE id = v_d.id;
    PERFORM public.ledger_insert_entry(
      v_d.provider_id, v_d.booking_id, 'cancellation_fee_provider_share', 'credit', v_d.amount,
      p_method, NULL, p_actor, NULL
    );
    v_total := v_total + v_d.amount;
  END LOOP;
  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_carried_fees(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- Completion: carried fees are settled with the booking money; for cash the provider who
-- collected them owes them to Famy.
CREATE OR REPLACE FUNCTION public.ledger_apply_booking_shares(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_cutoff timestamptz;
  v_platform_share numeric;
  v_pay public.payments%ROWTYPE;
  v_carried numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('famy_ledger_booking:' || p_booking_id::text, 0));
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_booking.status IS DISTINCT FROM 'completed' THEN
    RETURN;
  END IF;

  SELECT * INTO v_pay
  FROM public.payments
  WHERE booking_id = p_booking_id
  ORDER BY
    CASE WHEN status = 'captured' THEN 0 ELSE 1 END,
  created_at DESC
  LIMIT 1;

  IF FOUND AND v_booking.carried_fees_amount > 0 THEN
    IF COALESCE(v_pay.payment_method_type, '') = 'cash' THEN
      v_carried := public.settle_carried_fees(p_booking_id, 'cash', NULL);
      IF v_carried > 0 THEN
        PERFORM public.ledger_insert_entry(
          v_booking.provider_id, p_booking_id, 'carried_fee_collected', 'debit',
          v_carried, 'cash', NULL, NULL, NULL
        );
      END IF;
    ELSIF v_pay.status = 'captured'
          AND COALESCE(v_pay.payment_method_type, '') IN ('online', 'manual_transfer') THEN
      PERFORM public.settle_carried_fees(
        p_booking_id, COALESCE(v_pay.payment_method_code, v_pay.payment_method_type), NULL
      );
    END IF;
  END IF;

  IF v_booking.price_provider_net IS NULL THEN
    RETURN;
  END IF;

  SELECT s.ledger_auto_from INTO v_cutoff FROM public.provider_settlement_settings() s;
  IF v_booking.completed_at IS NULL OR v_booking.completed_at < v_cutoff THEN
    RETURN;
  END IF;

  v_platform_share := GREATEST(COALESCE(v_booking.price_total, 0) - COALESCE(v_booking.price_provider_net, 0), 0);

  IF v_pay.id IS NULL THEN
    RETURN;
  END IF;

  IF COALESCE(v_pay.payment_method_type, '') = 'cash' THEN
    IF v_platform_share > 0 THEN
      PERFORM public.ledger_insert_entry(
        v_booking.provider_id, p_booking_id, 'cash_collected_platform_share', 'debit',
        v_platform_share, 'cash', NULL, NULL, NULL
      );
    END IF;
    IF v_pay.status IS DISTINCT FROM 'captured' THEN
      PERFORM set_config('app.ledger_internal_capture', 'on', true);
      UPDATE public.payments
      SET status = 'captured', captured_at = COALESCE(captured_at, now())
      WHERE id = v_pay.id AND status IS DISTINCT FROM 'captured';
      PERFORM set_config('app.ledger_internal_capture', 'off', true);
    END IF;
  ELSIF v_pay.status = 'captured'
        AND COALESCE(v_pay.payment_method_type, '') IN ('online', 'manual_transfer')
        AND COALESCE(v_booking.price_provider_net, 0) > 0 THEN
    PERFORM public.ledger_insert_entry(
      v_booking.provider_id, p_booking_id, 'online_provider_share', 'credit',
      v_booking.price_provider_net,
      COALESCE(v_pay.payment_method_code, v_pay.payment_method_type), NULL, NULL, NULL
    );
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.ledger_apply_booking_shares(uuid) FROM PUBLIC, anon, authenticated;

-- Cancelled / no-show with no money held: the fees are free again for the next booking.
CREATE OR REPLACE FUNCTION public.tg_booking_release_carried_fees()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.carried_fees_amount > 0
     AND NEW.status::text IN ('cancelled', 'no_show')
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NOT public.booking_money_held(NEW.id) THEN
    UPDATE public.customer_debts
    SET carried_booking_id = NULL
    WHERE carried_booking_id = NEW.id AND status = 'open';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_booking_release_carried_fees() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS booking_release_carried_fees ON public.bookings;
CREATE TRIGGER booking_release_carried_fees AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_release_carried_fees();

-- 7) Fee payments on their own: only fees not riding on a live booking -------------------
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
BEGIN
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
  -- Part (or all) of it was already settled another way: that part goes back.
  IF v_paid < v_s.amount THEN
    UPDATE public.customer_debt_settlements
    SET needs_refund = true, refund_amount = v_s.amount - v_paid, updated_at = now()
    WHERE id = v_s.id;
  END IF;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_customer_debts(uuid, uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.customer_submit_debt_instapay(text);
DROP FUNCTION IF EXISTS public.open_debt_settlement_for(uuid, text, text);

CREATE OR REPLACE FUNCTION public.open_debt_settlement_for(
  p_customer_id uuid, p_method text, p_proof_path text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_total numeric;
  v_id uuid;
BEGIN
  IF p_method NOT IN ('card', 'instapay') THEN
    RAISE EXCEPTION 'Invalid method.' USING ERRCODE = '23514';
  END IF;
  IF p_method = 'instapay' AND (
    p_proof_path IS NULL
    OR p_proof_path NOT LIKE 'fees/' || p_customer_id::text || '/%'
    OR p_proof_path LIKE '%..%'
  ) THEN
    RAISE EXCEPTION 'Upload the InstaPay receipt.' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('famy_customer_debt:' || p_customer_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.customer_debt_settlements
             WHERE customer_id = p_customer_id AND status = 'pending_review') THEN
    RAISE EXCEPTION 'A payment is already waiting for review.' USING ERRCODE = '23514';
  END IF;
  -- An unfinished card attempt is replaced (a late success is still honoured by the webhook).
  UPDATE public.customer_debt_settlements
  SET status = 'abandoned', updated_at = now()
  WHERE customer_id = p_customer_id AND status = 'pending';

  v_ids := public.customer_carryable_debt_ids(p_customer_id);
  SELECT COALESCE(sum(amount), 0) INTO v_total FROM public.customer_debts WHERE id = ANY(v_ids);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Nothing to pay.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.customer_debt_settlements (customer_id, amount, method, status, debt_ids, proof_path)
  VALUES (p_customer_id, v_total, p_method,
          CASE WHEN p_method = 'instapay' THEN 'pending_review' ELSE 'pending' END,
          v_ids, CASE WHEN p_method = 'instapay' THEN p_proof_path END)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.open_debt_settlement_for(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_debt_settlement_for(uuid, text, text) TO service_role;

-- Customer: send the InstaPay receipt for what they owe (Famy confirms it).
CREATE OR REPLACE FUNCTION public.customer_submit_debt_instapay(p_proof_path text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  RETURN public.open_debt_settlement_for(auth.uid(), 'instapay', p_proof_path);
END;
$$;
REVOKE ALL ON FUNCTION public.customer_submit_debt_instapay(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_submit_debt_instapay(text) TO authenticated;

-- Receipts live in payment-proofs under fees/<customer id>/.
DROP POLICY IF EXISTS payment_proofs_fee_receipt_insert ON storage.objects;
CREATE POLICY payment_proofs_fee_receipt_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = 'fees'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  );
DROP POLICY IF EXISTS payment_proofs_fee_receipt_read ON storage.objects;
CREATE POLICY payment_proofs_fee_receipt_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = 'fees'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  );

-- 8) Admin: a fee riding on a live booking cannot be waived (the customer is paying it) ----
CREATE OR REPLACE FUNCTION public.admin_waive_customer_debt(p_debt_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.customer_debts d
    JOIN public.bookings cb ON cb.id = d.carried_booking_id
    WHERE d.id = p_debt_id AND d.status = 'open'
      AND NOT (cb.status::text IN ('cancelled', 'no_show') AND NOT public.booking_money_held(cb.id))
  ) THEN
    RAISE EXCEPTION 'This fee is part of an active booking.' USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('app.audit_reason', btrim(p_reason), true);
  UPDATE public.customer_debts
  SET status = 'waived', resolved_at = now(), resolved_by = auth.uid(), resolution_note = btrim(p_reason)
  WHERE id = p_debt_id AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This debt is not open.' USING ERRCODE = '23514';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_waive_customer_debt(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_waive_customer_debt(uuid, text) TO authenticated;

-- 9) Refund of a cancelled booking keeps its own fee and the earlier fees it carried -------
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

  -- Earlier fees this booking carried: Famy keeps them and pays the original providers.
  v_carried := LEAST(public.settle_carried_fees(v_booking.id, v_method, auth.uid()), v_pay.amount);

  v_fee := LEAST(public.booking_cancellation_fee(v_booking.id), v_pay.amount - v_carried);
  -- The fee may already be a customer debt (the card payment was confirmed after the
  -- cancellation). Never charge it twice: paid debt -> nothing more to keep; open debt ->
  -- it is taken from this refund instead, so the debt is closed.
  IF EXISTS (SELECT 1 FROM public.customer_debts d WHERE d.booking_id = v_booking.id AND d.status = 'paid') THEN
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

NOTIFY pgrst, 'reload schema';
