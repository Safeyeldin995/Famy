-- Customer debt for cancellation fees that could not be taken from a prepayment
-- (Product Owner decision): a customer who cancels late / after the provider set off,
-- or doesn't show up, on a booking they had not prepaid (cash, or card not yet paid),
-- owes the fee. They cannot book again until they settle it by card (Paymob) or
-- InstaPay (admin confirms the transfer). When settled, the fee goes to the provider's
-- wallet. Admin can waive a debt.

CREATE TABLE IF NOT EXISTS public.customer_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('late_cancellation', 'no_show')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'waived')),
  settlement_id uuid,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id)
);
CREATE INDEX IF NOT EXISTS customer_debts_open_idx
  ON public.customer_debts (customer_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.customer_debt_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'EGP',
  method text NOT NULL CHECK (method IN ('card', 'instapay')),
  status text NOT NULL CHECK (status IN ('pending', 'pending_review', 'paid', 'rejected', 'failed', 'abandoned')),
  debt_ids uuid[] NOT NULL,
  instapay_reference text,
  paymob_order_id bigint UNIQUE,
  paymob_integration_id bigint,
  paymob_transaction_id bigint UNIQUE,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One live settlement attempt per customer.
CREATE UNIQUE INDEX IF NOT EXISTS customer_debt_settlements_one_live
  ON public.customer_debt_settlements (customer_id) WHERE status IN ('pending', 'pending_review');

ALTER TABLE public.customer_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_debt_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_debts_read ON public.customer_debts;
CREATE POLICY customer_debts_read ON public.customer_debts FOR SELECT TO authenticated
  USING (customer_id = (SELECT auth.uid()) OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
DROP POLICY IF EXISTS customer_debt_settlements_read ON public.customer_debt_settlements;
CREATE POLICY customer_debt_settlements_read ON public.customer_debt_settlements FOR SELECT TO authenticated
  USING (customer_id = (SELECT auth.uid()) OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

REVOKE ALL ON public.customer_debts, public.customer_debt_settlements FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.customer_debts, public.customer_debt_settlements FROM authenticated;
GRANT SELECT ON public.customer_debts, public.customer_debt_settlements TO authenticated;

DROP TRIGGER IF EXISTS trg_audit_customer_debts ON public.customer_debts;
CREATE TRIGGER trg_audit_customer_debts AFTER INSERT OR UPDATE OR DELETE ON public.customer_debts
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();
DROP TRIGGER IF EXISTS trg_audit_customer_debt_settlements ON public.customer_debt_settlements;
CREATE TRIGGER trg_audit_customer_debt_settlements AFTER INSERT OR UPDATE OR DELETE ON public.customer_debt_settlements
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

-- Money already with Famy for this booking (card captured or InstaPay receipt uploaded).
CREATE OR REPLACE FUNCTION public.booking_money_held(p_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.booking_id = p_booking_id
      AND (
        (p.status = 'captured' AND COALESCE(p.payment_method_type, '') IN ('online', 'manual_transfer'))
        OR (p.status = 'pending_review' AND p.payment_method_type = 'manual_transfer' AND p.proof_path IS NOT NULL)
      )
  )
$$;
REVOKE ALL ON FUNCTION public.booking_money_held(uuid) FROM PUBLIC, anon, authenticated;

-- A fee that cannot come out of a prepayment becomes a debt.
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
  INSERT INTO public.customer_debts (customer_id, booking_id, provider_id, kind, amount)
  VALUES (v_b.customer_id, v_b.id, v_b.provider_id, v_kind, NEW.cancellation_fee)
  ON CONFLICT (booking_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_record_customer_fee_debt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cancellation_fee_debt ON public.booking_cancellations;
CREATE TRIGGER trg_cancellation_fee_debt AFTER INSERT ON public.booking_cancellations
  FOR EACH ROW EXECUTE FUNCTION public.tg_record_customer_fee_debt();
DROP TRIGGER IF EXISTS trg_no_show_fee_debt ON public.no_show_reports;
CREATE TRIGGER trg_no_show_fee_debt AFTER INSERT ON public.no_show_reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_record_customer_fee_debt();

-- No new booking while fees are unpaid.
CREATE OR REPLACE FUNCTION public.tg_booking_requires_no_open_debt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.customer_debts d
    WHERE d.customer_id = NEW.customer_id AND d.status = 'open'
  ) THEN
    RAISE EXCEPTION 'BOOKING_DEBT_OUTSTANDING: Settle your unpaid cancellation fees before booking.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_booking_requires_no_open_debt() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS booking_requires_no_open_debt ON public.bookings;
CREATE TRIGGER booking_requires_no_open_debt BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_requires_no_open_debt();

-- Settle: mark the debts paid and credit each provider with its fee.
CREATE OR REPLACE FUNCTION public.settle_customer_debts(p_settlement_id uuid, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s public.customer_debt_settlements%ROWTYPE;
  v_d public.customer_debts%ROWTYPE;
BEGIN
  SELECT * INTO v_s FROM public.customer_debt_settlements WHERE id = p_settlement_id FOR UPDATE;
  FOR v_d IN
    SELECT * FROM public.customer_debts
    WHERE id = ANY(v_s.debt_ids) AND status = 'open'
    FOR UPDATE
  LOOP
    UPDATE public.customer_debts
    SET status = 'paid', settlement_id = v_s.id, resolved_at = now(), resolved_by = p_actor
    WHERE id = v_d.id;
    PERFORM public.ledger_insert_entry(
      v_d.provider_id, v_d.booking_id, 'cancellation_fee_provider_share', 'credit', v_d.amount,
      v_s.method, NULL, p_actor, NULL
    );
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_customer_debts(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Open a settlement for everything a customer owes now (card or InstaPay).
CREATE OR REPLACE FUNCTION public.open_debt_settlement_for(
  p_customer_id uuid, p_method text, p_instapay_reference text DEFAULT NULL
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
  IF p_method = 'instapay' AND (p_instapay_reference IS NULL OR length(btrim(p_instapay_reference)) < 4) THEN
    RAISE EXCEPTION 'The InstaPay transfer reference is required.' USING ERRCODE = '23514';
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

  SELECT array_agg(id ORDER BY created_at), COALESCE(sum(amount), 0)
    INTO v_ids, v_total
  FROM public.customer_debts WHERE customer_id = p_customer_id AND status = 'open';
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Nothing to pay.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.customer_debt_settlements (customer_id, amount, method, status, debt_ids, instapay_reference)
  VALUES (p_customer_id, v_total, p_method,
          CASE WHEN p_method = 'instapay' THEN 'pending_review' ELSE 'pending' END,
          v_ids, NULLIF(btrim(COALESCE(p_instapay_reference, '')), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.open_debt_settlement_for(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_debt_settlement_for(uuid, text, text) TO service_role;

-- Customer: report an InstaPay transfer for what they owe (admin confirms it).
CREATE OR REPLACE FUNCTION public.customer_submit_debt_instapay(p_reference text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  RETURN public.open_debt_settlement_for(auth.uid(), 'instapay', p_reference);
END;
$$;
REVOKE ALL ON FUNCTION public.customer_submit_debt_instapay(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_submit_debt_instapay(text) TO authenticated;

-- Server (service role): remember the Paymob order for a card settlement.
CREATE OR REPLACE FUNCTION public.debt_settlement_attach_paymob(
  p_settlement_id uuid, p_customer_id uuid, p_order_id bigint, p_integration_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.customer_debt_settlements
  SET paymob_order_id = p_order_id, paymob_integration_id = p_integration_id, updated_at = now()
  WHERE id = p_settlement_id AND customer_id = p_customer_id AND method = 'card'
    AND status = 'pending' AND paymob_order_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Settlement not found.' USING ERRCODE = 'P0002';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.debt_settlement_attach_paymob(uuid, uuid, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debt_settlement_attach_paymob(uuid, uuid, bigint, bigint) TO service_role;

-- Paymob webhook branch for settlements (called by paymob_apply_transaction_webhook).
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
BEGIN
  SELECT * INTO v_s FROM public.customer_debt_settlements WHERE paymob_order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trusted Paymob order mapping not found.' USING ERRCODE = 'P0002';
  END IF;
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

CREATE OR REPLACE FUNCTION public.paymob_apply_transaction_webhook(
  p_paymob_transaction_id bigint, p_order_id bigint, p_integration_id bigint,
  p_currency text, p_success boolean, p_pending boolean, p_amount_cents bigint,
  p_provider_ref text, p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_event public.paymob_webhook_events%ROWTYPE;
  v_outcome text;
  v_status public.payment_status;
BEGIN
  IF p_paymob_transaction_id IS NULL OR p_paymob_transaction_id <= 0
     OR p_order_id IS NULL OR p_order_id <= 0 OR p_success IS NULL OR p_pending IS NULL THEN
    RAISE EXCEPTION 'Invalid Paymob transaction.' USING ERRCODE = '22023';
  END IF;
  -- Serialize even conflicting requests for the same transaction, then lock
  -- the payment. No caller-supplied Famy payment ID participates in lookup.
  PERFORM pg_advisory_xact_lock(p_paymob_transaction_id);
  SELECT * INTO v_payment FROM public.payments WHERE paymob_order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    -- Not a booking payment: it may be a customer settling unpaid cancellation fees.
    RETURN public.paymob_apply_debt_settlement(
      p_paymob_transaction_id, p_order_id, p_integration_id, p_currency,
      p_success, p_pending, p_amount_cents, p_provider_ref
    );
  END IF;
  IF v_payment.payment_method_code IS DISTINCT FROM 'paymob'
     OR v_payment.payment_method_type IS DISTINCT FROM 'online'
     OR v_payment.paymob_integration_id IS DISTINCT FROM p_integration_id
     OR v_payment.currency IS DISTINCT FROM p_currency
     OR p_amount_cents IS NULL OR ROUND(v_payment.amount * 100)::bigint <> p_amount_cents THEN
    RAISE EXCEPTION 'Paymob transaction does not match payment.' USING ERRCODE = '23514';
  END IF;
  v_outcome := CASE WHEN p_pending THEN 'pending' WHEN p_success THEN 'captured' ELSE 'rejected' END;
  v_status := v_outcome::public.payment_status;
  SELECT * INTO v_event FROM public.paymob_webhook_events WHERE paymob_transaction_id = p_paymob_transaction_id;
  IF FOUND THEN
    IF v_event.payment_id IS DISTINCT FROM v_payment.id THEN
      RAISE EXCEPTION 'Paymob transaction already belongs to another payment.' USING ERRCODE = '23514';
    END IF;
    IF v_event.outcome <> 'pending' OR p_pending THEN
      RETURN jsonb_build_object('duplicate', true);
    END IF;
  END IF;
  IF v_payment.status = 'captured' THEN
    RETURN jsonb_build_object('ok', true, 'ignored', true, 'reason', 'already_captured');
  END IF;
  -- A distinct successful transaction can settle a previously declined attempt;
  -- a late pending event must never downgrade a final payment state.
  IF p_pending AND v_payment.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', true, 'ignored', true, 'reason', 'already_final');
  END IF;
  INSERT INTO public.paymob_webhook_events(paymob_transaction_id, payment_id, outcome)
  VALUES(p_paymob_transaction_id, v_payment.id, v_outcome)
  ON CONFLICT(paymob_transaction_id) DO UPDATE SET outcome = EXCLUDED.outcome, processed_at = now();
  UPDATE public.payments SET status = v_status, provider_ref = p_provider_ref,
    metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
    captured_at = CASE WHEN v_status = 'captured' THEN now() ELSE captured_at END,
    reviewed_at = CASE WHEN v_status IN ('captured','rejected') THEN now() ELSE reviewed_at END,
    rejection_reason = CASE WHEN v_status = 'rejected' THEN 'Paymob payment failed or was declined.' ELSE NULL END
  WHERE id = v_payment.id;
  RETURN jsonb_build_object('ok', true, 'payment_id', v_payment.id, 'status', v_status, 'outcome', v_outcome);
END;
$$;
REVOKE ALL ON FUNCTION public.paymob_apply_transaction_webhook(bigint,bigint,bigint,text,boolean,boolean,bigint,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paymob_apply_transaction_webhook(bigint,bigint,bigint,text,boolean,boolean,bigint,text,jsonb) TO service_role;

-- Admin: confirm or reject an InstaPay settlement.
CREATE OR REPLACE FUNCTION public.admin_review_debt_settlement(p_settlement_id uuid, p_approve boolean, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s public.customer_debt_settlements%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_s FROM public.customer_debt_settlements WHERE id = p_settlement_id FOR UPDATE;
  IF NOT FOUND OR v_s.status <> 'pending_review' THEN
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
REVOKE ALL ON FUNCTION public.admin_review_debt_settlement(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_debt_settlement(uuid, boolean, text) TO authenticated;

-- Admin: waive a debt (no money moves; the provider gets nothing for it).
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

NOTIFY pgrst, 'reload schema';
