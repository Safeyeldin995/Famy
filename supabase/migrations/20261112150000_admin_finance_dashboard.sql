-- Admin finance dashboard aggregates (additive).

CREATE OR REPLACE FUNCTION public.admin_finance_summary(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_methods jsonb;
  v_platform_share numeric;
  v_owed_to numeric;
  v_owed_by numeric;
  v_pending_count bigint;
  v_pending_amount numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RAISE EXCEPTION 'Invalid period' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(jsonb_object_agg(x.bucket, x.amt), '{}'::jsonb)
  INTO v_methods
  FROM (
    SELECT
      CASE
        WHEN COALESCE(e.payment_method, '') IN ('cash', 'cash_on_delivery') THEN 'cash'
        WHEN COALESCE(e.payment_method, '') IN ('paymob') THEN 'gateway'
        WHEN COALESCE(e.payment_method, '') IN ('instapay', 'manual_transfer') THEN 'transfer'
        ELSE COALESCE(NULLIF(e.payment_method, ''), 'unknown')
      END AS bucket,
      SUM(
        CASE
          WHEN e.kind IN ('online_provider_share', 'debt_payment_received') AND e.direction = 'credit' THEN e.amount
          WHEN e.kind = 'cash_collected_platform_share' AND e.direction = 'debit' THEN e.amount
          WHEN e.kind = 'payout_sent' AND e.direction = 'debit' THEN e.amount
          WHEN e.kind = 'adjustment' AND e.direction = 'credit' THEN e.amount
          WHEN e.kind = 'adjustment' AND e.direction = 'debit' THEN -e.amount
          ELSE 0
        END
      ) AS amt
    FROM public.provider_ledger_entries e
    WHERE e.created_at >= p_from AND e.created_at < p_to
    GROUP BY 1
  ) x;

  SELECT COALESCE(SUM(x.share), 0)
  INTO v_platform_share
  FROM (
    SELECT e.amount AS share
    FROM public.provider_ledger_entries e
    WHERE e.created_at >= p_from
      AND e.created_at < p_to
      AND e.kind = 'cash_collected_platform_share'
      AND e.direction = 'debit'
    UNION ALL
    SELECT GREATEST(b.price_total - b.price_provider_net, 0) AS share
    FROM public.provider_ledger_entries e
    JOIN public.bookings b ON b.id = e.booking_id
    WHERE e.created_at >= p_from
      AND e.created_at < p_to
      AND e.kind = 'online_provider_share'
      AND e.direction = 'credit'
      AND b.status = 'completed'
      AND b.price_provider_net IS NOT NULL
      AND b.price_total IS NOT NULL
  ) x;

  SELECT
    COALESCE(SUM(GREATEST(b.net, 0)), 0),
    COALESCE(SUM(GREATEST(-b.net, 0)), 0)
  INTO v_owed_to, v_owed_by
  FROM public.providers p
  CROSS JOIN LATERAL public.provider_balance(p.id) b;

  SELECT count(*)::bigint, COALESCE(SUM(s.amount), 0)
  INTO v_pending_count, v_pending_amount
  FROM public.provider_settlements s
  WHERE s.status = 'pending';

  RETURN jsonb_build_object(
    'totals_by_method', COALESCE(v_methods, '{}'::jsonb),
    'platform_share', v_platform_share,
    'owed_to_providers', v_owed_to,
    'owed_by_providers', v_owed_by,
    'pending_settlement_count', v_pending_count,
    'pending_settlement_amount', v_pending_amount,
    'period_from', p_from,
    'period_to', p_to
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_finance_summary(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_finance_summary(timestamptz, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_finance_provider_rows()
RETURNS TABLE (
  provider_id uuid,
  full_name text,
  net numeric,
  cash_held numeric,
  at_limit boolean,
  last_settlement_at timestamptz,
  last_settlement_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    pr.full_name,
    b.net,
    b.cash_held_for_platform,
    public.provider_cash_debt_blocked(p.id),
    ls.settled_at,
    ls.status
  FROM public.providers p
  JOIN public.profiles pr ON pr.id = p.profile_id
  CROSS JOIN LATERAL public.provider_balance(p.id) b
  LEFT JOIN LATERAL (
    SELECT s.settled_at, s.status
    FROM public.provider_settlements s
    WHERE s.provider_id = p.id
    ORDER BY s.created_at DESC
    LIMIT 1
  ) ls ON true
  WHERE p.onboarding_status = 'APPROVED'
  ORDER BY abs(b.net) DESC, pr.full_name ASC NULLS LAST;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_finance_provider_rows() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_finance_provider_rows() TO authenticated;

NOTIFY pgrst, 'reload schema';
