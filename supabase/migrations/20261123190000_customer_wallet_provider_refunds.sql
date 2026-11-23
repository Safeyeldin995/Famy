-- Customer wallet, provider-paid-cancel credits, and wallet-to-payment refund requests.

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS paid_booking_cancellations integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.customer_wallet_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (reason IN (
    'provider_cancelled',
    'customer_cancelled_refund',
    'wallet_refund_to_payment',
    'admin_credit',
    'admin_debit',
    'checkout_spend'
  )),
  booking_id uuid NULL REFERENCES public.bookings(id) ON DELETE SET NULL,
  payment_id uuid NULL REFERENCES public.payments(id) ON DELETE SET NULL,
  admin_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS customer_wallet_entries_customer_idx
  ON public.customer_wallet_entries (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.customer_wallet_refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_entry_id uuid NOT NULL REFERENCES public.customer_wallet_entries(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'completed', 'rejected', 'paymob_failed'
  )),
  hold_amount numeric(12, 2) NOT NULL CHECK (hold_amount > 0),
  reviewed_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NULL,
  rejection_reason text NULL,
  paymob_reference text NULL,
  instapay_proof_path text NULL,
  paymob_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_wallet_refund_active_entry_idx
  ON public.customer_wallet_refund_requests (wallet_entry_id)
  WHERE status IN ('pending', 'approved');

CREATE INDEX IF NOT EXISTS customer_wallet_refund_pending_idx
  ON public.customer_wallet_refund_requests (status)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.customer_wallet_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_entry_id uuid NOT NULL REFERENCES public.customer_wallet_entries(id) ON DELETE CASCADE,
  refund_request_id uuid NULL REFERENCES public.customer_wallet_refund_requests(id) ON DELETE SET NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'consumed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_wallet_holds_active_idx
  ON public.customer_wallet_holds (customer_id)
  WHERE status = 'active';

ALTER TABLE public.customer_wallet_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_wallet_refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_wallet_holds ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.customer_wallet_entries,
  public.customer_wallet_refund_requests,
  public.customer_wallet_holds
  FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.customer_wallet_entries,
  public.customer_wallet_refund_requests,
  public.customer_wallet_holds
  FROM authenticated;
GRANT SELECT ON public.customer_wallet_entries,
  public.customer_wallet_refund_requests,
  public.customer_wallet_holds
  TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.customer_wallet_entries,
  public.customer_wallet_refund_requests,
  public.customer_wallet_holds
  TO service_role;

CREATE POLICY customer_wallet_entries_read ON public.customer_wallet_entries
  FOR SELECT TO authenticated
  USING (
    customer_id = (SELECT auth.uid())
    OR public.has_role((SELECT auth.uid()), 'admin')
  );

CREATE POLICY customer_wallet_refund_requests_read ON public.customer_wallet_refund_requests
  FOR SELECT TO authenticated
  USING (
    customer_id = (SELECT auth.uid())
    OR public.has_role((SELECT auth.uid()), 'admin')
  );

CREATE POLICY customer_wallet_holds_admin_read ON public.customer_wallet_holds
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));

DROP TRIGGER IF EXISTS trg_audit_customer_wallet_entries ON public.customer_wallet_entries;
CREATE TRIGGER trg_audit_customer_wallet_entries
  AFTER INSERT OR UPDATE OR DELETE ON public.customer_wallet_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

DROP TRIGGER IF EXISTS trg_audit_customer_wallet_refunds ON public.customer_wallet_refund_requests;
CREATE TRIGGER trg_audit_customer_wallet_refunds
  AFTER INSERT OR UPDATE OR DELETE ON public.customer_wallet_refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

