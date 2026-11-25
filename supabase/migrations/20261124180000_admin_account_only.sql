-- Admin accounts are admin-only: block provider/customer/booking/wallet activity.
-- Resolves #413. Idempotent, single transaction (no nested BEGIN/COMMIT).

DO $$
DECLARE
  v_conflicts integer;
BEGIN
  SELECT count(*)::integer INTO v_conflicts
  FROM public.user_roles admin_role
  WHERE admin_role.role = 'admin'::public.app_role
    AND (
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = admin_role.user_id
          AND ur.role IN ('customer', 'provider')
      )
      OR EXISTS (
        SELECT 1 FROM public.providers p WHERE p.profile_id = admin_role.user_id
      )
      OR EXISTS (
        SELECT 1 FROM public.bookings b WHERE b.customer_id = admin_role.user_id
      )
    );
  IF v_conflicts > 0 THEN
    RAISE EXCEPTION
      'admin_account_only_preflight: % existing admin account(s) conflict with admin-only policy',
      v_conflicts
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin_account(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.role = 'admin'::public.app_role
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_account(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.raise_if_admin_account(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin_account(p_user_id) THEN
    RAISE EXCEPTION 'admin_account_restricted' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.raise_if_admin_account(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lock_user_identity(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
  RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('identity:' || p_user_id::text));
END;
$$;

REVOKE ALL ON FUNCTION public.lock_user_identity(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_reject_admin_provider_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.lock_user_identity(NEW.profile_id);
    IF public.is_admin_account(NEW.profile_id) THEN
      RAISE EXCEPTION 'admin_account_restricted' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_reject_admin_provider_row() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_reject_admin_provider_row ON public.providers;
CREATE TRIGGER trg_reject_admin_provider_row
  BEFORE INSERT OR UPDATE ON public.providers
  FOR EACH ROW EXECUTE FUNCTION public.tg_reject_admin_provider_row();

CREATE OR REPLACE FUNCTION public.tg_reject_admin_booking_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND public.is_admin_account(NEW.customer_id) THEN
    RAISE EXCEPTION 'admin_account_restricted' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.customer_id IS DISTINCT FROM OLD.customer_id
     AND public.is_admin_account(NEW.customer_id) THEN
    RAISE EXCEPTION 'admin_account_restricted' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_reject_admin_booking_customer() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_reject_admin_booking_customer ON public.bookings;
CREATE TRIGGER trg_reject_admin_booking_customer
  BEFORE INSERT OR UPDATE OF customer_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_reject_admin_booking_customer();

DROP TRIGGER IF EXISTS enforce_role_exclusivity_trigger ON public.user_roles;
CREATE OR REPLACE FUNCTION public.enforce_role_exclusivity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_other public.app_role;
BEGIN
  IF TG_OP = 'DELETE' AND auth.uid() IS NULL THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.user_id, NEW.role) IS DISTINCT FROM (OLD.user_id, OLD.role) THEN
    RAISE EXCEPTION 'Identity role assignments are immutable' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.lock_user_identity(NEW.user_id);
  IF NEW.role = 'admin' THEN
    IF EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = NEW.user_id AND ur.role IN ('customer', 'provider')
    ) THEN
      RAISE EXCEPTION 'admin_account_restricted' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.providers p WHERE p.profile_id = NEW.user_id) THEN
      RAISE EXCEPTION 'admin_account_restricted' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.bookings b WHERE b.customer_id = NEW.user_id) THEN
      RAISE EXCEPTION 'admin_account_restricted' USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.role IN ('customer', 'provider') THEN
    IF public.is_admin_account(NEW.user_id) THEN
      RAISE EXCEPTION 'admin_account_restricted' USING ERRCODE = 'P0001';
    END IF;
    v_other := CASE WHEN NEW.role = 'customer' THEN 'provider'::public.app_role ELSE 'customer'::public.app_role END;
    IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.user_id AND role = v_other) THEN
      RAISE EXCEPTION 'Customer and Provider identities are mutually exclusive' USING ERRCODE = '23514';
    END IF;
  END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_role_exclusivity() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enforce_role_exclusivity_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_role_exclusivity();


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
  p_supervision_mode text DEFAULT NULL,
  p_service_mode text DEFAULT 'in_person'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mode text := COALESCE(NULLIF(btrim(p_service_mode), ''), 'in_person');
  v_address uuid;
  v_fingerprint text;
  v_existing RECORD;
  v_booking_id uuid;
  v_created boolean := false;
  v_min_hours_before_start numeric;
  v_provider_min_notice integer;
  v_required_hours numeric;
  v_category_slug text;
  v_age integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '42501';
  END IF;
  IF public.is_admin_account(v_uid) THEN
    RAISE EXCEPTION 'admin_account_restricted' USING ERRCODE = 'P0001';
  END IF;
  IF public.is_not_suspended(v_uid) IS NOT TRUE THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Account is suspended.'
      USING ERRCODE = '42501';
  END IF;
  IF v_mode NOT IN ('in_person', 'online') THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Invalid service mode.'
      USING ERRCODE = '23514';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Idempotency key is required.'
      USING ERRCODE = '23514';
  END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Invalid booking time range.'
      USING ERRCODE = '23514';
  END IF;

  -- Online bookings never retain an unrelated address reference.
  v_address := CASE WHEN v_mode = 'online' THEN NULL ELSE p_address_id END;

  SELECT cat.slug INTO v_category_slug
  FROM public.services s
  JOIN public.categories cat ON cat.id = s.category_id
  WHERE s.id = p_service_id;

  IF v_mode = 'in_person' AND v_category_slug IN ('babysitting', 'tutoring') THEN
    IF p_supervision_mode IS NULL
       OR p_supervision_mode NOT IN ('cameras', 'adult_present') THEN
      RAISE EXCEPTION
        'BOOKING_SUPERVISION_REQUIRED: Choose how your child will be supervised during this service.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_mode = 'online' THEN
    v_age := public.booking_online_age_years(v_uid, p_family_member_id);
    IF v_age IS NULL THEN
      RAISE EXCEPTION
        'BOOKING_ONLINE_BIRTH_DATE_REQUIRED: Add a date of birth before booking an online lesson.'
        USING ERRCODE = '23514';
    ELSIF v_age < 12 THEN
      RAISE EXCEPTION
        'BOOKING_ONLINE_AGE_MINIMUM: Online lessons are available from age 12.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  v_fingerprint := public.booking_request_fingerprint(
    p_provider_id,
    p_service_id,
    v_address,
    p_start_at,
    p_end_at,
    p_family_member_id,
    p_notes,
    p_promo_code_id,
    coalesce(p_requirement_selections, '[]'::jsonb),
    p_teaching_capability_id,
    p_teaching_subject_code,
    p_teaching_curriculum_code,
    p_teaching_level_code,
    p_supervision_mode,
    v_mode
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':' || p_idempotency_key::text, 0)
  );

  SELECT id, request_fingerprint INTO v_existing
  FROM public.bookings
  WHERE customer_id = v_uid AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION
        'BOOKING_DUPLICATE_REQUEST_CONFLICT: Idempotency key reused with different booking details.'
        USING ERRCODE = '23514';
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
  FROM public.providers
  WHERE id = p_provider_id;

  v_required_hours := GREATEST(
    COALESCE(v_min_hours_before_start, 2),
    COALESCE(v_provider_min_notice, 0)::numeric
  );
  IF p_start_at < now() + (v_required_hours * interval '1 hour') THEN
    RAISE EXCEPTION
      'BOOKING_INVALID_BOOKING_REQUEST: This start time is too soon for the provider to respond in time.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.marketplace_eligibility_internal(
      p_provider_id, p_service_id, v_address, v_mode
    ) e
    WHERE e.is_eligible
  ) THEN
    RAISE EXCEPTION
      'BOOKING_PROVIDER_INELIGIBLE: Provider is not eligible for this service mode and address.'
      USING ERRCODE = '23514';
  END IF;

  IF public.provider_cash_debt_blocked(p_provider_id) THEN
    RAISE EXCEPTION
      'BOOKING_PROVIDER_SETTLEMENT_BLOCKED: Provider cannot receive new bookings until platform balance is settled.'
      USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.create_booking_in_progress', 'on', true);

  BEGIN
    INSERT INTO public.bookings (
      customer_id,
      provider_id,
      service_id,
      address_id,
      start_at,
      end_at,
      status,
      notes,
      family_member_id,
      requirement_selections,
      promo_code_id,
      price_subtotal,
      price_discount,
      price_total,
      price_platform_fee,
      price_vat,
      price_extras_total,
      price_travel_fee,
      idempotency_key,
      request_fingerprint,
      currency,
      teaching_capability_id,
      teaching_subject_code,
      teaching_curriculum_code,
      teaching_level_code,
      supervision_mode,
      service_mode
    ) VALUES (
      v_uid,
      p_provider_id,
      p_service_id,
      v_address,
      p_start_at,
      p_end_at,
      'pending',
      NULLIF(btrim(p_notes), ''),
      p_family_member_id,
      coalesce(p_requirement_selections, '[]'::jsonb),
      p_promo_code_id,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      p_idempotency_key,
      v_fingerprint,
      'EGP',
      p_teaching_capability_id,
      NULLIF(btrim(p_teaching_subject_code), ''),
      NULLIF(btrim(p_teaching_curriculum_code), ''),
      NULLIF(btrim(p_teaching_level_code), ''),
      p_supervision_mode,
      v_mode
    )
    RETURNING id INTO v_booking_id;
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
      RAISE EXCEPTION
        'BOOKING_DUPLICATE_REQUEST_CONFLICT: Concurrent duplicate booking request.'
        USING ERRCODE = '23514';
    WHEN exclusion_violation THEN
      RAISE EXCEPTION
        'BOOKING_SLOT_UNAVAILABLE: That time slot is no longer available.'
        USING ERRCODE = '23514';
    WHEN SQLSTATE '23514' THEN
      RAISE;
    WHEN SQLSTATE '42501' THEN
      RAISE;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'BOOKING_%' THEN
        RAISE;
      END IF;
      RAISE EXCEPTION
        'BOOKING_INVALID_BOOKING_REQUEST: Unable to create booking.'
        USING ERRCODE = '23514';
  END;

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'created', v_created,
    'idempotent_replay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_provider_profile(
  p_bio_en text,
  p_bio_ar text,
  p_years_experience integer,
  p_hourly_rate numeric,
  p_city text,
  p_languages text[]
)
RETURNS public.providers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.providers;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'provider') OR public.has_role(v_uid, 'customer') THEN
    RAISE EXCEPTION 'Provider identity required' USING ERRCODE = '42501';
  END IF;
  IF public.is_admin_account(v_uid) THEN
    RAISE EXCEPTION 'admin_account_restricted' USING ERRCODE = 'P0001';
  END IF;
  IF p_years_experience < 0 OR p_hourly_rate <= 0 OR NULLIF(btrim(p_city), '') IS NULL THEN
    RAISE EXCEPTION 'Valid provider experience, price, and city are required' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.onboarding_status_transition', '1', true);

  INSERT INTO public.providers (
    profile_id, bio_en, bio_ar, years_experience, hourly_rate, city,
    country, languages, is_active, is_verified, onboarding_status
  ) VALUES (
    v_uid, COALESCE(p_bio_en, ''), COALESCE(p_bio_ar, ''), p_years_experience,
    p_hourly_rate, btrim(p_city), 'EG', COALESCE(p_languages, ARRAY[]::text[]), true, false, 'DRAFT'
  ) RETURNING * INTO v_row;

  INSERT INTO public.provider_onboarding_details (provider_id) VALUES (v_row.id)
  ON CONFLICT (provider_id) DO NOTHING;

  PERFORM public.log_provider_onboarding_event(
    v_row.id, v_uid, 'provider', 'onboarding_started', NULL, 'DRAFT', '{}'::jsonb
  );

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_apply_wallet_at_checkout(
  p_payment_id uuid,
  p_customer_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pay public.payments%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_due numeric;
  v_available numeric;
  v_spend numeric;
  v_card numeric;
  v_key text;
  v_entry_id uuid;
  v_existing jsonb;
BEGIN
  IF v_uid IS NULL THEN
    IF p_customer_id IS NULL THEN
      RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;
    IF current_setting('role', true) <> 'service_role' THEN
      RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;
    v_uid := p_customer_id;
  END IF;

  IF public.is_admin_account(v_uid) THEN
    RAISE EXCEPTION 'admin_account_restricted' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND OR v_pay.customer_id <> v_uid THEN
    RAISE EXCEPTION 'Payment not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_pay.status = 'captured' THEN
    RETURN jsonb_build_object(
      'payment_id', v_pay.id,
      'wallet_spent', COALESCE((v_pay.metadata->>'wallet_applied')::numeric, 0),
      'card_amount', 0,
      'paid_via_wallet_only', true
    );
  END IF;
  IF v_pay.status <> 'pending' THEN
    RAISE EXCEPTION 'Payment is not payable.' USING ERRCODE = '23514';
  END IF;

  v_existing := v_pay.metadata->'wallet_checkout';
  IF jsonb_typeof(v_existing) = 'object' AND (v_existing->>'applied')::boolean IS TRUE THEN
    RETURN v_existing || jsonb_build_object('payment_id', v_pay.id);
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_pay.booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_booking.status::text NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'This booking is no longer payable.' USING ERRCODE = '23514';
  END IF;

  PERFORM public.lock_customer_debts(v_uid);
  PERFORM public.lock_customer_wallet(v_uid);

  v_due := COALESCE(
    NULLIF((v_pay.metadata->>'checkout_total')::numeric, 0),
    NULLIF(v_pay.amount, 0),
    COALESCE(v_booking.price_total, 0) + COALESCE(v_booking.carried_fees_amount, 0)
  );
  IF v_due <= 0 THEN
    RAISE EXCEPTION 'Nothing to pay.' USING ERRCODE = '23514';
  END IF;

  SELECT b.available_amount INTO v_available
  FROM public.customer_wallet_balances(v_uid) b;

  v_spend := LEAST(GREATEST(COALESCE(v_available, 0), 0), v_due);
  v_card := GREATEST(v_due - v_spend, 0);

  v_key := 'checkout_spend:' || p_payment_id::text;

  IF v_spend > 0 THEN
    IF v_spend > COALESCE(v_available, 0) + 0.0001 THEN
      RAISE EXCEPTION 'Insufficient wallet balance.' USING ERRCODE = '23514';
    END IF;
    v_entry_id := public.customer_wallet_insert_entry(
      v_uid, 'debit', v_spend, 'checkout_spend', v_booking.id, p_payment_id, NULL, v_key,
      jsonb_build_object('checkout_total', v_due)
    );
    IF v_entry_id IS NULL THEN
      SELECT e.id, e.amount INTO v_entry_id, v_spend
      FROM public.customer_wallet_entries e
      WHERE e.idempotency_key = v_key;
      IF v_entry_id IS NULL THEN
        RAISE EXCEPTION 'Wallet checkout debit could not be recorded.' USING ERRCODE = '23514';
      END IF;
      v_card := GREATEST(v_due - v_spend, 0);
    END IF;
  END IF;

  IF v_card <= 0.01 THEN
    PERFORM set_config('app.wallet_checkout_adjust', 'on', true);
    PERFORM set_config('app.ledger_internal_capture', 'on', true);
    UPDATE public.payments
    SET status = 'captured',
        captured_at = now(),
        amount = v_due,
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'wallet_checkout',
          jsonb_build_object(
            'applied', true,
            'checkout_total', v_due,
            'wallet_spent', v_spend,
            'card_amount', 0,
            'paid_via_wallet_only', true
          ),
          'wallet_applied', v_spend,
          'checkout_total', v_due
        )
    WHERE id = p_payment_id;
    PERFORM set_config('app.ledger_internal_capture', 'off', true);
    PERFORM set_config('app.wallet_checkout_adjust', 'off', true);
    RETURN jsonb_build_object(
      'payment_id', p_payment_id,
      'wallet_spent', v_spend,
      'card_amount', 0,
      'paid_via_wallet_only', true
    );
  END IF;

  PERFORM set_config('app.wallet_checkout_adjust', 'on', true);
  UPDATE public.payments
  SET amount = round(v_card, 2),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'wallet_checkout',
        jsonb_build_object(
          'applied', true,
          'checkout_total', v_due,
          'wallet_spent', v_spend,
          'card_amount', round(v_card, 2),
          'paid_via_wallet_only', false
        ),
        'wallet_applied', v_spend,
        'checkout_total', v_due
      )
  WHERE id = p_payment_id;
  PERFORM set_config('app.wallet_checkout_adjust', 'off', true);

  RETURN jsonb_build_object(
    'payment_id', p_payment_id,
    'wallet_spent', v_spend,
    'card_amount', round(v_card, 2),
    'paid_via_wallet_only', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.provider_save_onboarding_section(
  p_section text,
  p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_service_id uuid;
  v_zone_id uuid;
  v_ref jsonb;
  v_i int := 0;
  v_norm_phones text[] := ARRAY[]::text[];
  v_norm_phone text;
  v_cap jsonb;
  v_code text;
  v_codes text[] := ARRAY[]::text[];
  v_years int;
  v_note text;
  v_max int;
  v_existing public.provider_age_group_capabilities;
  v_babysitting boolean;
  v_deferred boolean;
  v_previous_marker text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;
  IF public.is_admin_account(v_uid) THEN
    RAISE EXCEPTION 'admin_account_restricted' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.has_role(v_uid, 'provider') THEN
    RAISE EXCEPTION 'Provider authorization required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE profile_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider profile not found.' USING ERRCODE = '42501'; END IF;
  v_deferred := v_provider.onboarding_status IN ('SUBMITTED', 'UNDER_REVIEW')
    AND p_section IN ('personal', 'experience', 'references');
  IF NOT public.provider_onboarding_editable(v_provider.onboarding_status) AND NOT v_deferred THEN
    RAISE EXCEPTION 'Application is not editable in the current status.' USING ERRCODE = '42501';
  END IF;

  v_previous_marker := current_setting('app.provider_deferred_save', true);
  IF v_deferred THEN PERFORM set_config('app.provider_deferred_save', '1', true); END IF;

  INSERT INTO public.provider_onboarding_details (provider_id) VALUES (v_provider.id)
  ON CONFLICT (provider_id) DO NOTHING;

  IF p_section = 'personal' THEN
    UPDATE public.profiles SET full_name = COALESCE(p_payload->>'legal_name', full_name)
    WHERE id = v_uid AND public.provider_onboarding_editable(v_provider.onboarding_status);
    UPDATE public.provider_onboarding_details SET
      date_of_birth = CASE WHEN p_payload ? 'date_of_birth' THEN (p_payload->>'date_of_birth')::date ELSE date_of_birth END,
      gender = CASE WHEN p_payload ? 'gender' THEN NULLIF(btrim(p_payload->>'gender'), '') ELSE gender END,
      governorate = CASE WHEN p_payload ? 'governorate' THEN NULLIF(btrim(p_payload->>'governorate'), '') ELSE governorate END,
      area = CASE WHEN p_payload ? 'area' THEN NULLIF(btrim(p_payload->>'area'), '') ELSE area END,
      full_address = CASE WHEN p_payload ? 'full_address' THEN NULLIF(btrim(p_payload->>'full_address'), '') ELSE full_address END,
      updated_at = now()
    WHERE provider_id = v_provider.id;
    UPDATE public.providers SET city = COALESCE(NULLIF(btrim(p_payload->>'area'), ''), city) WHERE id = v_provider.id;
  ELSIF p_section = 'experience' THEN
    UPDATE public.providers SET
      years_experience = COALESCE((p_payload->>'years_experience')::int, years_experience),
      bio_en = COALESCE(p_payload->>'bio_en', bio_en),
      bio_ar = COALESCE(p_payload->>'bio_ar', bio_ar),
      languages = COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'languages')), languages)
    WHERE id = v_provider.id;
    UPDATE public.provider_onboarding_details SET
      previous_work = NULLIF(btrim(p_payload->>'previous_work'), ''),
      newborn_experience = COALESCE((p_payload->>'newborn_experience')::boolean, newborn_experience),
      first_aid_training = COALESCE((p_payload->>'first_aid_training')::boolean, first_aid_training),
      updated_at = now()
    WHERE provider_id = v_provider.id;

    SELECT EXISTS (
      SELECT 1 FROM public.provider_services ps
      JOIN public.services s ON s.id = ps.service_id
      JOIN public.categories c ON c.id = s.category_id
      WHERE ps.provider_id = v_provider.id AND c.slug = 'babysitting'
    ) INTO v_babysitting;

    IF p_payload ? 'max_children_per_booking' THEN
      IF p_payload->'max_children_per_booking' IS NULL
         OR jsonb_typeof(p_payload->'max_children_per_booking') = 'null'
         OR NULLIF(btrim(p_payload->>'max_children_per_booking'), '') IS NULL THEN
        v_max := NULL;
      ELSE
        BEGIN
          v_max := (p_payload->>'max_children_per_booking')::int;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'max_children_per_booking must be an integer between 1 and 20.' USING ERRCODE = '23514';
        END;
        IF v_max < 1 OR v_max > 20 THEN
          RAISE EXCEPTION 'max_children_per_booking must be an integer between 1 and 20.' USING ERRCODE = '23514';
        END IF;
      END IF;
      IF v_max IS NULL AND v_babysitting THEN
        RAISE EXCEPTION 'max_children_per_booking must be an integer between 1 and 20.' USING ERRCODE = '23514';
      END IF;
      PERFORM set_config('app.max_children_declaration', '1', true);
      UPDATE public.providers SET max_children_per_booking = v_max WHERE id = v_provider.id;
    END IF;

    IF p_payload ? 'age_group_capabilities' THEN
      IF jsonb_typeof(p_payload->'age_group_capabilities') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'age_group_capabilities must be an array.' USING ERRCODE = '23514';
      END IF;

      PERFORM pg_advisory_xact_lock(hashtext('age-cap:' || v_provider.id::text));
      PERFORM 1 FROM public.provider_age_group_capabilities
        WHERE provider_id = v_provider.id FOR UPDATE;

      FOR v_cap IN SELECT jsonb_array_elements(p_payload->'age_group_capabilities') LOOP
        IF jsonb_typeof(v_cap) IS DISTINCT FROM 'object' THEN
          RAISE EXCEPTION 'Each age group capability must be an object.' USING ERRCODE = '23514';
        END IF;
        v_code := NULLIF(btrim(v_cap->>'code'), '');
        IF v_code IS NULL THEN
          RAISE EXCEPTION 'Age group code is required.' USING ERRCODE = '23514';
        END IF;
        IF v_code = ANY (v_codes) THEN
          RAISE EXCEPTION 'Duplicate age group capability: %', v_code USING ERRCODE = '23514';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.child_age_groups g WHERE g.code = v_code AND g.is_active) THEN
          RAISE EXCEPTION 'Unknown or inactive age group: %', v_code USING ERRCODE = '23514';
        END IF;
        IF v_cap ? 'years_experience'
           AND v_cap->'years_experience' IS NOT NULL
           AND jsonb_typeof(v_cap->'years_experience') <> 'null'
           AND NULLIF(btrim(v_cap->>'years_experience'), '') IS NOT NULL THEN
          BEGIN
            v_years := (v_cap->>'years_experience')::int;
          EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'years_experience must be an integer between 0 and 60.' USING ERRCODE = '23514';
          END;
          IF v_years < 0 OR v_years > 60 THEN
            RAISE EXCEPTION 'years_experience must be an integer between 0 and 60.' USING ERRCODE = '23514';
          END IF;
        ELSE
          v_years := NULL;
        END IF;
        v_note := NULLIF(btrim(v_cap->>'note'), '');
        IF v_note IS NOT NULL AND length(v_note) > 300 THEN
          RAISE EXCEPTION 'Capability note must be 300 characters or fewer.' USING ERRCODE = '23514';
        END IF;
        v_codes := array_append(v_codes, v_code);

        SELECT * INTO v_existing
        FROM public.provider_age_group_capabilities
        WHERE provider_id = v_provider.id AND age_group_code = v_code;

        IF NOT FOUND THEN
          INSERT INTO public.provider_age_group_capabilities (
            provider_id, age_group_code, years_experience, note
          ) VALUES (v_provider.id, v_code, v_years, v_note);
        ELSIF v_existing.verified_at IS NOT NULL OR v_existing.verified_by IS NOT NULL THEN
          NULL;
        ELSE
          UPDATE public.provider_age_group_capabilities SET
            years_experience = v_years,
            note = v_note
          WHERE id = v_existing.id;
        END IF;
      END LOOP;

      DELETE FROM public.provider_age_group_capabilities
      WHERE provider_id = v_provider.id
        AND verified_at IS NULL
        AND verified_by IS NULL
        AND (cardinality(v_codes) = 0 OR age_group_code <> ALL (v_codes));

      UPDATE public.provider_onboarding_details SET
        child_age_groups = COALESCE((
          SELECT array_agg(c.age_group_code ORDER BY g.sort_order)
          FROM public.provider_age_group_capabilities c
          JOIN public.child_age_groups g ON g.code = c.age_group_code
          WHERE c.provider_id = v_provider.id
        ), ARRAY[]::text[]),
        updated_at = now()
      WHERE provider_id = v_provider.id;
    ELSIF p_payload ? 'child_age_groups' THEN
      UPDATE public.provider_onboarding_details SET
        child_age_groups = COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'child_age_groups')), child_age_groups),
        updated_at = now()
      WHERE provider_id = v_provider.id;
    END IF;
  ELSIF p_section = 'services' THEN
    FOR v_service_id IN SELECT (value)::uuid FROM jsonb_array_elements_text(COALESCE(p_payload->'service_ids', '[]'::jsonb)) LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.services s JOIN public.categories c ON c.id = s.category_id
        WHERE s.id = v_service_id AND s.is_active AND c.is_active AND public.is_phase1_category_slug(c.slug)
      ) THEN
        RAISE EXCEPTION 'Invalid or inactive service selection.' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.provider_services (provider_id, service_id, status)
      VALUES (v_provider.id, v_service_id, 'pending') ON CONFLICT (provider_id, service_id) DO NOTHING;
    END LOOP;
  ELSIF p_section = 'coverage' THEN
    PERFORM public.replace_provider_zone_coverage(
      v_provider.id,
      ARRAY(
        SELECT (value)::uuid
        FROM jsonb_array_elements_text(COALESCE(p_payload->'zone_ids', '[]'::jsonb))
      )
    );
  ELSIF p_section = 'references' THEN
    DELETE FROM public.provider_references WHERE provider_id = v_provider.id;
    FOR v_ref IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'references', '[]'::jsonb)) LOOP
      IF btrim(COALESCE(v_ref->>'full_name', '')) = ''
         AND btrim(COALESCE(v_ref->>'relationship', '')) = ''
         AND btrim(COALESCE(v_ref->>'phone', '')) = ''
         AND btrim(COALESCE(v_ref->>'notes', '')) = '' THEN
        CONTINUE;
      END IF;
      v_norm_phone := public.normalize_reference_phone(v_ref->>'phone');
      IF v_norm_phone IS NULL OR btrim(v_norm_phone) = '' THEN
        RAISE EXCEPTION 'Reference phone is required.' USING ERRCODE = '23514';
      END IF;
      IF v_norm_phone = ANY(v_norm_phones) THEN
        RAISE EXCEPTION 'Reference phone numbers must be distinct.' USING ERRCODE = '23514';
      END IF;
      v_norm_phones := array_append(v_norm_phones, v_norm_phone);
      v_i := v_i + 1;
      INSERT INTO public.provider_references (provider_id, full_name, relationship, phone, notes, sort_order)
      VALUES (
        v_provider.id, btrim(v_ref->>'full_name'), btrim(v_ref->>'relationship'),
        v_norm_phone, NULLIF(btrim(v_ref->>'notes'), ''), v_i
      );
    END LOOP;
    IF v_i < 1 THEN
      RAISE EXCEPTION 'At least one reference is required.' USING ERRCODE = '23514';
    END IF;
  ELSIF p_section = 'review' THEN
    UPDATE public.provider_onboarding_details SET
      accuracy_confirmed_at = CASE WHEN COALESCE((p_payload->>'confirmed')::boolean, false) THEN now() ELSE NULL END,
      updated_at = now()
    WHERE provider_id = v_provider.id;
  ELSE
    RAISE EXCEPTION 'Unknown onboarding section.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.provider_deferred_save', COALESCE(v_previous_marker, ''), true);
  PERFORM set_config('app.onboarding_internal_call', '1', true);
  PERFORM public.log_provider_onboarding_event(
    v_provider.id, v_uid, 'provider', 'section_updated', v_provider.onboarding_status, v_provider.onboarding_status,
    jsonb_build_object('section', p_section)
  );

  RETURN public.provider_onboarding_completion(v_provider.id);
END;
$$;

REVOKE ALL ON FUNCTION public.provider_save_onboarding_section(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_save_onboarding_section(text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb,
  uuid, text, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, jsonb,
  uuid, text, text, text, text, text
) TO authenticated;

REVOKE ALL ON FUNCTION public.create_provider_profile(text, text, integer, numeric, text, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_provider_profile(text, text, integer, numeric, text, text[])
  TO authenticated;

REVOKE ALL ON FUNCTION public.customer_apply_wallet_at_checkout(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_apply_wallet_at_checkout(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_apply_wallet_at_checkout(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
