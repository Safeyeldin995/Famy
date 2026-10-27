-- Customer setup must not leave a new name behind when its address fails.
-- INVOKER retains the existing table grants, RLS, constraints and triggers.
-- This migration is review-only until the release owner applies it.
CREATE OR REPLACE FUNCTION public.save_customer_setup(
  p_full_name text,
  p_address jsonb,
  p_address_id uuid DEFAULT NULL,
  p_contact_phone text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := p_address_id;
  v_lat double precision;
  v_lng double precision;
  v_street text := btrim(p_address->>'street');
  v_default boolean;
  v_line2 text := nullif(concat_ws(' · ', nullif(btrim(p_address->>'compound'), ''), nullif(btrim(p_address->>'building'), ''), nullif(btrim(p_address->>'apartment'), ''), nullif(btrim(p_address->>'access_notes'), '')), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF p_full_name IS NULL OR length(btrim(p_full_name)) < 2 OR length(btrim(p_full_name)) > 200
    OR p_address IS NULL OR jsonb_typeof(p_address) <> 'object'
    OR v_street IS NULL OR length(v_street) < 3
    OR coalesce(btrim(p_address->>'city'), '') = ''
    OR coalesce(btrim(p_address->>'area'), '') = '' THEN
    RAISE EXCEPTION 'invalid_customer_setup' USING ERRCODE = '22023';
  END IF;
  v_lat := (p_address->>'lat')::double precision;
  v_lng := (p_address->>'lng')::double precision;
  IF v_lat IS NULL OR v_lng IS NULL OR NOT (v_lat BETWEEN -90 AND 90 AND v_lng BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'invalid_address_coordinates' USING ERRCODE = '22023';
  END IF;

  -- Serialize this owner's setup submissions, including new-address retries.
  PERFORM 1 FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = '42501'; END IF;
  -- Reuse the existing contact-phone guard; never write phone/verification directly.
  -- Its update rolls back with the name/address if a later write fails.
  IF p_contact_phone IS NOT NULL THEN
    PERFORM public.set_my_contact_phone(p_contact_phone);
  END IF;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.addresses WHERE user_id = v_uid
      ORDER BY is_default DESC, created_at, id LIMIT 1;
  END IF;
  IF v_id IS NOT NULL THEN
    SELECT is_default INTO v_default FROM public.addresses WHERE id = v_id AND user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'address_not_found' USING ERRCODE = '42501'; END IF;
  ELSE
    v_default := true;
  END IF;

  UPDATE public.profiles SET full_name = btrim(p_full_name) WHERE id = v_uid;
  IF v_id IS NULL THEN
    INSERT INTO public.addresses (user_id, label, line1, line2, city, area, street, compound, building, floor, apartment, landmark, access_notes, lat, lng, is_default)
    VALUES (v_uid, 'home', v_street, v_line2, btrim(p_address->>'city'), btrim(p_address->>'area'), v_street,
      nullif(btrim(p_address->>'compound'), ''), nullif(btrim(p_address->>'building'), ''), nullif(btrim(p_address->>'floor'), ''),
      nullif(btrim(p_address->>'apartment'), ''), nullif(btrim(p_address->>'landmark'), ''), nullif(btrim(p_address->>'access_notes'), ''),
      v_lat, v_lng, v_default) RETURNING id INTO v_id;
  ELSE
    UPDATE public.addresses SET line1 = v_street, line2 = v_line2, street = v_street,
      city = btrim(p_address->>'city'), area = btrim(p_address->>'area'),
      compound = nullif(btrim(p_address->>'compound'), ''), building = nullif(btrim(p_address->>'building'), ''),
      floor = nullif(btrim(p_address->>'floor'), ''), apartment = nullif(btrim(p_address->>'apartment'), ''),
      landmark = nullif(btrim(p_address->>'landmark'), ''), access_notes = nullif(btrim(p_address->>'access_notes'), ''),
      lat = v_lat, lng = v_lng
      WHERE id = v_id AND user_id = v_uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'address_not_found' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_customer_setup(text, jsonb, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_customer_setup(text, jsonb, uuid, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
