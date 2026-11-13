-- Provider settlements: append-only ledger, weekly settlement batches, cash-debt limits.
-- Additive only. Does not recalculate historic commission snapshots or mark
-- bookings completed before ledger_auto_from as paid.
--
-- Amount model: amount is always numeric(12,2) > 0. direction is credit or debit.
-- net = sum(credits) - sum(debits). Positive net means Famy owes the provider.
-- Negative net means the provider owes Famy. cash_held_for_platform is unpaid
-- cash platform share (cash debits minus debt payments received), floored at 0.
-- The cash-debt block uses negative net against cash_debt_limit, so online
-- credits that Famy still owes can net a cash debt before the provider is blocked.

-- ============================================================
-- 1) Settings (cutoff + limits)
-- ============================================================
INSERT INTO public.settings (key, value)
VALUES (
  'provider_settlement',
  jsonb_build_object(
    'cash_debt_limit', 1000,
    'cash_debt_warn_percent', 80,
    'settlement_weekday', 0,
    'ledger_auto_from', now()
  )
)
ON CONFLICT (key) DO NOTHING;

UPDATE public.settings
SET value = value
  || jsonb_build_object(
    'cash_debt_limit', COALESCE((value->>'cash_debt_limit')::numeric, 1000),
    'cash_debt_warn_percent', COALESCE((value->>'cash_debt_warn_percent')::numeric, 80),
    'settlement_weekday', COALESCE((value->>'settlement_weekday')::int, 0)
  )
  || CASE
       WHEN NULLIF(btrim(value->>'ledger_auto_from'), '') IS NOT NULL THEN '{}'::jsonb
       ELSE jsonb_build_object('ledger_auto_from', now())
     END
WHERE key = 'provider_settlement';

