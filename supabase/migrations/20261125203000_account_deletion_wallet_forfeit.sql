-- PO: allow account deletion with positive wallet balance after explicit forfeiture.
-- Fee debts and provider debts owed to Famy still block; provider balance owed to the
-- user still blocks via funds_owed_to_user.

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
    'forfeited_on_deletion'
  ));

CREATE OR REPLACE FUNCTION public.account_deletion_has_funds_owed_to_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.providers pv
    JOIN public.provider_ledger_entries e ON e.provider_id = pv.id
    WHERE pv.profile_id = p_user_id
    GROUP BY pv.id
    HAVING SUM(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END) > 0.005
  );
$$;

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
  OR public.account_deletion_has_unpaid_balance(p_user_id);
$$;

CREATE OR REPLACE FUNCTION public.account_deletion_check()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_wallet numeric;
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

  IF public.account_deletion_has_funds_owed_to_user(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'funds_owed_to_user');
  END IF;

  IF public.account_deletion_has_active_bookings(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'active_bookings');
  END IF;

  SELECT b.available_amount INTO v_wallet
  FROM public.customer_wallet_balances(v_uid) b;

  IF COALESCE(v_wallet, 0) > 0.005 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'wallet_forfeit_amount', round(v_wallet, 2)
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

DROP FUNCTION IF EXISTS public.anonymize_account(uuid);

CREATE OR REPLACE FUNCTION public.anonymize_account(
  p_user_id uuid,
  p_confirm_wallet_forfeit boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_provider_id uuid;
  v_paths jsonb := '[]'::jsonb;
  v_avatar_path text;
  v_doc record;
  v_deleted_label text;
  v_wallet_available numeric;
  v_wallet_forfeited numeric := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_user' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'admin'::public.app_role
  ) THEN
    RAISE EXCEPTION 'account_deletion_blocked' USING ERRCODE = '42501';
  END IF;

  IF public.account_deletion_has_active_bookings(p_user_id) THEN
    RAISE EXCEPTION 'account_deletion_blocked' USING ERRCODE = '42501';
  END IF;

  PERFORM public.lock_customer_wallet(p_user_id);
  SELECT b.available_amount INTO v_wallet_available
  FROM public.customer_wallet_balances(p_user_id) b;

  IF COALESCE(v_wallet_available, 0) > 0.005 THEN
    IF NOT COALESCE(p_confirm_wallet_forfeit, false) THEN
      RAISE EXCEPTION 'wallet_forfeit_confirm_required' USING ERRCODE = '23514';
    END IF;
    v_wallet_forfeited := v_wallet_available;
    PERFORM public.customer_wallet_insert_entry(
      p_user_id,
      'debit',
      v_wallet_available,
      'forfeited_on_deletion',
      NULL,
      NULL,
      NULL,
      'wallet_forfeit:' || p_user_id::text,
      jsonb_build_object(
        'forfeited_on_account_deletion', true,
        'amount', v_wallet_available
      )
    );
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_profile.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('storage_paths', v_paths);
  END IF;

  v_deleted_label := CASE WHEN COALESCE(v_profile.locale, 'en') = 'ar'
    THEN 'مستخدم محذوف'
    ELSE 'Deleted user'
  END;

  IF v_profile.avatar_url IS NOT NULL AND btrim(v_profile.avatar_url) <> '' AND NOT v_profile.avatar_url ~* '^https?://' THEN
    v_avatar_path := v_profile.avatar_url;
    v_paths := v_paths || jsonb_build_array(jsonb_build_object('bucket', 'avatars', 'path', v_avatar_path));
  END IF;

  SELECT id INTO v_provider_id FROM public.providers WHERE profile_id = p_user_id LIMIT 1;
  IF v_provider_id IS NOT NULL THEN
    FOR v_doc IN
      SELECT storage_path FROM public.provider_documents WHERE provider_id = v_provider_id
    LOOP
      IF v_doc.storage_path IS NOT NULL AND btrim(v_doc.storage_path) <> '' THEN
        v_paths := v_paths || jsonb_build_array(
          jsonb_build_object('bucket', 'provider-documents', 'path', v_doc.storage_path)
        );
      END IF;
    END LOOP;

    DELETE FROM public.provider_documents WHERE provider_id = v_provider_id;
    DELETE FROM public.provider_payout_methods WHERE provider_id = v_provider_id;

    PERFORM set_config('app.onboarding_status_transition', '1', true);

    UPDATE public.providers
    SET
      is_active = false,
      deleted_at = now(),
      bio_en = '',
      bio_ar = '',
      vacation_mode = true,
      updated_at = now()
    WHERE id = v_provider_id;
  END IF;

  PERFORM set_config('famy.account_anonymize', 'on', true);

  UPDATE auth.users
  SET
    email = 'deleted-' || p_user_id::text || '@famio.local',
    phone = NULL,
    phone_confirmed_at = NULL,
    updated_at = now()
  WHERE id = p_user_id;

  UPDATE public.booking_locations bl
  SET
    custom_label = NULL,
    street = NULL,
    building = NULL,
    floor = NULL,
    apartment = NULL,
    compound = NULL,
    landmark = NULL,
    access_notes = NULL,
    lat = NULL,
    lng = NULL
  FROM public.bookings b
  WHERE bl.booking_id = b.id
    AND b.customer_id = p_user_id;

  UPDATE public.booking_family_member_snapshots bfms
  SET
    full_name = v_deleted_label,
    phone = NULL,
    date_of_birth = NULL,
    allergies = NULL,
    medical_notes = NULL,
    access_notes = NULL,
    emergency_contact_name = NULL,
    emergency_contact_phone = NULL,
    relationship_other = NULL
  FROM public.bookings b
  WHERE bfms.booking_id = b.id
    AND b.customer_id = p_user_id;

  DELETE FROM public.addresses WHERE user_id = p_user_id;
  DELETE FROM public.family_members WHERE customer_id = p_user_id;
  DELETE FROM public.device_push_tokens WHERE user_id = p_user_id;
  DELETE FROM public.push_subscriptions WHERE user_id = p_user_id;
  DELETE FROM public.notification_preferences WHERE user_id = p_user_id;

  PERFORM set_config('famy.allow_phone_write', 'on', true);
  UPDATE public.profiles
  SET
    full_name = v_deleted_label,
    phone = NULL,
    phone_verified = false,
    email = NULL,
    avatar_url = NULL,
    deleted_at = now(),
    updated_at = now()
  WHERE id = p_user_id;

  INSERT INTO public.audit_logs (
    actor_id, actor_role, action, entity, entity_id, reason, old_values, new_values
  ) VALUES (
    p_user_id,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'provider'::public.app_role
      ) THEN 'provider'
      ELSE 'customer'
    END,
    'account_anonymized',
    'profiles',
    p_user_id,
    'self_service_account_deletion',
    jsonb_build_object(
      'wallet_balance_forfeited', v_wallet_forfeited
    ),
    jsonb_build_object(
      'deleted', true,
      'wallet_balance_forfeited', v_wallet_forfeited
    )
  );

  RETURN jsonb_build_object('storage_paths', v_paths);
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_account(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_account(uuid, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';