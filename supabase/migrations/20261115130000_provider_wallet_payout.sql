-- Provider wallet (Uber-style): one running balance per provider.
-- Admin records money actually moved, in either direction, without weekly settlements.
-- Additive: a new admin function. Weekly settlements are no longer scheduled.

CREATE OR REPLACE FUNCTION public.admin_record_provider_payout(
  p_provider_id uuid,
  p_amount numeric,
  p_reference text,
  p_reason text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_net numeric;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_reference IS NULL OR btrim(p_reference) = ''
     OR p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Amount, reference and reason are required' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('famy_provider_wallet:' || p_provider_id::text, 0));
  SELECT COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END), 0)
    INTO v_net
  FROM public.provider_ledger_entries e
  WHERE e.provider_id = p_provider_id;

  -- A payout can only settle what Famy owes the provider.
  IF p_amount > v_net THEN
    RAISE EXCEPTION 'Payout is more than Famy owes this provider' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.audit_reason', btrim(p_reason), true);
  v_id := public.ledger_insert_entry(
    p_provider_id, NULL, 'payout_sent', 'debit', p_amount,
    'manual_transfer', concat('ref:', btrim(p_reference), ' ', coalesce(btrim(p_note), '')), auth.uid(), NULL
  );
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_record_provider_payout(uuid, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_record_provider_payout(uuid, numeric, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