-- ============================================================
-- 2) Tables
-- ============================================================
CREATE TABLE IF NOT EXISTS public.provider_settlement_accounts (
  provider_id uuid PRIMARY KEY REFERENCES public.providers(id) ON DELETE CASCADE,
  debt_warned_at timestamptz,
  debt_warned_net numeric(12,2),
  debt_blocked_notified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.provider_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE RESTRICT,
  booking_id uuid NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  settlement_id uuid NULL,
  kind text NOT NULL CHECK (kind IN (
    'cash_collected_platform_share',
    'online_provider_share',
    'payout_sent',
    'debt_payment_received',
    'adjustment'
  )),
  direction text NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  payment_method text,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_ledger_amount_positive_chk CHECK (amount > 0),
  CONSTRAINT provider_ledger_kind_direction_chk CHECK (
    (kind = 'cash_collected_platform_share' AND direction = 'debit')
    OR (kind = 'online_provider_share' AND direction = 'credit')
    OR (kind = 'payout_sent' AND direction = 'debit')
    OR (kind = 'debt_payment_received' AND direction = 'credit')
    OR kind = 'adjustment'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_ledger_booking_kind_uidx
  ON public.provider_ledger_entries (provider_id, booking_id, kind)
  WHERE booking_id IS NOT NULL
    AND kind IN ('cash_collected_platform_share', 'online_provider_share');

CREATE INDEX IF NOT EXISTS idx_provider_ledger_provider_created
  ON public.provider_ledger_entries (provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_ledger_settlement
  ON public.provider_ledger_entries (settlement_id)
  WHERE settlement_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.provider_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  direction text NOT NULL CHECK (direction IN ('famy_pays_provider', 'provider_pays_famy')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'received', 'cancelled')),
  totals_by_method jsonb NOT NULL DEFAULT '{}'::jsonb,
  payment_reference text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  settled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT provider_settlements_period_chk CHECK (period_end > period_start),
  UNIQUE (provider_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_provider_settlements_provider_created
  ON public.provider_settlements (provider_id, created_at DESC);

DO $$
BEGIN
  ALTER TABLE public.provider_ledger_entries
    ADD CONSTRAINT provider_ledger_entries_settlement_fkey
    FOREIGN KEY (settlement_id) REFERENCES public.provider_settlements(id) ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 3) Immutable ledger rows
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_block_provider_ledger_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND current_setting('app.ledger_link_settlement', true) = 'on'
     AND NEW.settlement_id IS DISTINCT FROM OLD.settlement_id
     AND NEW.id = OLD.id
     AND NEW.provider_id = OLD.provider_id
     AND NEW.booking_id IS NOT DISTINCT FROM OLD.booking_id
     AND NEW.kind = OLD.kind
     AND NEW.direction = OLD.direction
     AND NEW.amount = OLD.amount
     AND NEW.payment_method IS NOT DISTINCT FROM OLD.payment_method
     AND NEW.note IS NOT DISTINCT FROM OLD.note
     AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
     AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Provider ledger records are immutable.' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_provider_ledger_immutable ON public.provider_ledger_entries;
CREATE TRIGGER trg_provider_ledger_immutable
  BEFORE UPDATE OR DELETE ON public.provider_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_provider_ledger_mutation();

-- ============================================================
-- 4) Settings reader
-- ============================================================
CREATE OR REPLACE FUNCTION public.provider_settlement_settings()
RETURNS TABLE (
  cash_debt_limit numeric,
  cash_debt_warn_percent numeric,
  settlement_weekday int,
  ledger_auto_from timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value jsonb;
  v_limit numeric;
  v_warn numeric;
  v_weekday int;
  v_from timestamptz;
BEGIN
  SELECT s.value INTO v_value FROM public.settings s WHERE s.key = 'provider_settlement';
  IF jsonb_typeof(v_value->'cash_debt_limit') = 'number' THEN
    v_limit := (v_value->>'cash_debt_limit')::numeric;
  END IF;
  IF jsonb_typeof(v_value->'cash_debt_warn_percent') = 'number' THEN
    v_warn := (v_value->>'cash_debt_warn_percent')::numeric;
  END IF;
  IF jsonb_typeof(v_value->'settlement_weekday') = 'number' THEN
    v_weekday := (v_value->>'settlement_weekday')::int;
  END IF;
  IF jsonb_typeof(v_value->'ledger_auto_from') = 'string' THEN
    BEGIN
      v_from := (v_value->>'ledger_auto_from')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_from := NULL;
    END;
  END IF;
  cash_debt_limit := CASE WHEN v_limit IS NOT NULL AND v_limit > 0 THEN v_limit ELSE 1000 END;
  cash_debt_warn_percent := CASE WHEN v_warn IS NOT NULL AND v_warn > 0 AND v_warn <= 100 THEN v_warn ELSE 80 END;
  settlement_weekday := CASE WHEN v_weekday IS NOT NULL AND v_weekday BETWEEN 0 AND 6 THEN v_weekday ELSE 0 END;
  ledger_auto_from := COALESCE(v_from, now());
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.provider_settlement_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_settlement_settings() TO authenticated, service_role;

-- ============================================================
-- 5) Balance + blocking
-- ============================================================
CREATE OR REPLACE FUNCTION public.provider_balance(p_provider_id uuid)
RETURNS TABLE (
  total_credits numeric,
  total_debits numeric,
  net numeric,
  cash_held_for_platform numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('app.ledger_internal', true), '') IS DISTINCT FROM 'on'
     AND auth.uid() IS NOT NULL
     AND public.has_role(auth.uid(), 'admin') IS NOT TRUE
     AND NOT EXISTS (
       SELECT 1 FROM public.providers p
       WHERE p.id = p_provider_id AND p.profile_id = auth.uid()
     )
  THEN
    RAISE EXCEPTION 'Provider balance is not visible to this account.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN e.direction = 'debit' THEN e.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END), 0),
    GREATEST(
      COALESCE(SUM(CASE
        WHEN e.kind = 'cash_collected_platform_share' AND e.direction = 'debit' THEN e.amount
        ELSE 0
      END), 0)
      - COALESCE(SUM(CASE
        WHEN e.kind = 'debt_payment_received' AND e.direction = 'credit' THEN e.amount
        ELSE 0
      END), 0),
      0
    )
  FROM public.provider_ledger_entries e
  WHERE e.provider_id = p_provider_id;
END;
$$;
REVOKE ALL ON FUNCTION public.provider_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_balance(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.provider_cash_debt_blocked(p_provider_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit numeric;
  v_net numeric;
BEGIN
  SELECT s.cash_debt_limit INTO v_limit FROM public.provider_settlement_settings() s;
  SELECT COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END), 0)
    INTO v_net
  FROM public.provider_ledger_entries e
  WHERE e.provider_id = p_provider_id;
  RETURN COALESCE(v_net, 0) <= -v_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.provider_cash_debt_blocked(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_cash_debt_blocked(uuid) TO authenticated, service_role;

-- ============================================================
-- 6) Internal ledger writers (SECURITY DEFINER only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ledger_insert_entry(
  p_provider_id uuid,
  p_booking_id uuid,
  p_kind text,
  p_direction text,
  p_amount numeric,
  p_payment_method text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_settlement_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
  RAISE EXCEPTION 'Ledger amount must be positive' USING ERRCODE = '23514';
  END IF;
  IF p_direction NOT IN ('credit', 'debit') THEN
    RAISE EXCEPTION 'Invalid ledger direction' USING ERRCODE = '23514';
  END IF;

  BEGIN
    INSERT INTO public.provider_ledger_entries (
      provider_id, booking_id, settlement_id, kind, direction, amount,
      payment_method, note, created_by
    ) VALUES (
      p_provider_id, p_booking_id, p_settlement_id, p_kind, p_direction, p_amount,
      NULLIF(btrim(p_payment_method), ''), NULLIF(btrim(p_note), ''), p_created_by
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN NULL;
  END;

  IF v_id IS NOT NULL THEN
    PERFORM public.provider_settlement_notify_after_entry(p_provider_id);
  END IF;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.ledger_insert_entry(uuid, uuid, text, text, numeric, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.provider_settlement_notify_after_entry(p_provider_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile uuid;
  v_limit numeric;
  v_warn_pct numeric;
  v_net numeric;
  v_debt numeric;
  v_warn_threshold numeric;
  v_acct public.provider_settlement_accounts%ROWTYPE;
BEGIN
  SELECT p.profile_id INTO v_profile FROM public.providers p WHERE p.id = p_provider_id;
  IF v_profile IS NULL THEN RETURN; END IF;

  SELECT s.cash_debt_limit, s.cash_debt_warn_percent
    INTO v_limit, v_warn_pct
  FROM public.provider_settlement_settings() s;

  PERFORM set_config('app.ledger_internal', 'on', true);
  SELECT b.net INTO v_net FROM public.provider_balance(p_provider_id) b;
  v_debt := CASE WHEN v_net < 0 THEN abs(v_net) ELSE 0 END;
  v_warn_threshold := v_limit * (v_warn_pct / 100.0);

  INSERT INTO public.provider_settlement_accounts AS a (provider_id)
  VALUES (p_provider_id)
  ON CONFLICT (provider_id) DO NOTHING;

  SELECT * INTO v_acct FROM public.provider_settlement_accounts WHERE provider_id = p_provider_id FOR UPDATE;

  -- Once per upward crossing. Dropping under a threshold clears that flag
  -- so the next crossing notifies again. A higher balance does not re-notify.
  IF v_debt < v_warn_threshold THEN
    UPDATE public.provider_settlement_accounts
    SET debt_warned_at = NULL, debt_warned_net = NULL, debt_blocked_notified_at = NULL, updated_at = now()
    WHERE provider_id = p_provider_id;
    RETURN;
  END IF;

  IF v_debt >= v_limit THEN
    IF v_acct.debt_blocked_notified_at IS NULL THEN
      INSERT INTO public.notifications (
        user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
      ) VALUES (
        v_profile, 'provider_settlement_debt_blocked', 'provider',
        'Booking limit reached', 'You have reached the platform balance limit. Transfer the owed amount to receive new bookings.',
        'Booking limit reached', 'وصلت لحد الرصيد',
        'You have reached the platform balance limit. Transfer the owed amount to receive new bookings.',
        'وصلت لحد الرصيد المستحق للمنصة، حول المبلغ عشان تقدر تستقبل طلبات جديدة',
        jsonb_build_object('provider_id', p_provider_id, 'net', v_net),
        '/pro/earnings'
      );
    END IF;
    UPDATE public.provider_settlement_accounts
    SET debt_blocked_notified_at = COALESCE(debt_blocked_notified_at, now()),
        debt_warned_at = COALESCE(debt_warned_at, now()),
        debt_warned_net = v_net,
        updated_at = now()
    WHERE provider_id = p_provider_id;
    RETURN;
  END IF;

  IF v_acct.debt_blocked_notified_at IS NOT NULL THEN
    UPDATE public.provider_settlement_accounts
    SET debt_blocked_notified_at = NULL, updated_at = now()
    WHERE provider_id = p_provider_id;
  END IF;

  IF v_acct.debt_warned_at IS NULL THEN
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_profile, 'provider_settlement_debt_warning', 'provider',
      'Balance warning', 'Your balance owed to the platform is nearing the limit. Please transfer the amount to keep receiving bookings.',
      'Balance warning', 'تنبيه الرصيد',
      'Your balance owed to the platform is nearing the limit. Please transfer the amount to keep receiving bookings.',
      'رصيدك المستحق للمنصة قرب يوصل للحد، حول المبلغ عشان تفضل تستقبل طلبات',
      jsonb_build_object('provider_id', p_provider_id, 'net', v_net),
      '/pro/earnings'
    );
    UPDATE public.provider_settlement_accounts
    SET debt_warned_at = now(), debt_warned_net = v_net, updated_at = now()
    WHERE provider_id = p_provider_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.provider_settlement_notify_after_entry(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ledger_apply_booking_shares(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_cutoff timestamptz;
  v_platform_share numeric;
  v_pay public.payments%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('famy_ledger_booking:' || p_booking_id::text, 0));
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_booking.status IS DISTINCT FROM 'completed' THEN
    RETURN;
  END IF;
  IF v_booking.price_provider_net IS NULL THEN
    RETURN;
  END IF;

  SELECT s.ledger_auto_from INTO v_cutoff FROM public.provider_settlement_settings() s;
  IF v_booking.completed_at IS NULL OR v_booking.completed_at < v_cutoff THEN
    RETURN;
  END IF;

  v_platform_share := GREATEST(COALESCE(v_booking.price_total, 0) - COALESCE(v_booking.price_provider_net, 0), 0);

  SELECT * INTO v_pay
  FROM public.payments
  WHERE booking_id = p_booking_id
  ORDER BY
    CASE WHEN status = 'captured' THEN 0 ELSE 1 END,
  created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF COALESCE(v_pay.payment_method_type, '') = 'cash' THEN
    IF v_platform_share > 0 THEN
      PERFORM public.ledger_insert_entry(
        v_booking.provider_id, p_booking_id, 'cash_collected_platform_share', 'debit',
        v_platform_share, 'cash', NULL, NULL, NULL
      );
    END IF;
    IF v_pay.status IS DISTINCT FROM 'captured' THEN
      PERFORM set_config('app.ledger_internal_capture', 'on', true);
      UPDATE public.payments
      SET status = 'captured', captured_at = COALESCE(captured_at, now())
      WHERE id = v_pay.id AND status IS DISTINCT FROM 'captured';
      PERFORM set_config('app.ledger_internal_capture', 'off', true);
    END IF;
  ELSIF v_pay.status = 'captured'
        AND COALESCE(v_pay.payment_method_type, '') IN ('online', 'manual_transfer')
        AND COALESCE(v_booking.price_provider_net, 0) > 0 THEN
    PERFORM public.ledger_insert_entry(
      v_booking.provider_id, p_booking_id, 'online_provider_share', 'credit',
      v_booking.price_provider_net,
      COALESCE(v_pay.payment_method_code, v_pay.payment_method_type), NULL, NULL, NULL
    );
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.ledger_apply_booking_shares(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_reconcile_booking_ledger(p_booking_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Reason is required' USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('app.audit_reason', btrim(p_reason), true);
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_booking.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'Booking must be completed' USING ERRCODE = '23514';
  END IF;
  PERFORM public.ledger_apply_booking_shares(p_booking_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_reconcile_booking_ledger(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_booking_ledger(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_booking_ledger_on_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN
    PERFORM public.ledger_apply_booking_shares(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_ledger_on_complete ON public.bookings;
CREATE TRIGGER trg_booking_ledger_on_complete
  AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_ledger_on_complete();

CREATE OR REPLACE FUNCTION public.tg_payment_ledger_on_capture()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'captured' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'captured') THEN
    PERFORM public.ledger_apply_booking_shares(NEW.booking_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_ledger_on_capture ON public.payments;
CREATE TRIGGER trg_payment_ledger_on_capture
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_payment_ledger_on_capture();

-- Allow automated cash capture during ledger application (system + customer completion path).
CREATE OR REPLACE FUNCTION public.tg_guard_payment_writes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reviewer boolean;
BEGIN
  IF current_setting('app.ledger_internal_capture', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF auth.role() = 'service_role' OR (v_uid IS NULL AND auth.role() IS NULL) THEN RETURN NEW; END IF;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.customer_id <> v_uid THEN
      RAISE EXCEPTION 'Only the booking customer can initialize payment.' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public.bookings WHERE id = NEW.booking_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.payments WHERE booking_id = NEW.booking_id
               AND status NOT IN ('rejected', 'failed', 'refunded')) THEN
      RAISE EXCEPTION 'A payment already exists for this booking.' USING ERRCODE = '23514';
    END IF;
    NEW.status := CASE WHEN NEW.payment_method_type = 'manual_transfer'
      THEN 'pending_review'::public.payment_status ELSE 'pending'::public.payment_status END;
    NEW.provider_ref := NULL;
    NEW.metadata := '{}'::jsonb;
    NEW.paymob_order_id := NULL;
    NEW.paymob_integration_id := NULL;
    NEW.captured_at := NULL;
    NEW.reviewed_at := NULL;
    NEW.reviewed_by := NULL;
    NEW.rejection_reason := NULL;
    NEW.proof_path := NULL;
    NEW.proof_uploaded_at := NULL;
    NEW.created_at := now();
    RETURN NEW;
  END IF;

  v_reviewer := public.has_role(v_uid, 'admin') OR EXISTS (
    SELECT 1 FROM public.bookings b JOIN public.providers p ON p.id = b.provider_id
    WHERE b.id = OLD.booking_id AND p.profile_id = v_uid
  );
  IF OLD.payment_method_type = 'online' OR OLD.payment_method_code = 'paymob' OR OLD.method = 'paymob' THEN
    RAISE EXCEPTION 'Online payments can only be updated by the payment gateway.' USING ERRCODE = '42501';
  END IF;
  IF OLD.customer_id = v_uid AND NOT public.has_role(v_uid, 'admin') THEN
    IF OLD.status <> 'pending_review' OR OLD.payment_method_type <> 'manual_transfer'
       OR (to_jsonb(NEW) - ARRAY['proof_path','proof_uploaded_at','updated_at'])
          IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['proof_path','proof_uploaded_at','updated_at']) THEN
      RAISE EXCEPTION 'Customers may only upload pending payment proof.' USING ERRCODE = '42501';
    END IF;
    IF NEW.proof_path IS NOT NULL AND split_part(NEW.proof_path, '/', 1) <> OLD.booking_id::text THEN
      RAISE EXCEPTION 'Payment proof must belong to this booking.' USING ERRCODE = '42501';
    END IF;
    NEW.proof_uploaded_at := CASE WHEN NEW.proof_path IS NULL THEN NULL ELSE now() END;
  ELSIF v_reviewer THEN
    IF OLD.status NOT IN ('pending', 'pending_review') OR NEW.status NOT IN ('captured', 'rejected')
       OR (to_jsonb(NEW) - ARRAY['status','captured_at','reviewed_at','reviewed_by','rejection_reason','updated_at'])
          IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','captured_at','reviewed_at','reviewed_by','rejection_reason','updated_at']) THEN
      RAISE EXCEPTION 'Invalid manual payment review.' USING ERRCODE = '42501';
    END IF;
    NEW.reviewed_by := v_uid;
    NEW.reviewed_at := now();
    NEW.captured_at := CASE WHEN NEW.status = 'captured' THEN now() ELSE NULL END;
    NEW.rejection_reason := CASE WHEN NEW.status = 'rejected' THEN NEW.rejection_reason ELSE NULL END;
  ELSE
    RAISE EXCEPTION 'Payment update not authorized.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_validate_payment_capture()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking_status public.booking_status;
BEGIN
  IF NEW.status = 'captured' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'captured') THEN
    IF current_setting('app.ledger_internal_capture', true) = 'on' THEN
      RETURN NEW;
    END IF;

    IF COALESCE(NEW.payment_method_code, '') = 'paymob'
       AND COALESCE(NEW.payment_method_type, '') = 'online' THEN
      IF EXISTS (
        SELECT 1
        FROM public.paymob_webhook_events e
        WHERE e.payment_id = NEW.id
          AND e.outcome = 'captured'
      ) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Paymob online payments can only be captured by the verified webhook.'
        USING ERRCODE = '42501';
    END IF;

    SELECT status INTO v_booking_status FROM public.bookings WHERE id = NEW.booking_id;
    IF v_booking_status IS DISTINCT FROM 'completed' THEN
      RAISE EXCEPTION 'Payment cannot be captured until the booking is completed (current booking status: %)', v_booking_status
        USING ERRCODE = '42501';
    END IF;

    IF COALESCE(NEW.payment_method_type, '') = 'cash' THEN
      RETURN NEW;
    END IF;

    IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'This payment method can only be captured after admin review.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 7) Weekly settlement job (no money movement)
-- Closed period ends at the most recent settlement_weekday 10:00 Africa/Cairo
-- that is not in the future. Boundaries use Cairo local dates, not timestamptz ±7 days.
-- ============================================================
CREATE OR REPLACE FUNCTION public.provider_settlement_period_containing(p_moment timestamptz)
RETURNS TABLE (
  period_start timestamptz,
  period_end timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_weekday int;
  v_local timestamp;
  v_date date;
  v_end timestamptz;
BEGIN
  SELECT s.settlement_weekday INTO v_weekday FROM public.provider_settlement_settings() s;
  v_local := timezone('Africa/Cairo', p_moment);
  v_date := v_local::date;
  WHILE EXTRACT(DOW FROM v_date)::int <> v_weekday LOOP
    v_date := v_date - 1;
  END LOOP;
  v_end := (v_date + time '10:00') AT TIME ZONE 'Africa/Cairo';
  IF p_moment >= v_end THEN
    v_date := v_date + 7;
    v_end := (v_date + time '10:00') AT TIME ZONE 'Africa/Cairo';
  END IF;
  period_end := v_end;
  period_start := ((v_date - 7) + time '10:00') AT TIME ZONE 'Africa/Cairo';
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.provider_settlement_period_containing(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_settlement_period_containing(timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.provider_settlement_closed_period()
RETURNS TABLE (
  period_start timestamptz,
  period_end timestamptz,
  next_settlement_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_weekday int;
  v_local timestamp;
  v_date date;
  v_end timestamptz;
BEGIN
  SELECT s.settlement_weekday INTO v_weekday FROM public.provider_settlement_settings() s;
  v_local := timezone('Africa/Cairo', now());
  v_date := v_local::date;
  WHILE EXTRACT(DOW FROM v_date)::int <> v_weekday LOOP
    v_date := v_date - 1;
  END LOOP;
  v_end := (v_date + time '10:00') AT TIME ZONE 'Africa/Cairo';
  IF v_end > now() THEN
    v_date := v_date - 7;
    v_end := (v_date + time '10:00') AT TIME ZONE 'Africa/Cairo';
  END IF;
  period_end := v_end;
  period_start := ((v_date - 7) + time '10:00') AT TIME ZONE 'Africa/Cairo';
  next_settlement_at := ((v_date + 7) + time '10:00') AT TIME ZONE 'Africa/Cairo';
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.provider_settlement_closed_period() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_settlement_closed_period() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.run_provider_weekly_settlements()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closed_start timestamptz;
  v_closed_end timestamptz;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_oldest timestamptz;
  v_cairo_date date;
  v_row RECORD;
  v_net numeric;
  v_abs numeric;
  v_direction text;
  v_settlement_id uuid;
  v_totals jsonb;
  v_count integer := 0;
  v_profile uuid;
  v_entry_ids uuid[];
  v_settlement_kinds text[] := ARRAY[
    'cash_collected_platform_share',
    'online_provider_share',
    'adjustment',
    'debt_payment_received',
    'payout_sent'
  ];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('famy_weekly_settlements', 0));

  SELECT p.period_start, p.period_end
    INTO v_closed_start, v_closed_end
  FROM public.provider_settlement_closed_period() p;

  SELECT min(e.created_at) INTO v_oldest
  FROM public.provider_ledger_entries e
  WHERE e.settlement_id IS NULL
    AND e.kind = ANY (v_settlement_kinds);

  IF v_oldest IS NULL THEN
    RETURN 0;
  END IF;

  SELECT pc.period_start, pc.period_end
    INTO v_period_start, v_period_end
  FROM public.provider_settlement_period_containing(v_oldest) pc;

  WHILE v_period_end <= v_closed_end LOOP
    FOR v_row IN
      SELECT e.provider_id
      FROM public.provider_ledger_entries e
      WHERE e.settlement_id IS NULL
        AND e.created_at < v_period_end
        AND e.kind = ANY (v_settlement_kinds)
      GROUP BY e.provider_id
    LOOP
      SELECT id INTO v_settlement_id
      FROM public.provider_settlements
      WHERE provider_id = v_row.provider_id
        AND period_start = v_period_start
        AND period_end = v_period_end;

      IF v_settlement_id IS NOT NULL THEN
        CONTINUE;
      END IF;

      SELECT COALESCE(array_agg(e.id ORDER BY e.created_at), ARRAY[]::uuid[])
      INTO v_entry_ids
      FROM public.provider_ledger_entries e
      WHERE e.provider_id = v_row.provider_id
        AND e.settlement_id IS NULL
        AND e.created_at < v_period_end
        AND e.kind = ANY (v_settlement_kinds);

      IF v_entry_ids IS NULL OR cardinality(v_entry_ids) = 0 THEN
        CONTINUE;
      END IF;

      SELECT COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END), 0)
      INTO v_net
      FROM public.provider_ledger_entries e
      WHERE e.id = ANY (v_entry_ids);

      SELECT COALESCE(jsonb_object_agg(x.method, x.amt), '{}'::jsonb)
      INTO v_totals
      FROM (
        SELECT COALESCE(e.payment_method, 'unknown') AS method,
               SUM(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END) AS amt
        FROM public.provider_ledger_entries e
        WHERE e.id = ANY (v_entry_ids)
        GROUP BY 1
      ) x;

      IF v_net = 0 THEN
        INSERT INTO public.provider_settlements (
          provider_id, period_start, period_end, amount, direction, status, settled_at, totals_by_method
        ) VALUES (
          v_row.provider_id, v_period_start, v_period_end, 0, 'famy_pays_provider', 'paid', now(),
          COALESCE(v_totals, '{}'::jsonb)
        )
        ON CONFLICT (provider_id, period_start, period_end) DO NOTHING
        RETURNING id INTO v_settlement_id;

        IF v_settlement_id IS NULL THEN
          CONTINUE;
        END IF;

        PERFORM set_config('app.ledger_link_settlement', 'on', true);
        UPDATE public.provider_ledger_entries e
        SET settlement_id = v_settlement_id
        WHERE e.id = ANY (v_entry_ids)
          AND e.settlement_id IS NULL;
        CONTINUE;
      END IF;

      v_abs := abs(v_net);
      v_direction := CASE WHEN v_net > 0 THEN 'famy_pays_provider' ELSE 'provider_pays_famy' END;
      v_settlement_id := NULL;

      INSERT INTO public.provider_settlements (
        provider_id, period_start, period_end, amount, direction, totals_by_method
      ) VALUES (
        v_row.provider_id, v_period_start, v_period_end, v_abs, v_direction, COALESCE(v_totals, '{}'::jsonb)
      )
      ON CONFLICT (provider_id, period_start, period_end) DO NOTHING
      RETURNING id INTO v_settlement_id;

      IF v_settlement_id IS NULL THEN
        CONTINUE;
      END IF;

      v_count := v_count + 1;
      SELECT p.profile_id INTO v_profile FROM public.providers p WHERE p.id = v_row.provider_id;
      IF v_profile IS NOT NULL THEN
        INSERT INTO public.notifications (
          user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
        ) VALUES (
          v_profile, 'provider_settlement_created', 'provider',
          'Weekly settlement', 'A weekly settlement was created. Check your earnings for details.',
          'Weekly settlement', 'تسوية أسبوعية',
          'A weekly settlement was created. Check your earnings for details.',
          'اتعملت تسوية أسبوعية، شوف تفاصيلها في الأرباح',
          jsonb_build_object('provider_id', v_row.provider_id, 'settlement_id', v_settlement_id),
          '/pro/earnings'
        );
      END IF;

      PERFORM set_config('app.ledger_link_settlement', 'on', true);
      UPDATE public.provider_ledger_entries e
      SET settlement_id = v_settlement_id
      WHERE e.id = ANY (v_entry_ids)
        AND e.settlement_id IS NULL;
    END LOOP;

    v_cairo_date := (timezone('Africa/Cairo', v_period_end))::date;
    v_period_start := v_period_end;
    v_period_end := ((v_cairo_date + 7) + time '10:00') AT TIME ZONE 'Africa/Cairo';
  END LOOP;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.run_provider_weekly_settlements() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_provider_weekly_settlements() TO service_role;

-- ============================================================
-- 8) Admin settlement actions
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_mark_provider_settlement_settled(
  p_settlement_id uuid,
  p_reference text,
  p_note text,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settlement public.provider_settlements%ROWTYPE;
  v_profile uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_reference IS NULL OR btrim(p_reference) = ''
     OR p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Reference and reason are required' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_settlement FROM public.provider_settlements WHERE id = p_settlement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Settlement not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_settlement.status <> 'pending' THEN
    RAISE EXCEPTION 'Settlement is not pending' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.audit_reason', btrim(p_reason), true);

  IF v_settlement.direction = 'famy_pays_provider' THEN
    PERFORM public.ledger_insert_entry(
      v_settlement.provider_id, NULL, 'payout_sent', 'debit', v_settlement.amount,
      NULL, NULLIF(btrim(p_note), ''), auth.uid(), p_settlement_id
    );
    UPDATE public.provider_settlements
    SET status = 'paid', payment_reference = btrim(p_reference), note = NULLIF(btrim(p_note), ''),
        settled_at = now(), settled_by = auth.uid()
    WHERE id = p_settlement_id;
  ELSE
    PERFORM public.ledger_insert_entry(
      v_settlement.provider_id, NULL, 'debt_payment_received', 'credit', v_settlement.amount,
      NULL, NULLIF(btrim(p_note), ''), auth.uid(), p_settlement_id
    );
    UPDATE public.provider_settlements
    SET status = 'received', payment_reference = btrim(p_reference), note = NULLIF(btrim(p_note), ''),
        settled_at = now(), settled_by = auth.uid()
    WHERE id = p_settlement_id;
  END IF;

  SELECT p.profile_id INTO v_profile FROM public.providers p WHERE p.id = v_settlement.provider_id;
  IF v_profile IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link
    ) VALUES (
      v_profile, 'provider_settlement_settled', 'provider',
      'Settlement settled', 'Your weekly settlement was marked settled.',
      'Settlement settled', 'اتسجلت التسوية',
      'Your weekly settlement was marked settled.',
      'اتسجلت تسويتك الأسبوعية',
      jsonb_build_object('settlement_id', p_settlement_id),
      '/pro/earnings'
    );
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_mark_provider_settlement_settled(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_provider_settlement_settled(uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_provider_ledger_adjustment(
  p_provider_id uuid,
  p_direction text,
  p_amount numeric,
  p_reason text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Reason is required' USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('app.audit_reason', btrim(p_reason), true);
  v_id := public.ledger_insert_entry(
    p_provider_id, NULL, 'adjustment', p_direction, p_amount, NULL, btrim(p_note), auth.uid(), NULL
  );
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_provider_ledger_adjustment(uuid, text, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_provider_ledger_adjustment(uuid, text, numeric, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_record_historic_cash_collected(
  p_booking_id uuid,
  p_reason text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_platform_share numeric;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Reason is required' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR v_booking.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'Booking must be completed' USING ERRCODE = '23514';
  END IF;
  IF v_booking.price_provider_net IS NULL THEN
    RAISE EXCEPTION 'Booking has no commission snapshot' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.booking_id = p_booking_id
      AND COALESCE(p.payment_method_type, '') = 'cash'
  ) THEN
    RAISE EXCEPTION 'Historic cash collection requires a cash payment on the booking' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.provider_ledger_entries e
    WHERE e.booking_id = p_booking_id
      AND e.kind = 'online_provider_share'
  ) THEN
    RAISE EXCEPTION 'Booking already has an online provider share ledger entry' USING ERRCODE = '23514';
  END IF;
  v_platform_share := GREATEST(COALESCE(v_booking.price_total, 0) - COALESCE(v_booking.price_provider_net, 0), 0);
  IF v_platform_share <= 0 THEN
    RAISE EXCEPTION 'Platform share must be positive' USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('app.audit_reason', btrim(p_reason), true);
  v_id := public.ledger_insert_entry(
    v_booking.provider_id, p_booking_id, 'cash_collected_platform_share', 'debit',
    v_platform_share, 'cash', btrim(p_note), auth.uid(), NULL
  );
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Cash share for this booking is already recorded' USING ERRCODE = '23505';
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_record_historic_cash_collected(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_record_historic_cash_collected(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_record_provider_debt_payment(
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
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_reference IS NULL OR btrim(p_reference) = ''
     OR p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Amount, reference and reason are required' USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('app.audit_reason', btrim(p_reason), true);
  v_id := public.ledger_insert_entry(
    p_provider_id, NULL, 'debt_payment_received', 'credit', p_amount,
    'manual_transfer', concat('ref:', btrim(p_reference), ' ', coalesce(btrim(p_note), '')), auth.uid(), NULL
  );
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_record_provider_debt_payment(uuid, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_record_provider_debt_payment(uuid, numeric, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_provider_settlements(p_provider_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(
    (
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.created_at DESC)
      FROM public.provider_settlements s
      WHERE s.provider_id = p_provider_id
    ),
    '[]'::jsonb
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_provider_settlements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_provider_settlements(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_provider_ledger_entries(p_provider_id uuid, p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(
    (
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC)
      FROM (
        SELECT *
        FROM public.provider_ledger_entries
        WHERE provider_id = p_provider_id
        ORDER BY created_at DESC
        LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
      ) e
    ),
    '[]'::jsonb
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_provider_ledger_entries(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_provider_ledger_entries(uuid, int) TO authenticated;

-- ============================================================
-- 9) RLS
-- ============================================================
ALTER TABLE public.provider_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_settlement_accounts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.provider_ledger_entries FROM PUBLIC, anon;
REVOKE ALL ON public.provider_settlements FROM PUBLIC, anon;
REVOKE ALL ON public.provider_settlement_accounts FROM PUBLIC, anon;

CREATE POLICY provider_ledger_select_own ON public.provider_ledger_entries
  FOR SELECT TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.profile_id = (select auth.uid())
    )
  );

CREATE POLICY provider_settlements_select ON public.provider_settlements
  FOR SELECT TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.profile_id = (select auth.uid())
    )
  );

CREATE POLICY provider_settlement_accounts_select ON public.provider_settlement_accounts
  FOR SELECT TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'));

CREATE INDEX IF NOT EXISTS idx_provider_ledger_entries_provider_id
  ON public.provider_ledger_entries (provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_ledger_entries_booking_id
  ON public.provider_ledger_entries (booking_id);
CREATE INDEX IF NOT EXISTS idx_provider_ledger_entries_settlement_id
  ON public.provider_ledger_entries (settlement_id);
CREATE INDEX IF NOT EXISTS idx_provider_settlements_provider_id
  ON public.provider_settlements (provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_ledger_entries_created_by
  ON public.provider_ledger_entries (created_by);
CREATE INDEX IF NOT EXISTS idx_provider_settlements_settled_by
  ON public.provider_settlements (settled_by);

REVOKE SELECT ON public.provider_ledger_entries FROM authenticated;
GRANT SELECT (
  id, provider_id, booking_id, settlement_id, kind, direction, amount, payment_method,
  created_by, created_at
) ON public.provider_ledger_entries TO authenticated;

REVOKE SELECT ON public.provider_settlements FROM authenticated;
GRANT SELECT (
  id, provider_id, period_start, period_end, amount, direction, status, totals_by_method,
  payment_reference, created_at, settled_at, settled_by
) ON public.provider_settlements TO authenticated;

GRANT SELECT ON public.provider_settlement_accounts TO authenticated;

-- ============================================================
-- 10) Booking + marketplace guards
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_booking(
  p_provider_id uuid,
  p_service_id uuid,
  p_address_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_idempotency_key uuid,
  p_family_member_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_promo_code_id uuid DEFAULT NULL,
  p_requirement_selections jsonb DEFAULT '[]'::jsonb,
  p_teaching_capability_id uuid DEFAULT NULL,
  p_teaching_subject_code text DEFAULT NULL,
  p_teaching_curriculum_code text DEFAULT NULL,
  p_teaching_level_code text DEFAULT NULL,
  p_supervision_mode text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_fingerprint text;
  v_existing RECORD;
  v_booking_id uuid;
  v_created boolean := false;
  v_min_hours_before_start numeric;
  v_provider_min_notice integer;
  v_required_hours numeric;
  v_category_slug text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF public.is_not_suspended(v_uid) IS NOT TRUE THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Account is suspended.' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Idempotency key is required.' USING ERRCODE = '23514';
  END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Invalid booking time range.' USING ERRCODE = '23514';
  END IF;

  SELECT cat.slug INTO v_category_slug
  FROM public.services s
  JOIN public.categories cat ON cat.id = s.category_id
  WHERE s.id = p_service_id;

  IF v_category_slug IN ('babysitting', 'tutoring') THEN
    IF p_supervision_mode IS NULL OR p_supervision_mode NOT IN ('cameras', 'adult_present') THEN
      RAISE EXCEPTION 'BOOKING_SUPERVISION_REQUIRED: Choose how your child will be supervised during this service.' USING ERRCODE = '23514';
    END IF;
  END IF;

  v_fingerprint := public.booking_request_fingerprint(
    p_provider_id, p_service_id, p_address_id, p_start_at, p_end_at,
    p_family_member_id, p_notes, p_promo_code_id, coalesce(p_requirement_selections, '[]'::jsonb),
    p_teaching_capability_id, p_teaching_subject_code, p_teaching_curriculum_code, p_teaching_level_code,
    p_supervision_mode
  );

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_idempotency_key::text, 0));

  SELECT id, request_fingerprint INTO v_existing
  FROM public.bookings
  WHERE customer_id = v_uid AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'BOOKING_DUPLICATE_REQUEST_CONFLICT: Idempotency key reused with different booking details.' USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object(
      'booking_id', v_existing.id,
      'created', false,
      'idempotent_replay', true
    );
  END IF;

  SELECT s.min_hours_before_start INTO v_min_hours_before_start
  FROM public.booking_expiry_settings() s;
  SELECT min_notice_hours INTO v_provider_min_notice
  FROM public.providers WHERE id = p_provider_id;
  v_required_hours := GREATEST(COALESCE(v_min_hours_before_start, 2), COALESCE(v_provider_min_notice, 0)::numeric);
  IF p_start_at < now() + (v_required_hours * interval '1 hour') THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: This start time is too soon for the provider to respond in time.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.marketplace_eligibility_internal(p_provider_id, p_service_id, p_address_id) e
    WHERE e.is_eligible
  ) THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Provider is not eligible for this service and address.' USING ERRCODE = '23514';
  END IF;

  IF public.provider_cash_debt_blocked(p_provider_id) THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_SETTLEMENT_BLOCKED: Provider cannot receive new bookings until platform balance is settled.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.create_booking_in_progress', 'on', true);

  BEGIN
    INSERT INTO public.bookings (
      customer_id, provider_id, service_id, address_id,
      start_at, end_at, status, notes, family_member_id,
      requirement_selections, promo_code_id,
      price_subtotal, price_discount, price_total,
      price_platform_fee, price_vat, price_extras_total, price_travel_fee,
      idempotency_key, request_fingerprint, currency,
      teaching_capability_id, teaching_subject_code, teaching_curriculum_code, teaching_level_code,
      supervision_mode
    ) VALUES (
      v_uid, p_provider_id, p_service_id, p_address_id,
      p_start_at, p_end_at, 'pending', NULLIF(btrim(p_notes), ''), p_family_member_id,
      coalesce(p_requirement_selections, '[]'::jsonb), p_promo_code_id,
      0, 0, 0, 0, 0, 0, 0,
      p_idempotency_key, v_fingerprint, 'EGP',
      p_teaching_capability_id, NULLIF(btrim(p_teaching_subject_code), ''),
      NULLIF(btrim(p_teaching_curriculum_code), ''), NULLIF(btrim(p_teaching_level_code), ''),
      p_supervision_mode
    ) RETURNING id INTO v_booking_id;
    v_created := true;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id, request_fingerprint INTO v_existing
      FROM public.bookings
      WHERE customer_id = v_uid AND idempotency_key = p_idempotency_key;
      IF FOUND AND v_existing.request_fingerprint = v_fingerprint THEN
        RETURN jsonb_build_object(
          'booking_id', v_existing.id,
          'created', false,
          'idempotent_replay', true
        );
      END IF;
      RAISE EXCEPTION 'BOOKING_DUPLICATE_REQUEST_CONFLICT: Concurrent duplicate booking request.' USING ERRCODE = '23514';
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'BOOKING_SLOT_UNAVAILABLE: That time slot is no longer available.' USING ERRCODE = '23514';
    WHEN SQLSTATE '23514' THEN
      RAISE;
    WHEN SQLSTATE '42501' THEN
      RAISE;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'BOOKING_%' THEN
        RAISE;
      END IF;
      RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Unable to create booking.' USING ERRCODE = '23514';
  END;

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'created', v_created,
    'idempotent_replay', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb, uuid, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb, uuid, text, text, text, text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.search_marketplace_providers(
  p_service_id uuid DEFAULT NULL,
  p_address_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, full_name text, avatar_url text, bio_en text, bio_ar text,
  hourly_rate numeric, years_experience integer, languages text[], city text,
  is_top_pro boolean, is_verified boolean, response_time_min integer,
  service_id uuid, service_slug text, service_name_en text, service_name_ar text,
  category_slug text, rating_avg numeric, rating_count bigint, trust_score numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_address uuid := p_address_id;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'customer') OR public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Customer identity required' USING ERRCODE = '42501';
  END IF;
  IF v_address IS NULL THEN
    SELECT a.id INTO v_address FROM public.addresses a
    WHERE a.user_id = v_uid ORDER BY a.is_default DESC, a.created_at ASC LIMIT 1;
  END IF;
  IF v_address IS NULL OR NOT EXISTS (SELECT 1 FROM public.addresses a WHERE a.id = v_address AND a.user_id = v_uid) THEN
    RAISE EXCEPTION 'A Customer-owned address is required' USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (p.id, s.id)
    p.id, pr.full_name, pr.avatar_url, p.bio_en, p.bio_ar, e.effective_price,
    p.years_experience, p.languages, p.city, p.is_top_pro, p.is_verified,
    p.response_time_min, s.id, s.slug, s.name_en, s.name_ar, c.slug,
    COALESCE(rs.rating_avg, 0), COALESCE(rs.rating_count, 0)::bigint, COALESCE(ts.score, 0)
  FROM public.providers p
  JOIN LATERAL public.marketplace_eligibility_internal(p.id, p_service_id, v_address) e ON e.is_eligible
  JOIN public.profiles pr ON pr.id = p.profile_id
  JOIN public.services s ON s.id = e.service_id
  JOIN public.categories c ON c.id = s.category_id
  LEFT JOIN public.ratings_summary rs ON rs.provider_id = p.id
  LEFT JOIN public.trust_scores ts ON ts.provider_id = p.id
  WHERE public.is_phase1_category_slug(c.slug)
    AND NOT public.provider_cash_debt_blocked(p.id)
  ORDER BY p.id, s.id, p.is_top_pro DESC, COALESCE(rs.rating_avg, 0) DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.search_marketplace_providers(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_marketplace_providers(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.marketplace_provider_bookable_services(
  p_provider_id uuid,
  p_address_id uuid DEFAULT NULL
)
RETURNS TABLE (service_id uuid, effective_price numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_address uuid := p_address_id;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'customer') OR public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Customer identity required' USING ERRCODE = '42501';
  END IF;
  IF public.provider_cash_debt_blocked(p_provider_id) THEN
    RETURN;
  END IF;
  IF v_address IS NULL THEN
    SELECT a.id INTO v_address FROM public.addresses a WHERE a.user_id = v_uid
    ORDER BY a.is_default DESC, a.created_at ASC LIMIT 1;
  END IF;
  IF v_address IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.addresses a WHERE a.id = v_address AND a.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Address does not belong to Customer' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT x.service_id, x.effective_price
  FROM public.marketplace_eligibility_internal(p_provider_id, NULL, v_address) x
  WHERE x.is_eligible;
END;
$$;
REVOKE ALL ON FUNCTION public.marketplace_provider_bookable_services(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketplace_provider_bookable_services(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.tg_block_provider_ledger_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_booking_ledger_on_complete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_payment_ledger_on_capture() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_guard_payment_writes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_validate_payment_capture() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_provider_ledger_entries ON public.provider_ledger_entries;
CREATE TRIGGER trg_audit_provider_ledger_entries
  AFTER INSERT OR UPDATE ON public.provider_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

DROP TRIGGER IF EXISTS trg_audit_provider_settlements ON public.provider_settlements;
CREATE TRIGGER trg_audit_provider_settlements
  AFTER INSERT OR UPDATE ON public.provider_settlements
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

-- ============================================================
-- 11) pg_cron — daily 10:00 Africa/Cairo (settlement close)
-- pg_cron fires in UTC. 10:00 Cairo is 08:00 UTC in winter (UTC+2) and
-- 07:00 UTC in summer (UTC+3). Both hours run every day; the job is idempotent
-- and honours provider_settlement_settings().settlement_weekday internally.
-- ============================================================
DO $$
BEGIN
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron extension unavailable (%); schedule run_provider_weekly_settlements() externally.', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'famy-provider-weekly-settlements') THEN
      PERFORM cron.unschedule('famy-provider-weekly-settlements');
    END IF;
    PERFORM cron.schedule(
      'famy-provider-weekly-settlements',
      '0 7,8 * * *',
      $cron$SELECT public.run_provider_weekly_settlements();$cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron scheduling skipped (%); schedule run_provider_weekly_settlements() externally.', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
