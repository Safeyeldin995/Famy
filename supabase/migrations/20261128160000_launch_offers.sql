-- Launch offers (PO decision, 28 Nov 2026).
--
-- 1) «ضمان أول حصة» (first-lesson guarantee)
--    After the first completed lesson between a student (the customer, or one of
--    their children) and a tutor, the customer has a window (default 24 hours) to
--    say the lesson was not a good fit. The price they actually paid for that
--    lesson goes back to their Famy wallet. Famy carries the cost: the payment
--    stays captured and the tutor keeps their share.
--      * once per customer per tutor (whichever child), ever;
--      * at most N claims per customer in any 30 days (default 2);
--      * the amount is LEAST(lesson price, money still held on the payment),
--        using payment_held_after_card_refund (#550/#572), so it can never pay
--        back money already returned to the card or refunded to the wallet;
--      * blocked while a Paymob refund of unknown amount, a Paymob money flag or
--        an online issue report is open;
--      * cash lessons count once the cash payment is captured (the tutor
--        collected it); Famy pays the refund from its own share.
--    Admin can reverse a claim (the credit is debited back, never below zero).
--
-- 2) Lower commission for new tutors
--    For duration_days (default 30) from GREATEST(first approval, offer start),
--    bookings of covered categories (default tutoring, quran, music) are created
--    with the launch commission (default: half of today's commission per mode),
--    never above the regular commission. The booking snapshots the commission it
--    used, so later setting changes never alter existing bookings.
--
-- Settings live in public.settings (public read, admin write, validated by
-- trigger): 'first_lesson_guarantee' and 'launch_commission'.
-- New functions are SECURITY DEFINER with search_path pinned. Internal helpers are
-- service_role only. Existing money functions are not redefined.

-- ---------------------------------------------------------------------------
-- Wallet reasons: superset of 20261126170000_admin_wallet_ops
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_wallet_entries
  DROP CONSTRAINT IF EXISTS customer_wallet_entries_reason_check;
ALTER TABLE public.customer_wallet_entries
  ADD CONSTRAINT customer_wallet_entries_reason_check CHECK (reason IN (
    'provider_cancelled',
    'customer_cancelled_refund',
    'admin_credit',
    'admin_debit',
    'checkout_spend',
    'checkout_release',
    'paymob_superseded_capture',
    'forfeited_on_deletion',
    'online_no_show_refund',
    'admin_lesson_refund',
    'first_lesson_guarantee',
    'first_lesson_guarantee_reversal'
  ));

-- ---------------------------------------------------------------------------
-- Settings: defaults and validation
-- ---------------------------------------------------------------------------
INSERT INTO public.settings (key, value)
VALUES (
  'first_lesson_guarantee',
  jsonb_build_object(
    'enabled', true,
    'window_hours', 24,
    'max_per_30_days', 2,
    'category_slugs', jsonb_build_array('tutoring', 'quran', 'music')
  )
)
ON CONFLICT (key) DO NOTHING;

-- Half of today's commission per mode (rounded to 2 decimals). A mode with no
-- commission configured stays null, so the offer does nothing there.
INSERT INTO public.settings (key, value)
SELECT
  'launch_commission',
  jsonb_build_object(
    'enabled', true,
    'percent_in_person',
      CASE WHEN b.in_person IS NULL THEN NULL ELSE round(b.in_person / 2.0, 2) END,
    'percent_online',
      CASE WHEN b.online IS NULL THEN NULL ELSE round(b.online / 2.0, 2) END,
    'duration_days', 30,
    'starts_at', to_jsonb(now()),
    'category_slugs', jsonb_build_array('tutoring', 'quran', 'music')
  )
FROM (
  SELECT
    NULLIF(s.value->>'commission_percent', '')::numeric AS in_person,
    COALESCE(
      NULLIF(s.value->>'commission_percent_online', '')::numeric,
      NULLIF(s.value->>'commission_percent', '')::numeric
    ) AS online
  FROM (SELECT (SELECT value FROM public.settings WHERE key = 'billing') AS value) s
) b
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.tg_validate_launch_offer_settings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v jsonb := NEW.value;
  v_num numeric;
  v_key text;
  v_slug jsonb;
BEGIN
  IF NEW.key NOT IN ('first_lesson_guarantee', 'launch_commission') THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'LAUNCH_OFFER_INVALID: % must be an object.', NEW.key USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(v->'enabled') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'LAUNCH_OFFER_INVALID: enabled must be true or false.' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(v->'category_slugs') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v->'category_slugs') = 0 THEN
    RAISE EXCEPTION 'LAUNCH_OFFER_INVALID: category_slugs must be a non-empty list.' USING ERRCODE = '23514';
  END IF;
  FOR v_slug IN SELECT * FROM jsonb_array_elements(v->'category_slugs') LOOP
    IF jsonb_typeof(v_slug) IS DISTINCT FROM 'string' OR btrim(v_slug #>> '{}') = '' THEN
      RAISE EXCEPTION 'LAUNCH_OFFER_INVALID: category_slugs must hold category slugs.' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF NEW.key = 'first_lesson_guarantee' THEN
    IF jsonb_typeof(v->'window_hours') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'LAUNCH_OFFER_INVALID: window_hours must be a whole number from 1 to 168.' USING ERRCODE = '23514';
    END IF;
    v_num := (v->>'window_hours')::numeric;
    IF v_num <> trunc(v_num) OR v_num < 1 OR v_num > 168 THEN
      RAISE EXCEPTION 'LAUNCH_OFFER_INVALID: window_hours must be a whole number from 1 to 168.' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(v->'max_per_30_days') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'LAUNCH_OFFER_INVALID: max_per_30_days must be a whole number from 1 to 10.' USING ERRCODE = '23514';
    END IF;
    v_num := (v->>'max_per_30_days')::numeric;
    IF v_num <> trunc(v_num) OR v_num < 1 OR v_num > 10 THEN
      RAISE EXCEPTION 'LAUNCH_OFFER_INVALID: max_per_30_days must be a whole number from 1 to 10.' USING ERRCODE = '23514';
    END IF;
  ELSE
    FOREACH v_key IN ARRAY ARRAY['percent_in_person', 'percent_online'] LOOP
      IF v->v_key IS NULL OR v->v_key = 'null'::jsonb THEN
        CONTINUE;
      END IF;
      IF jsonb_typeof(v->v_key) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'LAUNCH_OFFER_INVALID: % must be empty or a number from 0 to 50 with at most 2 decimals.', v_key
          USING ERRCODE = '23514';
      END IF;
      v_num := (v->>v_key)::numeric;
      IF v_num < 0 OR v_num > 50 OR v_num <> round(v_num, 2) THEN
        RAISE EXCEPTION 'LAUNCH_OFFER_INVALID: % must be empty or a number from 0 to 50 with at most 2 decimals.', v_key
          USING ERRCODE = '23514';
      END IF;
    END LOOP;
    IF jsonb_typeof(v->'duration_days') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'LAUNCH_OFFER_INVALID: duration_days must be a whole number from 1 to 365.' USING ERRCODE = '23514';
    END IF;
    v_num := (v->>'duration_days')::numeric;
    IF v_num <> trunc(v_num) OR v_num < 1 OR v_num > 365 THEN
      RAISE EXCEPTION 'LAUNCH_OFFER_INVALID: duration_days must be a whole number from 1 to 365.' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(v->'starts_at') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'LAUNCH_OFFER_INVALID: starts_at must be a date and time.' USING ERRCODE = '23514';
    END IF;
    BEGIN
      PERFORM (v->>'starts_at')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'LAUNCH_OFFER_INVALID: starts_at must be a date and time.' USING ERRCODE = '23514';
    END;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_validate_launch_offer_settings() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validate_launch_offer_settings ON public.settings;
CREATE TRIGGER trg_validate_launch_offer_settings
  BEFORE INSERT OR UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_launch_offer_settings();

-- ---------------------------------------------------------------------------
-- 2) Launch commission
-- ---------------------------------------------------------------------------
-- What the regular commission would have been, set only when the launch
-- commission was applied (null otherwise). Written by the BEFORE INSERT trigger
-- below and never changed afterwards.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS price_commission_regular_percent numeric(5,2) NULL;
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_price_commission_regular_percent_nonneg;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_price_commission_regular_percent_nonneg
    CHECK (price_commission_regular_percent IS NULL OR price_commission_regular_percent >= 0);
