-- Payments setup requested by the Product Owner:
-- 1. Famy's real InstaPay address and payment link (editable later from Admin > Payment methods).
-- 2. Card payments shown as "Card payment" instead of the gateway's name.
-- 3. Provider payout methods: bank account, mobile wallets and InstaPay, so admin can pay providers.

-- 1 + 2: payment method display data (admin-editable rows; no secrets)
-- Merge (keep other admin settings). The old English-only sample note is dropped because
-- it was shown to Arabic customers ahead of the localized instructions.
UPDATE public.payment_methods
SET public_config = (CASE
        WHEN public_config->>'note' = 'Send your transfer to this InstaPay handle and upload the screenshot as proof.'
          THEN public_config - 'note'
        ELSE public_config
      END)
      || jsonb_build_object(
        'handle', 'safeyqnb2@instapay',
        'pay_link', 'https://ipn.eg/S/safeyqnb2/instapay/3VFChS'
      ),
    updated_at = now()
WHERE code = 'instapay';

UPDATE public.payment_methods
SET name_ar = 'الدفع بالكارت',
    name_en = 'Card payment',
    updated_at = now()
WHERE code = 'paymob';

-- The payment link is shown to customers, so only https links are accepted.
ALTER TABLE public.payment_methods
  DROP CONSTRAINT IF EXISTS payment_methods_pay_link_https;
ALTER TABLE public.payment_methods
  ADD CONSTRAINT payment_methods_pay_link_https
  CHECK (NOT (public_config ? 'pay_link') OR (public_config->>'pay_link') ~ '^https://[^\s]+$');

-- 3: provider payout methods
CREATE TABLE IF NOT EXISTS public.provider_payout_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  method text NOT NULL
    CHECK (method IN ('bank', 'vodafone_cash', 'etisalat_cash', 'orange_cash', 'instapay')),
  holder_name text NOT NULL CHECK (length(btrim(holder_name)) BETWEEN 2 AND 120),
  bank_name text CHECK (bank_name IS NULL OR length(btrim(bank_name)) BETWEEN 2 AND 120),
  account_number text CHECK (account_number IS NULL OR account_number ~ '^[A-Za-z0-9]{6,34}$'),
  wallet_phone text CHECK (wallet_phone IS NULL OR wallet_phone ~ '^01[0125][0-9]{8}$'),
  instapay_address text CHECK (
    instapay_address IS NULL
    OR instapay_address ~ '^[A-Za-z0-9._-]{2,64}@instapay$'
    OR instapay_address ~ '^01[0125][0-9]{8}$'
  ),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_payout_methods_fields CHECK (
    CASE method
      WHEN 'bank' THEN bank_name IS NOT NULL AND account_number IS NOT NULL
        AND wallet_phone IS NULL AND instapay_address IS NULL
      WHEN 'instapay' THEN instapay_address IS NOT NULL
        AND bank_name IS NULL AND account_number IS NULL AND wallet_phone IS NULL
      ELSE wallet_phone IS NOT NULL
        AND bank_name IS NULL AND account_number IS NULL AND instapay_address IS NULL
    END
  )
);

CREATE INDEX IF NOT EXISTS provider_payout_methods_provider_idx
  ON public.provider_payout_methods (provider_id);
CREATE UNIQUE INDEX IF NOT EXISTS provider_payout_methods_one_default
  ON public.provider_payout_methods (provider_id) WHERE is_default;

ALTER TABLE public.provider_payout_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payout_methods_admin_read ON public.provider_payout_methods;
CREATE POLICY payout_methods_admin_read ON public.provider_payout_methods
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS payout_methods_provider_manage ON public.provider_payout_methods;
CREATE POLICY payout_methods_provider_manage ON public.provider_payout_methods
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.providers p
    WHERE p.id = provider_payout_methods.provider_id AND p.profile_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.providers p
    WHERE p.id = provider_payout_methods.provider_id AND p.profile_id = (SELECT auth.uid())
  ));

REVOKE ALL ON public.provider_payout_methods FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_payout_methods TO authenticated;

DROP TRIGGER IF EXISTS trg_payout_methods_updated_at ON public.provider_payout_methods;
CREATE TRIGGER trg_payout_methods_updated_at
  BEFORE UPDATE ON public.provider_payout_methods
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Changes to where money is sent are always audited.
DROP TRIGGER IF EXISTS trg_audit_provider_payout_methods ON public.provider_payout_methods;
CREATE TRIGGER trg_audit_provider_payout_methods
  AFTER INSERT OR UPDATE OR DELETE ON public.provider_payout_methods
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

-- Exactly one primary method whenever a provider has any: the first one added becomes
-- primary, and removing the primary promotes the oldest remaining one.
CREATE OR REPLACE FUNCTION public.tg_provider_payout_methods_primary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.provider_payout_methods m
      WHERE m.provider_id = NEW.provider_id AND m.is_default
    ) THEN
      NEW.is_default := true;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.is_default THEN
    UPDATE public.provider_payout_methods m
    SET is_default = true
    WHERE m.id = (
      SELECT m2.id FROM public.provider_payout_methods m2
      WHERE m2.provider_id = OLD.provider_id
      ORDER BY m2.created_at, m2.id
      LIMIT 1
    );
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_payout_methods_primary_insert ON public.provider_payout_methods;
CREATE TRIGGER trg_payout_methods_primary_insert
  BEFORE INSERT ON public.provider_payout_methods
  FOR EACH ROW EXECUTE FUNCTION public.tg_provider_payout_methods_primary();
DROP TRIGGER IF EXISTS trg_payout_methods_primary_delete ON public.provider_payout_methods;
CREATE TRIGGER trg_payout_methods_primary_delete
  AFTER DELETE ON public.provider_payout_methods
  FOR EACH ROW EXECUTE FUNCTION public.tg_provider_payout_methods_primary();

-- Switch the primary method in one step (runs with the caller's permissions, so RLS applies).
CREATE OR REPLACE FUNCTION public.set_primary_payout_method(p_method_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_provider uuid;
BEGIN
  SELECT m.provider_id INTO v_provider
  FROM public.provider_payout_methods m WHERE m.id = p_method_id;
  IF v_provider IS NULL THEN
    RAISE EXCEPTION 'Payout method not found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.provider_payout_methods m
  SET is_default = false
  WHERE m.provider_id = v_provider AND m.is_default AND m.id <> p_method_id;
  UPDATE public.provider_payout_methods m SET is_default = true WHERE m.id = p_method_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout method not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_primary_payout_method(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_primary_payout_method(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
