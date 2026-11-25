-- Wallet internal RPC lockdown (audit issues #443, #444).
--
-- credit_customer_wallet_customer_cancelled and restore_customer_wallet_checkout_debit
-- are SECURITY DEFINER helpers meant to run only inside cancel_booking() and the
-- expiry / checkout-release paths (which run as the function owner). They were
-- still executable by every signed-in user, so a customer could credit a paid,
-- still-active online lesson back to their wallet, or release a checkout debit.
--
-- The REVOKE/GRANT below was applied to Production on 2026-11-25 as a
-- PO-approved emergency fix; this migration makes the repository match and adds a
-- status/role guard inside the credit function. Safe to re-run.

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
  v_funded numeric;
  v_carried numeric;
  v_method text;
  v_entry_id uuid;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR COALESCE(v_booking.service_mode, 'in_person') <> 'online' THEN
    RETURN NULL;
  END IF;

  -- Defense in depth (#443): only a booking the customer actually cancelled can be
  -- refunded to the wallet. cancel_booking() sets the status and records the
  -- cancellation before calling this function.
  IF v_booking.status::text <> 'cancelled' OR COALESCE((
    SELECT c.cancelled_by_role
    FROM public.booking_cancellations c
    WHERE c.booking_id = p_booking_id
    ORDER BY c.cancelled_at DESC
    LIMIT 1
  ), '') <> 'customer' THEN
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

  v_method := COALESCE(v_pay.payment_method_code, v_pay.payment_method_type);
  v_funded := public.payment_checkout_funded_total(v_pay);
  v_carried := LEAST(public.settle_carried_fees(v_booking.id, v_method, NULL), v_funded);

  v_fee := LEAST(public.booking_cancellation_fee(p_booking_id), v_funded - v_carried);
  IF EXISTS (SELECT 1 FROM public.customer_debts d WHERE d.booking_id = p_booking_id AND d.status = 'paid') THEN
    v_fee := 0;
  ELSIF EXISTS (
    SELECT 1 FROM public.customer_debts d
    JOIN public.bookings cb ON cb.id = d.carried_booking_id
    WHERE d.booking_id = p_booking_id AND d.status = 'open'
      AND cb.status::text NOT IN ('cancelled', 'no_show', 'completed')
  ) THEN
    v_fee := 0;
  ELSE
    UPDATE public.customer_debts
    SET status = 'waived', resolved_at = now(), resolved_by = NULL,
        resolution_note = 'Deducted from the wallet cancellation refund'
    WHERE booking_id = p_booking_id AND status = 'open';
  END IF;

  v_credit := GREATEST(v_funded - v_fee - v_carried, 0);

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
      jsonb_build_object(
        'cancellation_fee', v_fee,
        'funded_total', v_funded,
        'carried_fees', v_carried
      )
    );

    IF v_entry_id IS NOT NULL THEN
      PERFORM set_config('app.wallet_checkout_adjust', 'on', true);
      UPDATE public.payments
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'refund_settled_via_wallet', true,
        'refund_settled_at', now(),
        'wallet_refund_portion', v_credit,
        'cancellation_fee', v_fee,
        'carried_fees_settled', v_carried
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
      v_method,
      NULL,
      NULL,
      NULL
    );
  END IF;

  RETURN v_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_customer_wallet_customer_cancelled(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_customer_wallet_customer_cancelled(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.restore_customer_wallet_checkout_debit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_customer_wallet_checkout_debit(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