REVOKE INSERT (price_commission_regular_percent) ON public.bookings FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (price_commission_regular_percent) ON public.bookings FROM PUBLIC, anon, authenticated;

-- First approval of a provider: the earliest 'APPROVED' onboarding event; an
-- approved provider without events (approved before events existed) falls back
-- to its creation time. Null when the provider is not approved.
CREATE OR REPLACE FUNCTION public.provider_first_approved_at(p_provider_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p.onboarding_status::text = 'APPROVED' THEN COALESCE(
      (
        SELECT min(e.created_at)
        FROM public.provider_onboarding_events e
        WHERE e.provider_id = p.id AND e.new_status::text = 'APPROVED'
      ),
      p.created_at
    )
    ELSE NULL
  END
  FROM public.providers p
  WHERE p.id = p_provider_id;
$$;
REVOKE ALL ON FUNCTION public.provider_first_approved_at(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_first_approved_at(uuid) TO service_role;

-- The launch-offer window of a provider: [GREATEST(approval, offer start),
-- + duration_days). Null when the offer is off or the provider is not approved.
CREATE OR REPLACE FUNCTION public.launch_commission_window(p_provider_id uuid)
RETURNS TABLE (starts_at timestamptz, ends_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg jsonb;
  v_approved timestamptz;
  v_start timestamptz;
BEGIN
  SELECT s.value INTO v_cfg FROM public.settings s WHERE s.key = 'launch_commission';
  IF v_cfg IS NULL OR NOT COALESCE((v_cfg->>'enabled')::boolean, false) THEN
    RETURN;
  END IF;
  v_approved := public.provider_first_approved_at(p_provider_id);
  IF v_approved IS NULL THEN
    RETURN;
  END IF;
  v_start := GREATEST(v_approved, (v_cfg->>'starts_at')::timestamptz);
  starts_at := v_start;
  ends_at := v_start + make_interval(days => (v_cfg->>'duration_days')::int);
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.launch_commission_window(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.launch_commission_window(uuid) TO service_role;

-- Launch commission percent for a booking created at p_at, or null when the
-- offer does not apply (off, category not covered, outside the window, or no
-- launch percent for that mode). The caller still caps it at the regular rate.
CREATE OR REPLACE FUNCTION public.launch_commission_percent_internal(
  p_provider_id uuid,
  p_service_id uuid,
  p_mode text,
  p_at timestamptz
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg jsonb;
  v_slug text;
  v_win record;
  v_pct text;
BEGIN
  SELECT s.value INTO v_cfg FROM public.settings s WHERE s.key = 'launch_commission';
  IF v_cfg IS NULL OR NOT COALESCE((v_cfg->>'enabled')::boolean, false) THEN
    RETURN NULL;
  END IF;

  SELECT c.slug INTO v_slug
  FROM public.services sv JOIN public.categories c ON c.id = sv.category_id
  WHERE sv.id = p_service_id;
  IF v_slug IS NULL OR NOT (v_cfg->'category_slugs') ? v_slug THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_win FROM public.launch_commission_window(p_provider_id);
  IF v_win.starts_at IS NULL OR p_at < v_win.starts_at OR p_at >= v_win.ends_at THEN
    RETURN NULL;
  END IF;

  v_pct := CASE WHEN p_mode = 'online' THEN v_cfg->>'percent_online' ELSE v_cfg->>'percent_in_person' END;
  RETURN NULLIF(v_pct, '')::numeric;
END;
$$;
REVOKE ALL ON FUNCTION public.launch_commission_percent_internal(uuid, uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.launch_commission_percent_internal(uuid, uuid, text, timestamptz)
  TO service_role;

-- Runs after trg_validate_booking_service and trg_validate_fixed_package_booking
-- (BEFORE INSERT triggers fire in name order), so the regular commission
-- snapshot is already on NEW. Only lowers it, never raises it.
CREATE OR REPLACE FUNCTION public.tg_apply_launch_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_launch numeric;
  v_base numeric;
  v_travel numeric := COALESCE(NEW.price_travel_fee, 0);
BEGIN
  NEW.price_commission_regular_percent := NULL;

  IF NEW.price_commission_percent IS NULL
     OR NEW.price_commission_amount IS NULL
     OR NEW.price_provider_net IS NULL THEN
    RETURN NEW;
  END IF;

  v_launch := public.launch_commission_percent_internal(
    NEW.provider_id, NEW.service_id, COALESCE(NEW.service_mode, 'in_person'), now()
  );
  IF v_launch IS NULL OR v_launch >= NEW.price_commission_percent THEN
    RETURN NEW;
  END IF;

  -- Same base as tg_validate_booking_service: subtotal + extras.
  v_base := NEW.price_provider_net + NEW.price_commission_amount - v_travel;
  NEW.price_commission_regular_percent := NEW.price_commission_percent;
  NEW.price_commission_percent := v_launch;
  NEW.price_commission_amount := ROUND(v_base * v_launch / 100.0, 2);
  NEW.price_provider_net := v_base + v_travel - NEW.price_commission_amount;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_apply_launch_commission() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validate_launch_commission ON public.bookings;
CREATE TRIGGER trg_validate_launch_commission
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_apply_launch_commission();

-- The snapshot never changes after creation (the commission columns themselves
-- are already locked by tg_validate_booking_transition).
CREATE OR REPLACE FUNCTION public.tg_lock_commission_regular_percent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.price_commission_regular_percent := OLD.price_commission_regular_percent;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_lock_commission_regular_percent() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lock_commission_regular_percent ON public.bookings;
CREATE TRIGGER trg_lock_commission_regular_percent
  BEFORE UPDATE OF price_commission_regular_percent ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_lock_commission_regular_percent();

-- Provider app / web: is my lower commission active, and until when?
CREATE OR REPLACE FUNCTION public.my_launch_commission()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider uuid;
  v_cfg jsonb;
  v_billing jsonb;
  v_win record;
  v_regular_in numeric;
  v_regular_on numeric;
  v_launch_in numeric;
  v_launch_on numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  SELECT p.id INTO v_provider FROM public.providers p WHERE p.profile_id = v_uid;
  IF v_provider IS NULL THEN
    RETURN jsonb_build_object('active', false);
  END IF;

  SELECT * INTO v_win FROM public.launch_commission_window(v_provider);
  IF v_win.starts_at IS NULL OR now() < v_win.starts_at OR now() >= v_win.ends_at THEN
    RETURN jsonb_build_object('active', false);
  END IF;

  SELECT s.value INTO v_cfg FROM public.settings s WHERE s.key = 'launch_commission';
  SELECT s.value INTO v_billing FROM public.settings s WHERE s.key = 'billing';

  -- Only tutors offering a covered section (e.g. not a babysitter) see it.
  IF NOT EXISTS (
    SELECT 1
    FROM public.provider_services ps
    JOIN public.services sv ON sv.id = ps.service_id
    JOIN public.categories c ON c.id = sv.category_id
    WHERE ps.provider_id = v_provider
      AND ps.status = 'approved'
      AND (v_cfg->'category_slugs') ? c.slug
  ) THEN
    RETURN jsonb_build_object('active', false);
  END IF;
  v_regular_in := NULLIF(v_billing->>'commission_percent', '')::numeric;
  v_regular_on := COALESCE(NULLIF(v_billing->>'commission_percent_online', '')::numeric, v_regular_in);
  -- A mode counts only when it has both a launch and a regular rate and the
  -- launch rate is lower (LEAST would ignore a null, so compare explicitly).
  v_launch_in := NULLIF(v_cfg->>'percent_in_person', '')::numeric;
  v_launch_on := NULLIF(v_cfg->>'percent_online', '')::numeric;
  IF v_launch_in IS NULL OR v_regular_in IS NULL OR v_launch_in >= v_regular_in THEN
    v_launch_in := NULL;
  END IF;
  IF v_launch_on IS NULL OR v_regular_on IS NULL OR v_launch_on >= v_regular_on THEN
    v_launch_on := NULL;
  END IF;

  IF v_launch_in IS NULL AND v_launch_on IS NULL THEN
    RETURN jsonb_build_object('active', false);
  END IF;

  RETURN jsonb_build_object(
    'active', true,
    'starts_at', v_win.starts_at,
    'ends_at', v_win.ends_at,
    'percent_in_person', v_launch_in,
    'percent_online', v_launch_on,
    'regular_in_person', v_regular_in,
    'regular_online', v_regular_on,
    'category_slugs', v_cfg->'category_slugs'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.my_launch_commission() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_launch_commission() TO authenticated;

-- ---------------------------------------------------------------------------
-- 1) First-lesson guarantee
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.first_lesson_guarantee_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE RESTRICT,
  family_member_id uuid NULL,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  wallet_entry_id uuid NOT NULL REFERENCES public.customer_wallet_entries(id) ON DELETE RESTRICT,
  feedback text NULL CHECK (feedback IS NULL OR char_length(feedback) <= 500),
  status text NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed', 'reversed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz NULL,
  reversed_by uuid NULL,
  reverse_note text NULL,
  reversal_wallet_entry_id uuid NULL REFERENCES public.customer_wallet_entries(id) ON DELETE RESTRICT,
  CONSTRAINT first_lesson_guarantee_claims_booking_key UNIQUE (booking_id),
  -- Once per customer per tutor, whichever child, even after a reversal.
  CONSTRAINT first_lesson_guarantee_claims_customer_provider_key UNIQUE (customer_id, provider_id),
  CONSTRAINT first_lesson_guarantee_claims_reversal_shape CHECK (
    (status = 'claimed' AND reversed_at IS NULL AND reversal_wallet_entry_id IS NULL)
    OR (status = 'reversed' AND reversed_at IS NOT NULL AND reversal_wallet_entry_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_first_lesson_guarantee_claims_customer_created
  ON public.first_lesson_guarantee_claims (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_first_lesson_guarantee_claims_provider
  ON public.first_lesson_guarantee_claims (provider_id);
CREATE INDEX IF NOT EXISTS idx_first_lesson_guarantee_claims_payment
  ON public.first_lesson_guarantee_claims (payment_id);
CREATE INDEX IF NOT EXISTS idx_first_lesson_guarantee_claims_wallet_entry
  ON public.first_lesson_guarantee_claims (wallet_entry_id);
CREATE INDEX IF NOT EXISTS idx_first_lesson_guarantee_claims_reversal_entry
  ON public.first_lesson_guarantee_claims (reversal_wallet_entry_id);

ALTER TABLE public.first_lesson_guarantee_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.first_lesson_guarantee_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.first_lesson_guarantee_claims TO authenticated;
GRANT ALL ON public.first_lesson_guarantee_claims TO service_role;

DROP POLICY IF EXISTS first_lesson_guarantee_claims_select ON public.first_lesson_guarantee_claims;
CREATE POLICY first_lesson_guarantee_claims_select ON public.first_lesson_guarantee_claims
  FOR SELECT TO authenticated
  USING (
    customer_id = (SELECT auth.uid())
    OR public.has_role((SELECT auth.uid()), 'admin')
  );

DROP TRIGGER IF EXISTS trg_audit_first_lesson_guarantee_claims ON public.first_lesson_guarantee_claims;
CREATE TRIGGER trg_audit_first_lesson_guarantee_claims
  AFTER INSERT OR UPDATE ON public.first_lesson_guarantee_claims
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

-- The payment that paid for a completed lesson: a captured card / wallet /
-- InstaPay payment, or a captured cash payment (collected by the tutor).
CREATE OR REPLACE FUNCTION public.first_lesson_guarantee_payment_id(p_booking_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
  FROM public.payments p
  WHERE p.booking_id = p_booking_id
    AND p.status IN ('captured', 'partially_refunded')
    AND COALESCE(p.payment_method_type, '') IN ('online', 'manual_transfer', 'cash')
  ORDER BY (p.status = 'captured') DESC, p.captured_at DESC NULLS LAST, p.created_at DESC
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.first_lesson_guarantee_payment_id(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.first_lesson_guarantee_payment_id(uuid) TO service_role;

-- Eligibility and amount for a booking, without side effects.
-- blocked codes: disabled, booking_not_found, not_completed, category_not_covered,
-- not_first_lesson, window_closed, already_claimed, tutor_already_used,
-- monthly_limit, no_payment, payment_not_settled, card_refund_unknown,
-- money_flag_open, issue_open, nothing_left.
CREATE OR REPLACE FUNCTION public.first_lesson_guarantee_terms(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg jsonb;
  v_b public.bookings%ROWTYPE;
  v_slug text;
  v_done_at timestamptz;
  v_expires timestamptz;
  v_pay public.payments%ROWTYPE;
  v_pay_id uuid;
  v_held numeric := 0;
  v_amount numeric := 0;
  v_blocked text;
  v_used int;
BEGIN
  SELECT s.value INTO v_cfg FROM public.settings s WHERE s.key = 'first_lesson_guarantee';

  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'blocked', 'booking_not_found');
  END IF;

  v_done_at := COALESCE(v_b.completed_at, v_b.end_at);
  IF v_cfg IS NOT NULL THEN
    v_expires := v_done_at + make_interval(hours => (v_cfg->>'window_hours')::int);
  END IF;

  SELECT c.slug INTO v_slug
  FROM public.services sv JOIN public.categories c ON c.id = sv.category_id
  WHERE sv.id = v_b.service_id;

  IF EXISTS (SELECT 1 FROM public.first_lesson_guarantee_claims g WHERE g.booking_id = v_b.id) THEN
    v_blocked := 'already_claimed';
  ELSIF v_cfg IS NULL OR NOT COALESCE((v_cfg->>'enabled')::boolean, false) THEN
    v_blocked := 'disabled';
  ELSIF v_b.status IS DISTINCT FROM 'completed' THEN
    v_blocked := 'not_completed';
  ELSIF v_slug IS NULL OR NOT (v_cfg->'category_slugs') ? v_slug THEN
    v_blocked := 'category_not_covered';
  ELSIF EXISTS (
    SELECT 1 FROM public.bookings ob
    WHERE ob.customer_id = v_b.customer_id
      AND ob.provider_id = v_b.provider_id
      AND ob.family_member_id IS NOT DISTINCT FROM v_b.family_member_id
      AND ob.status = 'completed'
      AND ob.id <> v_b.id
      AND (COALESCE(ob.completed_at, ob.end_at), ob.created_at, ob.id)
          < (v_done_at, v_b.created_at, v_b.id)
  ) THEN
    v_blocked := 'not_first_lesson';
  ELSIF now() > v_expires THEN
    v_blocked := 'window_closed';
  ELSIF EXISTS (
    SELECT 1 FROM public.first_lesson_guarantee_claims g
    WHERE g.customer_id = v_b.customer_id AND g.provider_id = v_b.provider_id
  ) THEN
    v_blocked := 'tutor_already_used';
  ELSE
    SELECT count(*) INTO v_used
    FROM public.first_lesson_guarantee_claims g
    WHERE g.customer_id = v_b.customer_id
      AND g.created_at > now() - interval '30 days';
    IF v_used >= (v_cfg->>'max_per_30_days')::int THEN
      v_blocked := 'monthly_limit';
    END IF;
  END IF;

  IF v_blocked IS NULL THEN
    v_pay_id := public.first_lesson_guarantee_payment_id(v_b.id);
    IF v_pay_id IS NULL THEN
      v_blocked := CASE
        WHEN EXISTS (
          SELECT 1 FROM public.payments p
          WHERE p.booking_id = v_b.id AND p.status IN ('pending', 'pending_review')
        ) THEN 'payment_not_settled'
        ELSE 'no_payment'
      END;
    ELSE
      SELECT * INTO v_pay FROM public.payments WHERE id = v_pay_id;
      v_held := public.payment_held_after_card_refund(v_pay);
      v_amount := LEAST(GREATEST(COALESCE(v_b.price_total, 0), 0), v_held);
      IF public.payment_gateway_refund_unknown(v_pay) THEN
        v_blocked := 'card_refund_unknown';
      ELSIF public.booking_paymob_money_flag_open(v_b.id) THEN
        v_blocked := 'money_flag_open';
      ELSIF EXISTS (
        SELECT 1 FROM public.online_lesson_issue_reports r
        WHERE r.booking_id = v_b.id AND r.status = 'open'
      ) THEN
        v_blocked := 'issue_open';
      ELSIF v_amount <= 0 THEN
        v_blocked := 'nothing_left';
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'eligible', v_blocked IS NULL,
    'blocked', v_blocked,
    'booking_id', v_b.id,
    'customer_id', v_b.customer_id,
    'provider_id', v_b.provider_id,
    'payment_id', v_pay_id,
    'payment_method_type', v_pay.payment_method_type,
    'amount', CASE WHEN v_blocked IS NULL THEN round(v_amount, 2) ELSE 0 END,
    'expires_at', v_expires
  );
END;
$$;
REVOKE ALL ON FUNCTION public.first_lesson_guarantee_terms(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.first_lesson_guarantee_terms(uuid) TO service_role;

-- Customer (or admin): can this lesson use the guarantee, and was it used?
CREATE OR REPLACE FUNCTION public.first_lesson_guarantee_status(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_customer uuid;
  v_terms jsonb;
  v_claim public.first_lesson_guarantee_claims%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  SELECT b.customer_id INTO v_customer FROM public.bookings b WHERE b.id = p_booking_id;
  IF v_customer IS NULL OR (v_customer <> v_uid AND NOT public.has_role(v_uid, 'admin')) THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002';
  END IF;

  v_terms := public.first_lesson_guarantee_terms(p_booking_id);
  SELECT * INTO v_claim FROM public.first_lesson_guarantee_claims g WHERE g.booking_id = p_booking_id;

  RETURN jsonb_build_object(
    'eligible', (v_terms->>'eligible')::boolean,
    'blocked', v_terms->>'blocked',
    'amount', (v_terms->>'amount')::numeric,
    'expires_at', v_terms->'expires_at',
    'claim', CASE WHEN v_claim.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_claim.id,
      'amount', v_claim.amount,
      'status', v_claim.status,
      'created_at', v_claim.created_at,
      'reversed_at', v_claim.reversed_at
    ) END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.first_lesson_guarantee_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.first_lesson_guarantee_status(uuid) TO authenticated;

-- Customer: «الحصة مكانتش مناسبة». Idempotent per booking.
CREATE OR REPLACE FUNCTION public.claim_first_lesson_guarantee(
  p_booking_id uuid,
  p_feedback text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_b public.bookings%ROWTYPE;
  v_existing public.first_lesson_guarantee_claims%ROWTYPE;
  v_terms jsonb;
  v_pay public.payments%ROWTYPE;
  v_amount numeric;
  v_key text;
  v_entry_id uuid;
  v_claim_id uuid;
  v_already numeric;
  v_feedback text := NULLIF(btrim(COALESCE(p_feedback, '')), '');
  v_amount_txt text;
  v_service_ar text;
  v_service_en text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF v_feedback IS NOT NULL AND char_length(v_feedback) > 500 THEN
    v_feedback := left(v_feedback, 500);
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_b.customer_id <> v_uid THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Same lock order as every wallet refund path: debts, wallet, payment.
  PERFORM public.lock_customer_debts(v_b.customer_id);
  PERFORM public.lock_customer_wallet(v_b.customer_id);

  SELECT * INTO v_existing FROM public.first_lesson_guarantee_claims g WHERE g.booking_id = p_booking_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'claim_id', v_existing.id,
      'amount', v_existing.amount,
      'wallet_entry_id', v_existing.wallet_entry_id,
      'replayed', true
    );
  END IF;

  v_terms := public.first_lesson_guarantee_terms(p_booking_id);
  IF v_terms->>'blocked' IS NOT NULL THEN
    RAISE EXCEPTION 'GUARANTEE_BLOCKED:%', v_terms->>'blocked' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_pay FROM public.payments WHERE id = (v_terms->>'payment_id')::uuid FOR UPDATE;
  -- Re-read the terms now that the payment row is locked.
  v_terms := public.first_lesson_guarantee_terms(p_booking_id);
  IF v_terms->>'blocked' IS NOT NULL OR (v_terms->>'payment_id')::uuid IS DISTINCT FROM v_pay.id THEN
    RAISE EXCEPTION 'GUARANTEE_BLOCKED:%', COALESCE(v_terms->>'blocked', 'changed') USING ERRCODE = '23514';
  END IF;
  v_amount := (v_terms->>'amount')::numeric;

  v_key := 'first_lesson_guarantee:' || p_booking_id::text;
  v_entry_id := public.customer_wallet_insert_entry(
    v_b.customer_id,
    'credit',
    v_amount,
    'first_lesson_guarantee',
    v_b.id,
    v_pay.id,
    NULL,
    v_key,
    jsonb_build_object(
      'note', 'ضمان أول حصة',
      'admin_reason', 'ضمان أول حصة',
      'feedback', v_feedback,
      'provider_id', v_b.provider_id,
      'payment_method_type', v_pay.payment_method_type
    )
  );

  INSERT INTO public.first_lesson_guarantee_claims (
    booking_id, customer_id, provider_id, family_member_id, payment_id, amount,
    wallet_entry_id, feedback
  ) VALUES (
    v_b.id, v_b.customer_id, v_b.provider_id, v_b.family_member_id, v_pay.id, v_amount,
    v_entry_id, v_feedback
  )
  RETURNING id INTO v_claim_id;

  -- The payment stays captured: the tutor's share and the ledger are untouched.
  -- The refunded total is tracked on the payment so every later refund (admin
  -- or automatic) starts from what is still held.
  PERFORM set_config('app.audit_reason', 'First lesson guarantee', true);
  PERFORM set_config('app.wallet_checkout_adjust', 'on', true);
  PERFORM set_config('app.ledger_internal_capture', 'on', true);
  v_already := COALESCE(NULLIF(v_pay.metadata->>'wallet_refunded_total', '')::numeric, 0);
  UPDATE public.payments
  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'wallet_refunded_total', v_already + v_amount,
        'first_lesson_guarantee', jsonb_build_object(
          'claim_id', v_claim_id,
          'amount', v_amount,
          'wallet_entry_id', v_entry_id,
          'recorded_at', now()
        )
      )
  WHERE id = v_pay.id;
  PERFORM set_config('app.ledger_internal_capture', 'off', true);
  PERFORM set_config('app.wallet_checkout_adjust', 'off', true);

  SELECT s.name_ar, s.name_en INTO v_service_ar, v_service_en
  FROM public.services s WHERE s.id = v_b.service_id;
  v_amount_txt := trim(to_char(v_amount, 'FM999999990.##'));

  INSERT INTO public.notifications (
    user_id, type, category, title, body, title_en, title_ar, body_en, body_ar,
    payload, deep_link, booking_id
  ) VALUES (
    v_b.customer_id,
    'wallet_first_lesson_guarantee',
    'booking',
    'Lesson price back in your wallet',
    v_amount_txt || ' EGP for your first ' || COALESCE(v_service_en, 'lesson') || ' with this tutor is back in your Famy wallet.',
    'Lesson price back in your wallet',
    'رجعنالك فلوس الحصة في المحفظة',
    v_amount_txt || ' EGP for your first ' || COALESCE(v_service_en, 'lesson') || ' with this tutor is back in your Famy wallet.',
    'رجعنالك ' || v_amount_txt || ' ج.م في محفظتك من أول حصة مع المدرس، وتقدر تستخدمهم في أي حجز جاي',
    jsonb_build_object('wallet_entry_id', v_entry_id, 'amount', v_amount, 'booking_id', v_b.id, 'claim_id', v_claim_id),
    '/wallet',
    v_b.id
  );

  RETURN jsonb_build_object(
    'claim_id', v_claim_id,
    'amount', v_amount,
    'wallet_entry_id', v_entry_id,
    'replayed', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.claim_first_lesson_guarantee(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_first_lesson_guarantee(uuid, text) TO authenticated;

-- Admin: the claim on a booking (money card), or null.
CREATE OR REPLACE FUNCTION public.admin_first_lesson_guarantee_for_booking(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_claim public.first_lesson_guarantee_claims%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Admin required.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_claim FROM public.first_lesson_guarantee_claims g WHERE g.booking_id = p_booking_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'id', v_claim.id,
    'booking_id', v_claim.booking_id,
    'customer_id', v_claim.customer_id,
    'provider_id', v_claim.provider_id,
    'amount', v_claim.amount,
    'feedback', v_claim.feedback,
    'status', v_claim.status,
    'created_at', v_claim.created_at,
    'reversed_at', v_claim.reversed_at,
    'reverse_note', v_claim.reverse_note
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_first_lesson_guarantee_for_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_first_lesson_guarantee_for_booking(uuid) TO authenticated;

-- Admin: take a guarantee back. The credit is debited from the wallet (never
-- below zero) and the payment's refunded total goes back down. The customer
-- cannot claim with this tutor again.
CREATE OR REPLACE FUNCTION public.admin_reverse_first_lesson_guarantee(
  p_claim_id uuid,
  p_note text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_claim public.first_lesson_guarantee_claims%ROWTYPE;
  v_pay public.payments%ROWTYPE;
  v_key text;
  v_entry_id uuid;
  v_balance numeric;
  v_already numeric;
  v_amount_txt text;
BEGIN
  IF v_admin IS NULL OR NOT public.has_role(v_admin, 'admin') THEN
    RAISE EXCEPTION 'Admin required.' USING ERRCODE = '42501';
  END IF;
  IF v_note IS NULL THEN
    RAISE EXCEPTION 'WALLET_REASON_REQUIRED: A reason is required.' USING ERRCODE = '23514';
  END IF;
  IF NULLIF(btrim(COALESCE(p_idempotency_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'WALLET_IDEMPOTENCY_KEY_REQUIRED: An idempotency key is required.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_claim FROM public.first_lesson_guarantee_claims g WHERE g.id = p_claim_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Claim not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.lock_customer_debts(v_claim.customer_id);
  PERFORM public.lock_customer_wallet(v_claim.customer_id);

  SELECT * INTO v_claim FROM public.first_lesson_guarantee_claims g WHERE g.id = p_claim_id FOR UPDATE;
  v_key := 'first_lesson_guarantee_reversal:' || v_claim.id::text;
  IF v_claim.status = 'reversed' THEN
    RETURN jsonb_build_object(
      'claim_id', v_claim.id,
      'wallet_entry_id', v_claim.reversal_wallet_entry_id,
      'amount', v_claim.amount,
      'replayed', true
    );
  END IF;

  SELECT * INTO v_pay FROM public.payments WHERE id = v_claim.payment_id FOR UPDATE;

  v_balance := public.customer_wallet_balance_internal(v_claim.customer_id);
  IF v_balance < v_claim.amount THEN
    RAISE EXCEPTION 'WALLET_BALANCE_TOO_LOW: The wallet has % only.', v_balance USING ERRCODE = '23514';
  END IF;

  v_entry_id := public.customer_wallet_insert_entry(
    v_claim.customer_id,
    'debit',
    v_claim.amount,
    'first_lesson_guarantee_reversal',
    v_claim.booking_id,
    v_claim.payment_id,
    v_admin,
    v_key,
    jsonb_build_object(
      'admin_reason', v_note,
      'note', v_note,
      'claim_id', v_claim.id,
      'idempotency_key', btrim(p_idempotency_key)
    )
  );

  UPDATE public.first_lesson_guarantee_claims
  SET status = 'reversed',
      reversed_at = now(),
      reversed_by = v_admin,
      reverse_note = v_note,
      reversal_wallet_entry_id = v_entry_id
  WHERE id = v_claim.id;

  PERFORM set_config('app.audit_reason', 'First lesson guarantee reversed: ' || v_note, true);
  PERFORM set_config('app.wallet_checkout_adjust', 'on', true);
  PERFORM set_config('app.ledger_internal_capture', 'on', true);
  v_already := COALESCE(NULLIF(v_pay.metadata->>'wallet_refunded_total', '')::numeric, 0);
  UPDATE public.payments
  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'wallet_refunded_total', GREATEST(v_already - v_claim.amount, 0),
        'first_lesson_guarantee', COALESCE(metadata->'first_lesson_guarantee', '{}'::jsonb)
          || jsonb_build_object('reversed_at', now(), 'reversal_wallet_entry_id', v_entry_id)
      )
  WHERE id = v_pay.id;
  PERFORM set_config('app.ledger_internal_capture', 'off', true);
  PERFORM set_config('app.wallet_checkout_adjust', 'off', true);

  v_amount_txt := trim(to_char(v_claim.amount, 'FM999999990.##'));
  INSERT INTO public.notifications (
    user_id, type, category, title, body, title_en, title_ar, body_en, body_ar,
    payload, deep_link, booking_id
  ) VALUES (
    v_claim.customer_id,
    'wallet_first_lesson_guarantee_reversed',
    'booking',
    'Wallet update',
    v_amount_txt || ' EGP was deducted from your wallet. Reason: ' || v_note,
    'Wallet update',
    'تعديل في المحفظة',
    v_amount_txt || ' EGP was deducted from your wallet. Reason: ' || v_note,
    'اتخصم ' || v_amount_txt || ' ج.م من محفظتك. السبب: ' || v_note,
    jsonb_build_object('wallet_entry_id', v_entry_id, 'amount', v_claim.amount, 'booking_id', v_claim.booking_id),
    '/wallet',
    v_claim.booking_id
  );

  RETURN jsonb_build_object(
    'claim_id', v_claim.id,
    'wallet_entry_id', v_entry_id,
    'amount', v_claim.amount,
    'replayed', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_reverse_first_lesson_guarantee(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reverse_first_lesson_guarantee(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
