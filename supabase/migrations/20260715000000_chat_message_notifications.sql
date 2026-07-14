-- Famy Patch 3 / Module 4: booking chat -> notification bridge.
-- Additive only. Fires on every real (message_type='text') booking chat
-- message and notifies the other eligible participant(s). System lifecycle
-- messages (message_type='system') are skipped entirely — those events
-- already produce their own booking-category notification from
-- tg_booking_notify, so this avoids a duplicate. Bodies are a fixed safe
-- generic preview, never the actual message text: chat content can carry
-- addresses or other details masked only at display time, so nothing from
-- NEW.body is ever copied into the notification payload.

CREATE OR REPLACE FUNCTION public.tg_chat_message_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv RECORD;
  v_customer_link text;
  v_provider_link text;
BEGIN
  IF NEW.message_type <> 'text' THEN
    RETURN NEW;
  END IF;

  SELECT c.booking_id, c.customer_id, c.provider_user_id INTO v_conv
  FROM public.conversations c WHERE c.id = NEW.conversation_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_customer_link := '/booking/' || v_conv.booking_id;
  v_provider_link := '/pro/booking/' || v_conv.booking_id;

  IF NEW.sender_role = 'customer' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      v_conv.provider_user_id, 'chat_message', 'chat',
      'New message', 'You have a new message from your customer.',
      'New message', 'رسالة جديدة',
      'You have a new message from your customer.', 'لديك رسالة جديدة من العميل.',
      jsonb_build_object('booking_id', v_conv.booking_id), v_provider_link, v_conv.booking_id
    );

  ELSIF NEW.sender_role = 'provider' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      v_conv.customer_id, 'chat_message', 'chat',
      'New message', 'You have a new message from your provider.',
      'New message', 'رسالة جديدة',
      'You have a new message from your provider.', 'لديك رسالة جديدة من مزود الخدمة.',
      jsonb_build_object('booking_id', v_conv.booking_id), v_customer_link, v_conv.booking_id
    );

  ELSIF NEW.sender_role = 'admin' THEN
    -- Admin/support messages only occur on disputed bookings
    -- (tg_validate_booking_message) and are relevant to both parties.
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES
      (v_conv.customer_id, 'chat_message', 'chat',
       'New message from support', 'Famy support sent you a message about this booking.',
       'New message from support', 'رسالة جديدة من الدعم',
       'Famy support sent you a message about this booking.', 'أرسل فريق دعم فامي رسالة بخصوص هذا الحجز.',
       jsonb_build_object('booking_id', v_conv.booking_id), v_customer_link, v_conv.booking_id),
      (v_conv.provider_user_id, 'chat_message', 'chat',
       'New message from support', 'Famy support sent you a message about this booking.',
       'New message from support', 'رسالة جديدة من الدعم',
       'Famy support sent you a message about this booking.', 'أرسل فريق دعم فامي رسالة بخصوص هذا الحجز.',
       jsonb_build_object('booking_id', v_conv.booking_id), v_provider_link, v_conv.booking_id);
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_chat_message_notify() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chat_message_notify ON public.messages;
CREATE TRIGGER trg_chat_message_notify AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_chat_message_notify();
