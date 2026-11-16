-- Product Owner decision: an account cannot be deleted while money is owed to Famy
-- (unpaid customer cancellation fees, or a provider wallet that owes Famy).
-- The check returns its own reason so the apps can say what to do; deletion itself
-- (anonymize_account) is blocked through account_deletion_has_active_bookings.

CREATE OR REPLACE FUNCTION public.account_deletion_has_unpaid_balance(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
      SELECT 1 FROM public.customer_debts d
      WHERE d.customer_id = p_user_id AND d.status = 'open'
    )
    OR EXISTS (
      SELECT 1
      FROM public.providers pv
      JOIN public.provider_ledger_entries e ON e.provider_id = pv.id
      WHERE pv.profile_id = p_user_id
      GROUP BY pv.id
      HAVING SUM(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END) < -0.005
    )
$$;
REVOKE ALL ON FUNCTION public.account_deletion_has_unpaid_balance(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.account_deletion_has_active_bookings(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.providers pv ON pv.id = b.provider_id
    WHERE b.deleted_at IS NULL
      AND b.status NOT IN (
        'completed'::public.booking_status,
        'cancelled'::public.booking_status,
        'no_show'::public.booking_status
      )
      AND (b.customer_id = p_user_id OR pv.profile_id = p_user_id)
  )
  -- Also blocks anonymize_account while money is owed to Famy.
  OR public.account_deletion_has_unpaid_balance(p_user_id);
$$;
REVOKE ALL ON FUNCTION public.account_deletion_has_active_bookings(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.account_deletion_check()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'admin'::public.app_role
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'admin');
  END IF;

  IF public.account_deletion_has_unpaid_balance(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unpaid_balance');
  END IF;

  IF public.account_deletion_has_active_bookings(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'active_bookings');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.account_deletion_check() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_deletion_check() TO authenticated;
