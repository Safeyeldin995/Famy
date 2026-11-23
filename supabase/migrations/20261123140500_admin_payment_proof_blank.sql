-- Treat blank transfer proof paths as missing (parity with paymentSituation.ts).

CREATE OR REPLACE FUNCTION public.admin_payment_situation(
  p_status text,
  p_payment_method_type text,
  p_method text,
  p_proof_path text,
  p_booking_status text,
  p_has_cash_ledger boolean
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text := COALESCE(p_status, '');
  v_booking text := COALESCE(p_booking_status, '');
  v_type text;
  v_closed boolean;
  v_proof text := NULLIF(btrim(COALESCE(p_proof_path, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;

  v_type := COALESCE(
    NULLIF(p_payment_method_type, ''),
    CASE COALESCE(p_method, '')
      WHEN 'instapay' THEN 'manual_transfer'
      WHEN 'cash' THEN 'cash'
      WHEN 'paymob' THEN 'online'
      WHEN 'card' THEN 'online'
      ELSE ''
    END
  );
  v_closed := v_booking IN ('cancelled', 'no_show');

  IF v_closed AND (
    (v_status = 'captured' AND v_type IN ('online', 'manual_transfer'))
    OR (v_status = 'pending_review' AND v_type = 'manual_transfer' AND v_proof IS NOT NULL)
  ) THEN
    RETURN 'refundDue';
  END IF;
  IF v_status = 'captured' THEN RETURN 'paid'; END IF;
  IF v_status = 'refunded' THEN RETURN 'refunded'; END IF;
  IF v_status = 'partially_refunded' THEN RETURN 'partiallyRefunded'; END IF;
  IF v_status = 'rejected' THEN RETURN 'rejected'; END IF;
  IF v_status = 'failed' THEN RETURN 'failed'; END IF;
  IF v_status = 'pending_review'
     AND v_type = 'manual_transfer'
     AND v_proof IS NOT NULL
     AND NOT v_closed THEN
    RETURN 'review';
  END IF;

  IF v_status IN ('pending', 'pending_review', 'authorized') THEN
    IF v_closed THEN RETURN 'noPaymentDue'; END IF;
    IF v_type = 'cash' THEN
      IF v_booking <> 'completed' THEN RETURN 'cashAtVisit'; END IF;
      IF COALESCE(p_has_cash_ledger, false) THEN RETURN 'cashRecorded'; END IF;
      RETURN 'cashUnconfirmed';
    END IF;
    IF v_type = 'manual_transfer' THEN
      IF v_proof IS NOT NULL THEN RETURN 'review'; END IF;
      RETURN 'awaitingProof';
    END IF;
    IF v_type = 'online' THEN RETURN 'awaitingCard'; END IF;
  END IF;

  RETURN 'other';
END;
$$;
REVOKE ALL ON FUNCTION public.admin_payment_situation(text, text, text, text, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payment_situation(text, text, text, text, text, boolean)
  TO authenticated;

NOTIFY pgrst, 'reload schema';