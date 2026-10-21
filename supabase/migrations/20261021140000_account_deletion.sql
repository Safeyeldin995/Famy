-- In-app account deletion: eligibility check (authenticated) and anonymization (service_role only).
-- Does not hard-delete auth.users or financial/history rows.

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
  );
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

  IF public.has_role(v_uid, 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'admin');
  END IF;

  IF public.account_deletion_has_active_bookings(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'active_bookings');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.account_deletion_check() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_deletion_check() TO authenticated;

CREATE OR REPLACE FUNCTION public.anonymize_account(p_user_id uuid)
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
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_user' USING ERRCODE = '22023';
  END IF;

  IF public.has_role(p_user_id, 'admin') THEN
    RAISE EXCEPTION 'account_deletion_blocked' USING ERRCODE = '42501';
  END IF;

  IF public.account_deletion_has_active_bookings(p_user_id) THEN
    RAISE EXCEPTION 'account_deletion_blocked' USING ERRCODE = '42501';
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
      WHEN public.has_role(p_user_id, 'provider') THEN 'provider'
      ELSE 'customer'
    END,
    'account_anonymized',
    'profiles',
    p_user_id,
    'self_service_account_deletion',
    jsonb_build_object('deleted', true),
    jsonb_build_object('deleted', true)
  );

  RETURN jsonb_build_object('storage_paths', v_paths);
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_account(uuid) TO service_role;
