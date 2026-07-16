CREATE OR REPLACE FUNCTION public.admin_set_provider_service_status(
  p_id uuid, p_status text, p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
  v_stored_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid provider service status.' USING ERRCODE = '23514';
  END IF;
  IF p_status = 'rejected' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'A reason is required to reject a provider service request.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.audit_reason', COALESCE(btrim(p_reason), ''), true);

  UPDATE public.provider_services AS ps
  SET status = p_status,
      rejection_reason = CASE WHEN p_status = 'rejected' THEN btrim(p_reason) ELSE NULL END
  WHERE ps.id = p_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Provider service not found.' USING ERRCODE = '42501';
  END IF;

  SELECT ps.status INTO v_stored_status
  FROM public.provider_services AS ps
  WHERE ps.id = p_id;

  IF v_stored_status IS DISTINCT FROM p_status THEN
    RAISE EXCEPTION 'Provider service status did not persist.' USING ERRCODE = '40001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_provider_service_status(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_provider_service_status(uuid, text, text) TO authenticated;
