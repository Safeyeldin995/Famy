-- Reject customer/provider text after booking chat closes (completed/cancelled/no_show).
-- Additive: replaces the validation function only. Terminal bookings now raise 'chat_closed',
-- and admins may also write on terminal bookings (previously disputed only).

CREATE OR REPLACE FUNCTION public.tg_validate_booking_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_conv RECORD;
  v_status public.booking_status;
  v_role text;
  v_writable CONSTANT public.booking_status[] := ARRAY[
    'confirmed','on_the_way','arrived','arrival_confirmed','in_progress','completion_requested'
  ]::public.booking_status[];
  v_terminal CONSTANT public.booking_status[] := ARRAY[
    'completed','cancelled','no_show'
  ]::public.booking_status[];
BEGIN
  IF current_setting('app.system_message_in_progress', true) = 'on' THEN
    NEW.sender_id := NULL;
    NEW.sender_role := 'system';
    NEW.message_type := 'system';
    NEW.created_at := now();
    NEW.body := btrim(NEW.body);
    IF NEW.body = '' THEN
      RAISE EXCEPTION 'Message body cannot be empty.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT c.id, c.booking_id, c.customer_id, c.provider_user_id INTO v_conv
  FROM public.conversations c WHERE c.id = NEW.conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found.' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status FROM public.bookings WHERE id = v_conv.booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = '42501';
  END IF;

  IF v_conv.customer_id = v_uid THEN
    v_role := 'customer';
  ELSIF v_conv.provider_user_id = v_uid THEN
    v_role := 'provider';
  ELSIF public.has_role(v_uid, 'admin') THEN
    v_role := 'admin';
  ELSE
    RAISE EXCEPTION 'You are not a participant in this booking chat.' USING ERRCODE = '42501';
  END IF;

  IF v_role IN ('customer', 'provider') THEN
    IF v_status = 'disputed' THEN
      RAISE EXCEPTION 'This booking is under dispute review. Only Famy support can send messages.' USING ERRCODE = '42501';
    ELSIF v_status = ANY(v_terminal) THEN
      RAISE EXCEPTION 'chat_closed' USING ERRCODE = '42501';
    ELSIF NOT (v_status = ANY(v_writable)) THEN
      RAISE EXCEPTION 'This booking chat is not open for new messages.' USING ERRCODE = '42501';
    END IF;
  ELSIF v_role = 'admin' THEN
    IF v_status = ANY(v_terminal) OR v_status = 'disputed' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Admin/support may only send messages on disputed bookings.' USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.sender_id := v_uid;
  NEW.sender_role := v_role;
  NEW.message_type := 'text';
  NEW.system_key := NULL;
  NEW.created_at := now();
  NEW.body := btrim(NEW.body);
  IF NEW.body = '' THEN
    RAISE EXCEPTION 'Message body cannot be empty.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_validate_booking_message() FROM PUBLIC, anon, authenticated;

-- The existing trigger trg_messages_validate already runs this function on INSERT.
