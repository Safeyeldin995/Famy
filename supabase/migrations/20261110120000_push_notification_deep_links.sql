-- Push / mobile: chat notifications open the conversation thread; campaigns carry a home deep link.

CREATE OR REPLACE FUNCTION public.tg_chat_message_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv RECORD;
  v_thread_link text;
BEGIN
  IF NEW.message_type <> 'text' THEN
    RETURN NEW;
  END IF;

  SELECT c.booking_id, c.customer_id, c.provider_user_id INTO v_conv
  FROM public.conversations c WHERE c.id = NEW.conversation_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_thread_link := '/messages/' || NEW.conversation_id::text;

  IF NEW.sender_role = 'customer' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      v_conv.provider_user_id, 'chat_message', 'chat',
      'New message', 'You have a new message from your customer.',
      'New message', 'رسالة جديدة',
      'You have a new message from your customer.', 'لديك رسالة جديدة من العميل.',
      jsonb_build_object('booking_id', v_conv.booking_id, 'conversation_id', NEW.conversation_id),
      v_thread_link, v_conv.booking_id
    );

  ELSIF NEW.sender_role = 'provider' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES (
      v_conv.customer_id, 'chat_message', 'chat',
      'New message', 'You have a new message from your provider.',
      'New message', 'رسالة جديدة',
      'You have a new message from your provider.', 'لديك رسالة جديدة من مزود الخدمة.',
      jsonb_build_object('booking_id', v_conv.booking_id, 'conversation_id', NEW.conversation_id),
      v_thread_link, v_conv.booking_id
    );

  ELSIF NEW.sender_role = 'admin' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, deep_link, booking_id)
    VALUES
      (v_conv.customer_id, 'chat_message', 'chat',
       'New message from support', 'Famy support sent you a message about this booking.',
       'New message from support', 'رسالة جديدة من الدعم',
       'Famy support sent you a message about this booking.', 'أرسل فريق دعم فامي رسالة بخصوص هذا الحجز.',
       jsonb_build_object('booking_id', v_conv.booking_id, 'conversation_id', NEW.conversation_id),
       v_thread_link, v_conv.booking_id),
      (v_conv.provider_user_id, 'chat_message', 'chat',
       'New message from support', 'Famy support sent you a message about this booking.',
       'New message from support', 'رسالة جديدة من الدعم',
       'Famy support sent you a message about this booking.', 'أرسل فريق دعم فامي رسالة بخصوص هذا الحجز.',
       jsonb_build_object('booking_id', v_conv.booking_id, 'conversation_id', NEW.conversation_id),
       v_thread_link, v_conv.booking_id);
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_chat_message_notify() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.expand_campaign_recipients(p_campaign_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_c RECORD;
  v_count integer;
  v_deep_link text;
BEGIN
  SELECT * INTO v_c FROM public.notification_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_deep_link := CASE v_c.target
    WHEN 'providers' THEN '/pro'
    ELSE '/home'
  END;

  INSERT INTO public.notifications (user_id, type, category, title, body, title_en, title_ar, body_en, body_ar, payload, campaign_id, deep_link)
  SELECT DISTINCT ur.user_id, 'campaign', 'campaign',
    v_c.title_en, v_c.body_en, v_c.title_en, v_c.title_ar, v_c.body_en, v_c.body_ar,
    jsonb_build_object('campaign_id', v_c.id), v_c.id, v_deep_link
  FROM public.user_roles ur
  WHERE ur.role = ANY (CASE v_c.target
      WHEN 'customers' THEN ARRAY['customer']::public.app_role[]
      WHEN 'providers' THEN ARRAY['provider']::public.app_role[]
      ELSE ARRAY['customer','provider']::public.app_role[]
    END)
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n WHERE n.campaign_id = v_c.id AND n.user_id = ur.user_id
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.expand_campaign_recipients(uuid) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