-- ---------------------------------------------------------------------------
-- Locking & balances (after lock_customer_debts in global order)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lock_customer_wallet(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('customer_wallet:' || p_customer_id::text, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.lock_customer_wallet(uuid) FROM PUBLIC, anon, authenticated;

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
  WITH ledger AS (
    SELECT COALESCE(
      sum(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END),
      0
    ) AS balance
    FROM public.customer_wallet_entries e
    WHERE e.customer_id = v_customer
  ), holds AS (
    SELECT COALESCE(sum(h.amount), 0) AS held
    FROM public.customer_wallet_holds h
    WHERE h.customer_id = v_customer AND h.status = 'active'
  )
  SELECT
    l.balance,
    h.held,
    GREATEST(l.balance - h.held, 0)
  FROM ledger l, holds h;
END;
$$;

REVOKE ALL ON FUNCTION public.customer_wallet_balances(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_wallet_balances(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.customer_wallet_insert_entry(
  p_customer_id uuid,
  p_direction text,
  p_amount numeric,
  p_reason text,
  p_booking_id uuid DEFAULT NULL,
  p_payment_id uuid DEFAULT NULL,
  p_admin_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_key text := COALESCE(NULLIF(btrim(p_idempotency_key), ''), gen_random_uuid()::text);
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Wallet amount must be positive.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.customer_wallet_entries (
    customer_id, direction, amount, reason, booking_id, payment_id, admin_id, idempotency_key, metadata
  ) VALUES (
    p_customer_id, p_direction, p_amount, p_reason, p_booking_id, p_payment_id, p_admin_id, v_key,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT e.id INTO v_id
    FROM public.customer_wallet_entries e
    WHERE e.idempotency_key = v_key;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.customer_wallet_insert_entry(
  uuid, text, numeric, text, uuid, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_wallet_insert_entry(
  uuid, text, numeric, text, uuid, uuid, uuid, text, jsonb
) TO service_role;

-- ---------------------------------------------------------------------------
-- Provider cancel → wallet credit (idempotent per booking)
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

  v_amount := v_pay.amount;
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
      'Refund added to your Famy wallet',
      'The provider cancelled your booking. The full amount is in your wallet. You can keep it or request a refund to your original payment method.',
      'Refund added to your Famy wallet',
      'تم إضافة المبلغ لمحفظة فامي',
      'The provider cancelled your booking. The full amount is in your wallet. You can keep it or request a refund to your original payment method.',
      'ألغى مقدم الخدمة حجزك. المبلغ كاملًا في محفظتك. يمكنك الإبقاء عليه أو طلب استرداد لطريقة الدفع الأصلية.',
      jsonb_build_object(
        'booking_id', p_booking_id,
        'wallet_entry_id', v_entry_id,
        'amount', v_amount,
        'actions', jsonb_build_array('keep_wallet', 'request_payment_refund')
      ),
      '/wallet',
      p_booking_id
    );
  END IF;

  RETURN v_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_customer_wallet_provider_cancelled(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_customer_wallet_provider_cancelled(uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- cancel_booking: credit wallet when provider cancels a paid booking
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id uuid, p_reason_id uuid, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_booking RECORD;
  v_reason RECORD;
  v_role text;
  v_fee numeric := 0;
  v_cancellation_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = '42501';
  END IF;

  IF v_booking.customer_id = v_uid THEN
    v_role := 'customer';
  ELSIF EXISTS (SELECT 1 FROM public.providers p WHERE p.id = v_booking.provider_id AND p.profile_id = v_uid) THEN
    v_role := 'provider';
  ELSIF public.has_role(v_uid, 'admin') THEN
    v_role := 'admin';
  ELSE
    RAISE EXCEPTION 'You are not authorized to cancel this booking.' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    v_booking.status IN ('pending', 'confirmed')
    OR (v_role = 'customer' AND v_booking.status IN ('on_the_way', 'arrived'))
  ) THEN
    RAISE EXCEPTION 'This booking has already progressed and can no longer be cancelled this way. Please use support, no-show, or dispute options instead.'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_reason FROM public.cancellation_reasons WHERE id = p_reason_id;
  IF NOT FOUND OR NOT v_reason.is_active THEN
    RAISE EXCEPTION 'Selected cancellation reason is not available.' USING ERRCODE = '23514';
  END IF;
  IF v_reason.actor_type NOT IN (v_role, 'any') THEN
    RAISE EXCEPTION 'Selected cancellation reason is not available for your role.' USING ERRCODE = '23514';
  END IF;
  IF NOT (v_booking.status = ANY(v_reason.applicable_statuses)) THEN
    RAISE EXCEPTION 'Selected cancellation reason does not apply to this booking''s current status.' USING ERRCODE = '23514';
  END IF;
  IF v_reason.requires_note AND (p_note IS NULL OR btrim(p_note) = '') THEN
    RAISE EXCEPTION 'A note is required for this cancellation reason.' USING ERRCODE = '23514';
  END IF;

  IF v_role = 'customer' THEN
    v_fee := public.booking_cancellation_fee(p_booking_id);
  END IF;

  PERFORM set_config('app.cancellation_in_progress', 'on', true);
  UPDATE public.bookings SET status = 'cancelled' WHERE id = p_booking_id;

  INSERT INTO public.booking_cancellations (
    booking_id, previous_status, cancelled_by_user_id, cancelled_by_role,
    reason_id, reason_code, reason_name_en, reason_name_ar, note, cancellation_fee
  ) VALUES (
    p_booking_id, v_booking.status, v_uid, v_role,
    v_reason.id, v_reason.code, v_reason.name_en, v_reason.name_ar, NULLIF(btrim(p_note), ''), v_fee
  ) RETURNING id INTO v_cancellation_id;

  IF v_role = 'provider' AND public.booking_money_held(p_booking_id) THEN
    PERFORM public.credit_customer_wallet_provider_cancelled(p_booking_id);
  END IF;

  RETURN v_cancellation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_booking(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Customer refund request (wallet → original payment method)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.customer_request_wallet_refund(p_wallet_entry_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_entry public.customer_wallet_entries%ROWTYPE;
  v_pay public.payments%ROWTYPE;
  v_request_id uuid;
  v_hold_id uuid;
  v_available numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_entry
  FROM public.customer_wallet_entries
  WHERE id = p_wallet_entry_id
  FOR UPDATE;

  IF NOT FOUND OR v_entry.customer_id <> v_uid THEN
    RAISE EXCEPTION 'Wallet entry not found.' USING ERRCODE = '42501';
  END IF;

  IF v_entry.direction <> 'credit' THEN
    RAISE EXCEPTION 'Only credits can be refunded to a payment method.' USING ERRCODE = '23514';
  END IF;

  IF v_entry.reason NOT IN ('provider_cancelled', 'customer_cancelled_refund') THEN
    RAISE EXCEPTION 'This wallet credit cannot be refunded to a payment method.' USING ERRCODE = '23514';
  END IF;

  IF v_entry.created_at < now() - interval '14 days' THEN
    RAISE EXCEPTION 'Refund requests must be made within 14 days of the wallet credit.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customer_wallet_refund_requests r
    WHERE r.wallet_entry_id = p_wallet_entry_id
      AND r.status IN ('pending', 'approved')
  ) THEN
    RAISE EXCEPTION 'A refund request is already in progress for this credit.' USING ERRCODE = '23514';
  END IF;

  PERFORM public.lock_customer_debts(v_uid);
  PERFORM public.lock_customer_wallet(v_uid);

  SELECT available_amount INTO v_available
  FROM public.customer_wallet_balances(v_uid);

  IF v_available < v_entry.amount THEN
    RAISE EXCEPTION 'Insufficient available wallet balance.' USING ERRCODE = '23514';
  END IF;

  IF v_entry.payment_id IS NULL THEN
    RAISE EXCEPTION 'Wallet credit has no linked payment.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_pay FROM public.payments WHERE id = v_entry.payment_id;

  INSERT INTO public.customer_wallet_refund_requests (
    customer_id, wallet_entry_id, payment_id, amount, hold_amount
  ) VALUES (
    v_uid, v_entry.id, v_pay.id, v_entry.amount, v_entry.amount
  ) RETURNING id INTO v_request_id;

  INSERT INTO public.customer_wallet_holds (
    customer_id, wallet_entry_id, refund_request_id, amount
  ) VALUES (
    v_uid, v_entry.id, v_request_id, v_entry.amount
  ) RETURNING id INTO v_hold_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.customer_request_wallet_refund(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_request_wallet_refund(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reject_wallet_refund_request(
  p_request_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.customer_wallet_refund_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required.' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Rejection reason is required.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_req
  FROM public.customer_wallet_refund_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Refund request is not pending.' USING ERRCODE = '23514';
  END IF;

  PERFORM public.lock_customer_debts(v_req.customer_id);
  PERFORM public.lock_customer_wallet(v_req.customer_id);

  UPDATE public.customer_wallet_refund_requests
  SET status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      rejection_reason = btrim(p_reason)
  WHERE id = p_request_id;

  UPDATE public.customer_wallet_holds
  SET status = 'released'
  WHERE refund_request_id = p_request_id AND status = 'active';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reject_wallet_refund_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_wallet_refund_request(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_mark_wallet_refund_approved(p_request_id uuid)
RETURNS TABLE (payment_id uuid, amount numeric, is_manual_transfer boolean, paymob_transaction_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.customer_wallet_refund_requests%ROWTYPE;
  v_pay public.payments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req
  FROM public.customer_wallet_refund_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Refund request is not pending.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_pay FROM public.payments WHERE id = v_req.payment_id;

  UPDATE public.customer_wallet_refund_requests
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_request_id;

  RETURN QUERY
  SELECT
    v_pay.id,
    v_req.amount,
    (COALESCE(v_pay.payment_method_type, '') = 'manual_transfer')::boolean,
    (
      SELECT e.paymob_transaction_id
      FROM public.paymob_webhook_events e
      WHERE e.payment_id = v_pay.id
      ORDER BY e.processed_at DESC NULLS LAST
      LIMIT 1
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_mark_wallet_refund_approved(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_wallet_refund_approved(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_complete_wallet_refund_request(
  p_request_id uuid,
  p_reference text,
  p_channel text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.customer_wallet_refund_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required.' USING ERRCODE = '42501';
  END IF;
  IF p_reference IS NULL OR btrim(p_reference) = '' THEN
    RAISE EXCEPTION 'Refund reference is required.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_req
  FROM public.customer_wallet_refund_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_req.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'Refund request cannot be completed.' USING ERRCODE = '23514';
  END IF;

  PERFORM public.lock_customer_debts(v_req.customer_id);
  PERFORM public.lock_customer_wallet(v_req.customer_id);

  PERFORM public.customer_wallet_insert_entry(
    v_req.customer_id,
    'debit',
    v_req.amount,
    'wallet_refund_to_payment',
    NULL,
    v_req.payment_id,
    auth.uid(),
    'wallet_refund_completed:' || p_request_id::text,
    jsonb_build_object('reference', btrim(p_reference), 'channel', p_channel)
  );

  UPDATE public.customer_wallet_refund_requests
  SET status = 'completed',
      paymob_reference = CASE WHEN p_channel = 'paymob' THEN btrim(p_reference) ELSE paymob_reference END,
      instapay_proof_path = CASE WHEN p_channel = 'instapay' THEN btrim(p_reference) ELSE instapay_proof_path END,
      reviewed_by = COALESCE(reviewed_by, auth.uid()),
      reviewed_at = COALESCE(reviewed_at, now()),
      completed_at = now()
  WHERE id = p_request_id;

  UPDATE public.customer_wallet_holds
  SET status = 'consumed'
  WHERE refund_request_id = p_request_id AND status = 'active';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_complete_wallet_refund_request(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_complete_wallet_refund_request(uuid, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_fail_wallet_refund_request(
  p_request_id uuid,
  p_error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.customer_wallet_refund_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req
  FROM public.customer_wallet_refund_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_req.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'Refund request cannot be failed.' USING ERRCODE = '23514';
  END IF;

  PERFORM public.lock_customer_debts(v_req.customer_id);
  PERFORM public.lock_customer_wallet(v_req.customer_id);

  UPDATE public.customer_wallet_refund_requests
  SET status = 'paymob_failed',
      paymob_error = NULLIF(btrim(p_error), ''),
      reviewed_by = COALESCE(reviewed_by, auth.uid()),
      reviewed_at = COALESCE(reviewed_at, now())
  WHERE id = p_request_id;

  UPDATE public.customer_wallet_holds
  SET status = 'released'
  WHERE refund_request_id = p_request_id AND status = 'active';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_fail_wallet_refund_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_fail_wallet_refund_request(uuid, text) TO authenticated;

-- Admin work queue: pending wallet refund requests
CREATE OR REPLACE FUNCTION public.admin_work_queue_counts()
RETURNS TABLE(queue text, item_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
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
  SELECT 'bookings_needing_action'::text, count(*) FROM public.bookings b
    WHERE b.status IN ('disputed', 'no_show')
  UNION ALL
  SELECT 'payments_pending_review'::text, count(*) FROM public.payments pay
    WHERE pay.status = 'pending_review'
  UNION ALL
  SELECT 'wallet_refund_requests'::text, count(*) FROM public.customer_wallet_refund_requests r
    WHERE r.status = 'pending'
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

NOTIFY pgrst, 'reload schema';