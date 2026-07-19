-- Patch 1 independent-audit fixes: atomic Admin reorder operations.
-- Additive only. Each function locks and validates both rows, then swaps the
-- stored order values in one statement/transaction. Any error rolls back the
-- entire function call.

CREATE OR REPLACE FUNCTION public.admin_swap_service_requirement_order(
  p_first_id uuid,
  p_second_id uuid
) RETURNS TABLE(id uuid, sort_order integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first public.service_requirements%ROWTYPE;
  v_second public.service_requirements%ROWTYPE;
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_first_id IS NULL OR p_second_id IS NULL OR p_first_id = p_second_id THEN
    RAISE EXCEPTION 'Two different requirement rows are required.' USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM public.service_requirements
  WHERE service_requirements.id IN (p_first_id, p_second_id)
  ORDER BY service_requirements.id
  FOR UPDATE;

  SELECT * INTO v_first FROM public.service_requirements WHERE service_requirements.id = p_first_id;
  SELECT * INTO v_second FROM public.service_requirements WHERE service_requirements.id = p_second_id;
  IF v_first.id IS NULL OR v_second.id IS NULL THEN
    RAISE EXCEPTION 'Both requirement rows must exist.' USING ERRCODE = 'P0002';
  END IF;
  IF v_first.service_id <> v_second.service_id THEN
    RAISE EXCEPTION 'Requirements must belong to the same service.' USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
  UPDATE public.service_requirements AS requirement
  SET sort_order = CASE requirement.id
    WHEN p_first_id THEN v_second.sort_order
    WHEN p_second_id THEN v_first.sort_order
  END
  WHERE requirement.id IN (p_first_id, p_second_id)
  RETURNING requirement.id, requirement.sort_order;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 2 THEN
    RAISE EXCEPTION 'Requirement order swap did not update both rows.' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_swap_service_requirement_order(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_swap_service_requirement_order(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_swap_payment_method_order(
  p_first_id uuid,
  p_second_id uuid
) RETURNS TABLE(id uuid, display_order integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first public.payment_methods%ROWTYPE;
  v_second public.payment_methods%ROWTYPE;
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_first_id IS NULL OR p_second_id IS NULL OR p_first_id = p_second_id THEN
    RAISE EXCEPTION 'Two different payment methods are required.' USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM public.payment_methods
  WHERE payment_methods.id IN (p_first_id, p_second_id)
  ORDER BY payment_methods.id
  FOR UPDATE;

  SELECT * INTO v_first FROM public.payment_methods WHERE payment_methods.id = p_first_id;
  SELECT * INTO v_second FROM public.payment_methods WHERE payment_methods.id = p_second_id;
  IF v_first.id IS NULL OR v_second.id IS NULL THEN
    RAISE EXCEPTION 'Both payment methods must exist.' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  UPDATE public.payment_methods AS method
  SET display_order = CASE method.id
    WHEN p_first_id THEN v_second.display_order
    WHEN p_second_id THEN v_first.display_order
  END
  WHERE method.id IN (p_first_id, p_second_id)
  RETURNING method.id, method.display_order;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 2 THEN
    RAISE EXCEPTION 'Payment method order swap did not update both rows.' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_swap_payment_method_order(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_swap_payment_method_order(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_swap_cancellation_reason_order(
  p_first_id uuid,
  p_second_id uuid
) RETURNS TABLE(id uuid, display_order integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first public.cancellation_reasons%ROWTYPE;
  v_second public.cancellation_reasons%ROWTYPE;
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_first_id IS NULL OR p_second_id IS NULL OR p_first_id = p_second_id THEN
    RAISE EXCEPTION 'Two different cancellation reasons are required.' USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM public.cancellation_reasons
  WHERE cancellation_reasons.id IN (p_first_id, p_second_id)
  ORDER BY cancellation_reasons.id
  FOR UPDATE;

  SELECT * INTO v_first FROM public.cancellation_reasons WHERE cancellation_reasons.id = p_first_id;
  SELECT * INTO v_second FROM public.cancellation_reasons WHERE cancellation_reasons.id = p_second_id;
  IF v_first.id IS NULL OR v_second.id IS NULL THEN
    RAISE EXCEPTION 'Both cancellation reasons must exist.' USING ERRCODE = 'P0002';
  END IF;
  IF v_first.actor_type <> v_second.actor_type THEN
    RAISE EXCEPTION 'Cancellation reasons must have the same actor type.' USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
  UPDATE public.cancellation_reasons AS reason
  SET display_order = CASE reason.id
    WHEN p_first_id THEN v_second.display_order
    WHEN p_second_id THEN v_first.display_order
  END
  WHERE reason.id IN (p_first_id, p_second_id)
  RETURNING reason.id, reason.display_order;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 2 THEN
    RAISE EXCEPTION 'Cancellation reason order swap did not update both rows.' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_swap_cancellation_reason_order(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_swap_cancellation_reason_order(uuid, uuid) TO authenticated;
