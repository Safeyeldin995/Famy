-- Patch 2 / Module 3: Configurable Payment Methods.
-- Additive only. Introduces an admin-managed payment_methods table (cash,
-- InstaPay, Paymob-inactive) and immutable per-payment snapshots so later
-- admin edits/deactivation never alter historical bookings/payments.

-- Isolated on its own line per existing convention (see 20260628233926) —
-- not used anywhere else in this migration/transaction.
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'paymob';

-- ============================================================
-- 1) payment_methods
-- ============================================================
CREATE TABLE IF NOT EXISTS public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  instructions_en text,
  instructions_ar text,
  method_type text NOT NULL CHECK (method_type IN ('cash','manual_transfer','online')),
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  -- Customer-visible data only (e.g. InstaPay handle). Gateway secrets/keys/
  -- tokens must never live here — this is a light safety net, not the only guard.
  public_config jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (NOT (public_config ?| array['secret','secret_key','api_key','private_key','token','password','client_secret'])),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- At most one row can ever be the default.
CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_one_default
  ON public.payment_methods (is_default) WHERE is_default;

GRANT SELECT ON public.payment_methods TO authenticated;
GRANT ALL ON public.payment_methods TO service_role;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_methods_public_read" ON public.payment_methods
  FOR SELECT TO authenticated USING (is_active);
CREATE POLICY "payment_methods_admin_all" ON public.payment_methods
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_payment_methods_updated BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Reuse the existing generic audit mechanism (see 20260627164621/164829).
DROP TRIGGER IF EXISTS trg_audit_payment_methods ON public.payment_methods;
CREATE TRIGGER trg_audit_payment_methods AFTER INSERT OR UPDATE OR DELETE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

-- A default must be active. Combined with the partial unique index above,
-- this guarantees at most one *active* default ever exists. Because a plain
-- UPDATE that flips is_active=false on the current default leaves is_default
-- unchanged (=true), it fails this check — the caller must first move the
-- default elsewhere (see admin_set_default_payment_method below) before it
-- can deactivate the old one, satisfying "disabling the default requires
-- selecting another default" at the database level, not just in the UI.
CREATE OR REPLACE FUNCTION public.tg_guard_payment_method_default()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_default AND NOT NEW.is_active THEN
    RAISE EXCEPTION 'A default payment method must be active. Choose another default first.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_guard_payment_method_default() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_payment_method_default ON public.payment_methods;
CREATE TRIGGER trg_guard_payment_method_default BEFORE INSERT OR UPDATE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_payment_method_default();

-- Atomic default swap — a single admin_all-gated UPDATE per row would each
-- run in its own request/transaction via PostgREST, which the partial unique
-- index would reject mid-swap. This RPC does both in one transaction.
CREATE OR REPLACE FUNCTION public.admin_set_default_payment_method(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin only.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payment_methods WHERE id = p_id AND is_active) THEN
    RAISE EXCEPTION 'Payment method must be active to be set as default.' USING ERRCODE = '23514';
  END IF;
  UPDATE public.payment_methods SET is_default = false WHERE is_default = true AND id <> p_id;
  UPDATE public.payment_methods SET is_default = true WHERE id = p_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_default_payment_method(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_default_payment_method(uuid) TO authenticated;

-- Seed idempotently. InstaPay's public_config carries over any handle/note an
-- admin already configured via the old settings.instapay_receiver key so
-- nothing is silently reset.
INSERT INTO public.payment_methods
  (code, name_en, name_ar, instructions_en, instructions_ar, method_type, is_active, is_default, display_order, public_config)
VALUES
  (
    'cash_on_delivery', 'Cash on Delivery', 'الدفع عند الاستلام',
    'Pay your professional directly in cash when the job is done.',
    'ادفع للمحترف نقدًا مباشرة عند الانتهاء من الخدمة.',
    'cash', true, true, 1, '{}'::jsonb
  ),
  (
    'instapay', 'InstaPay', 'إنستاباي',
    'Transfer the amount via InstaPay and upload your receipt as proof. Famy reviews it manually.',
    'حوّل المبلغ عبر إنستاباي وارفع صورة الإيصال. تراجع Famy الدفع يدويًا.',
    'manual_transfer', true, false, 2,
    jsonb_build_object(
      'handle', COALESCE((SELECT value->>'handle' FROM public.settings WHERE key = 'instapay_receiver'), 'famy@instapay'),
      'note', COALESCE((SELECT value->>'note' FROM public.settings WHERE key = 'instapay_receiver'), 'Send your transfer to this InstaPay handle and upload the screenshot as proof.')
    )
  ),
  (
    'paymob', 'Paymob', 'بايموب',
    NULL, NULL,
    'online', false, false, 3, '{}'::jsonb
  )
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 2) Immutable per-payment snapshot
-- ============================================================
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_method_id uuid REFERENCES public.payment_methods(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS payment_method_code text,
  ADD COLUMN IF NOT EXISTS payment_method_name_en text,
  ADD COLUMN IF NOT EXISTS payment_method_name_ar text,
  ADD COLUMN IF NOT EXISTS payment_method_type text,
  ADD COLUMN IF NOT EXISTS payment_method_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Historical rows predate payment_methods and have no id to reference; the
-- legacy `method` enum column remains their source of truth and is untouched.
ALTER TABLE public.payments ALTER COLUMN method DROP NOT NULL;

-- Never trust client-supplied name/instructions/type for a payment row —
-- always copy from the authoritative payment_methods row server-side, and
-- reject missing/inactive methods outright. Runs BEFORE INSERT only, so the
-- snapshot is genuinely immutable once created.
CREATE OR REPLACE FUNCTION public.tg_snapshot_payment_method()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pm RECORD;
BEGIN
  IF NEW.payment_method_id IS NULL THEN
    RAISE EXCEPTION 'A payment method is required.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_pm FROM public.payment_methods WHERE id = NEW.payment_method_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected payment method does not exist.' USING ERRCODE = '23514';
  END IF;
  IF NOT v_pm.is_active THEN
    RAISE EXCEPTION 'Selected payment method is not currently available.' USING ERRCODE = '23514';
  END IF;

  NEW.payment_method_code := v_pm.code;
  NEW.payment_method_name_en := v_pm.name_en;
  NEW.payment_method_name_ar := v_pm.name_ar;
  NEW.payment_method_type := v_pm.method_type;
  NEW.payment_method_snapshot := jsonb_build_object(
    'instructions_en', v_pm.instructions_en,
    'instructions_ar', v_pm.instructions_ar,
    'public_config', v_pm.public_config
  );

  -- Best-effort mapping onto the legacy enum for the 3 known seeded codes,
  -- so existing reads of `method` keep working. Custom codes an admin adds
  -- later have no legacy equivalent and are left NULL there deliberately —
  -- payment_method_code is the actual source of truth going forward.
  NEW.method := CASE v_pm.code
    WHEN 'cash_on_delivery' THEN 'cash'::public.payment_method
    WHEN 'instapay' THEN 'instapay'::public.payment_method
    WHEN 'paymob' THEN 'paymob'::public.payment_method
    ELSE NULL
  END;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_snapshot_payment_method() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_snapshot_payment_method ON public.payments;
CREATE TRIGGER trg_snapshot_payment_method BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_snapshot_payment_method();
