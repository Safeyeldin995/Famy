-- Chat unblock (Issue #512): user and admin paths with audit trail.

DROP TRIGGER IF EXISTS trg_audit_chat_user_blocks_delete ON public.chat_user_blocks;
CREATE TRIGGER trg_audit_chat_user_blocks_delete
  AFTER DELETE ON public.chat_user_blocks
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

CREATE OR REPLACE FUNCTION public.unblock_chat_conversation(p_conversation_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_conv public.conversations%ROWTYPE;
  v_deleted uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found.' USING ERRCODE = '42501';
  END IF;

  IF v_uid <> v_conv.customer_id AND v_uid <> v_conv.provider_user_id THEN
    RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.chat_user_blocks b
  WHERE b.customer_id = v_conv.customer_id
    AND b.provider_user_id = v_conv.provider_user_id
    AND b.blocked_by = v_uid
  RETURNING b.id INTO v_deleted;

  IF v_deleted IS NULL THEN
    RAISE EXCEPTION 'No block by you exists for this conversation.' USING ERRCODE = '42501';
  END IF;

  RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.unblock_chat_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unblock_chat_conversation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_unblock_chat_block(
  p_block_id uuid,
  p_admin_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_block public.chat_user_blocks%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;
  IF p_admin_notes IS NULL OR btrim(p_admin_notes) = '' THEN
    RAISE EXCEPTION 'Admin notes are required.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_block FROM public.chat_user_blocks WHERE id = p_block_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Block not found.' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.chat_user_blocks WHERE id = p_block_id;

  INSERT INTO public.audit_logs (
    actor_id, actor_role, action, entity, entity_id, reason, diff
  ) VALUES (
    v_uid,
    'admin',
    'unblock_chat',
    'chat_user_blocks',
    p_block_id,
    btrim(p_admin_notes),
    jsonb_build_object(
      'customer_id', v_block.customer_id,
      'provider_user_id', v_block.provider_user_id,
      'blocked_by', v_block.blocked_by,
      'conversation_id', v_block.conversation_id,
      'source', 'admin_unblock_chat_block'
    )
  );

  RETURN p_block_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_unblock_chat_block(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_unblock_chat_block(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_chat_blocks()
RETURNS TABLE (
  id uuid,
  conversation_id uuid,
  other_user_id uuid,
  other_full_name text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id,
    b.conversation_id,
    CASE
      WHEN b.blocked_by = b.customer_id THEN b.provider_user_id
      ELSE b.customer_id
    END AS other_user_id,
    COALESCE(p.full_name, '') AS other_full_name,
    b.created_at
  FROM public.chat_user_blocks b
  JOIN public.profiles p ON p.id = CASE
    WHEN b.blocked_by = b.customer_id THEN b.provider_user_id
    ELSE b.customer_id
  END
  WHERE b.blocked_by = auth.uid()
  ORDER BY b.created_at DESC
  LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.list_my_chat_blocks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_chat_blocks() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_chat_blocks()
RETURNS TABLE (
  id uuid,
  conversation_id uuid,
  customer_id uuid,
  provider_user_id uuid,
  blocked_by uuid,
  blocked_by_name text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin authorization required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.conversation_id,
    b.customer_id,
    b.provider_user_id,
    b.blocked_by,
    COALESCE(p.full_name, '') AS blocked_by_name,
    b.created_at
  FROM public.chat_user_blocks b
  LEFT JOIN public.profiles p ON p.id = b.blocked_by
  ORDER BY b.created_at DESC
  LIMIT 200;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_chat_blocks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_chat_blocks() TO authenticated;

NOTIFY pgrst, 'reload schema';