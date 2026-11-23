-- Customer wallet (v1): in-app balance only — no card/InstaPay cash-out.

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS paid_booking_cancellations integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.customer_wallet_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (reason IN (
    'provider_cancelled',
    'customer_cancelled_refund',
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

ALTER TABLE public.customer_wallet_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.customer_wallet_entries FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.customer_wallet_entries FROM authenticated;
GRANT SELECT ON public.customer_wallet_entries TO authenticated;
GRANT SELECT, INSERT ON public.customer_wallet_entries TO service_role;

CREATE POLICY customer_wallet_entries_read ON public.customer_wallet_entries
  FOR SELECT TO authenticated
  USING (
    customer_id = (SELECT auth.uid())
    OR public.has_role((SELECT auth.uid()), 'admin')
  );

DROP TRIGGER IF EXISTS trg_audit_customer_wallet_entries ON public.customer_wallet_entries;
CREATE TRIGGER trg_audit_customer_wallet_entries
  AFTER INSERT OR UPDATE OR DELETE ON public.customer_wallet_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

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
  v_balance numeric;
BEGIN
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF p_customer_id IS NOT NULL
     AND p_customer_id <> auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    sum(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END),
    0
  ) INTO v_balance
  FROM public.customer_wallet_entries e
  WHERE e.customer_id = v_customer;

  RETURN QUERY SELECT v_balance, 0::numeric, GREATEST(v_balance, 0);
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
      'Credit added to your Famy wallet',
      'The provider cancelled your booking. The full amount is in your wallet for your next Famy booking.',
      'Credit added to your Famy wallet',
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

REVOKE ALL ON FUNCTION public.credit_customer_wallet_provider_cancelled(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_customer_wallet_provider_cancelled(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_adjust_customer_wallet(
  p_customer_id uuid,
  p_direction text,
  p_amount numeric,
  p_reason_note text,
  p_booking_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_balance numeric;
  v_reason text;
  v_entry_id uuid;
  v_key text;
BEGIN
  IF v_admin IS NULL OR NOT public.has_role(v_admin, 'admin') THEN
    RAISE EXCEPTION 'Admin required.' USING ERRCODE = '42501';
  END IF;
  IF p_reason_note IS NULL OR btrim(p_reason_note) = '' THEN
    RAISE EXCEPTION 'A reason is required.' USING ERRCODE = '23514';
  END IF;
  IF p_direction NOT IN ('credit', 'debit') THEN
    RAISE EXCEPTION 'Invalid wallet direction.' USING ERRCODE = '23514';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Wallet amount must be positive.' USING ERRCODE = '23514';
  END IF;

  PERFORM public.lock_customer_debts(p_customer_id);
  PERFORM public.lock_customer_wallet(p_customer_id);

  SELECT COALESCE(
    sum(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END),
    0
  ) INTO v_balance
  FROM public.customer_wallet_entries e
  WHERE e.customer_id = p_customer_id;

  IF p_direction = 'debit' AND v_balance < p_amount THEN
    RAISE EXCEPTION 'Wallet balance is insufficient for this debit.' USING ERRCODE = '23514';
  END IF;

  v_reason := CASE WHEN p_direction = 'credit' THEN 'admin_credit' ELSE 'admin_debit' END;
  v_key := 'admin_wallet:' || v_admin::text || ':' || gen_random_uuid()::text;

  v_entry_id := public.customer_wallet_insert_entry(
    p_customer_id,
    p_direction,
    p_amount,
    v_reason,
    p_booking_id,
    NULL,
    v_admin,
    v_key,
    jsonb_build_object('admin_reason', btrim(p_reason_note))
  );

  RETURN v_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_customer_wallet(uuid, text, numeric, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_customer_wallet(uuid, text, numeric, text, uuid)
  TO authenticated;

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

NOTIFY pgrst, 'reload schema';