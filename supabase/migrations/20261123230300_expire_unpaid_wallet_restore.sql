-- Release pending wallet checkout debits when unpaid online bookings expire.

CREATE OR REPLACE FUNCTION public.expire_unpaid_confirmed_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings record;
  v_row RECORD;
  v_deadline timestamptz;
  v_count integer := 0;
  v_updated integer;
BEGIN
  SELECT * INTO v_settings FROM public.booking_expiry_settings() LIMIT 1;

  FOR v_row IN
    SELECT b.*
    FROM public.bookings b
    WHERE b.service_mode = 'online'
      AND b.status = 'confirmed'
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.booking_id = b.id
          AND p.status = 'captured'
          AND COALESCE(p.payment_method_type, '') IN ('online', 'manual_transfer')
      )
    ORDER BY b.start_at, b.id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_deadline := LEAST(
      COALESCE(v_row.status_changed_at, v_row.created_at)
        + (v_settings.confirmed_unpaid_hours_after_confirm * interval '1 hour'),
      v_row.start_at - (v_settings.confirmed_unpaid_minutes_before_start * interval '1 minute')
    );
    IF now() < v_deadline THEN
      CONTINUE;
    END IF;

    PERFORM set_config('app.audit_reason', 'unpaid_confirmed_expired', true);
    UPDATE public.bookings
    SET status = 'cancelled',
        cancellation_reason = 'Payment deadline passed before the online lesson.',
        status_changed_at = now(),
        status_changed_by = NULL
    WHERE id = v_row.id AND status = 'confirmed';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 0 THEN
      PERFORM public.restore_customer_wallet_checkout_debit(v_row.id);
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

NOTIFY pgrst, 'reload schema';