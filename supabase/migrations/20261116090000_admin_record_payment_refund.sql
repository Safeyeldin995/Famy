-- Refunds for paid bookings that were cancelled.
-- A card payment is captured when the customer pays; an InstaPay customer has already sent money
-- once they upload the receipt. If the booking is then cancelled or marked no-show, Famy holds
-- money that must go back to the customer. Provider shares are only booked on completed bookings,
-- so no ledger reversal is needed. Admin sends the money back (Paymob dashboard or InstaPay) and
-- records it here with the transfer reference.

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
  v_booking_status text;
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
  SELECT b.status::text INTO v_booking_status FROM public.bookings b WHERE b.id = v_pay.booking_id;

  IF v_booking_status NOT IN ('cancelled', 'no_show') THEN
    RAISE EXCEPTION 'Refunds are recorded only for cancelled or no-show bookings' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (v_pay.status = 'captured' AND COALESCE(v_pay.payment_method_type, '') IN ('online', 'manual_transfer'))
    OR (v_pay.status = 'pending_review' AND v_pay.payment_method_type = 'manual_transfer'
        AND v_pay.proof_path IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'This payment has no money to refund' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.audit_reason', 'Refund recorded: ' || btrim(p_reference), true);
  -- Same internal bypass the ledger uses for system payment updates (tg_guard_payment_writes).
  PERFORM set_config('app.ledger_internal_capture', 'on', true);
  UPDATE public.payments
  SET status = 'refunded',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'refund', jsonb_build_object(
          'reference', btrim(p_reference),
          'recorded_at', now(),
          'recorded_by', auth.uid(),
          'previous_status', v_pay.status
        )
      )
  WHERE id = p_payment_id;
  PERFORM set_config('app.ledger_internal_capture', 'off', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_record_payment_refund(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_record_payment_refund(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
