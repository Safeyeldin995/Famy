
-- conversations
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_customer_idx ON public.conversations(customer_id);
CREATE INDEX conversations_provider_user_idx ON public.conversations(provider_user_id);

GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY conv_select ON public.conversations FOR SELECT TO authenticated
USING (auth.uid() = customer_id OR auth.uid() = provider_user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY conv_admin_all ON public.conversations FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER conversations_set_updated_at BEFORE UPDATE ON public.conversations
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- messages
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(body) > 0 AND length(body) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conv_created_idx ON public.messages(conversation_id, created_at);

GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY messages_select ON public.messages FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.conversations c
  WHERE c.id = conversation_id
    AND (auth.uid() = c.customer_id OR auth.uid() = c.provider_user_id OR public.has_role(auth.uid(),'admin'))
));

CREATE POLICY messages_insert ON public.messages FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = sender_id
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id
      AND (auth.uid() = c.customer_id OR auth.uid() = c.provider_user_id)
  )
);

CREATE POLICY messages_admin_all ON public.messages FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- contact-masking: block phone-number-shaped strings
CREATE OR REPLACE FUNCTION public.tg_messages_block_contact()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  digits text;
BEGIN
  -- strip non-digits, count runs of 7+ digits anywhere in the body
  digits := regexp_replace(NEW.body, '[^0-9]', '', 'g');
  IF digits ~ '[0-9]{7,}' THEN
    RAISE EXCEPTION 'contact_masked' USING ERRCODE = 'check_violation';
  END IF;
  -- also catch patterns like 010 123 4567 or +20 10 1234 5678 already covered by strip,
  -- but also block common @ email patterns
  IF NEW.body ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' THEN
    RAISE EXCEPTION 'contact_masked' USING ERRCODE = 'check_violation';
  END IF;
  -- bump conversation updated_at
  UPDATE public.conversations SET updated_at = now() WHERE id = NEW.conversation_id;
  RETURN NEW;
END $$;

CREATE TRIGGER messages_block_contact BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.tg_messages_block_contact();

-- auto-create conversation on booking confirmation
CREATE OR REPLACE FUNCTION public.tg_booking_create_conversation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider_user uuid;
BEGIN
  IF NEW.status = 'confirmed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'confirmed') THEN
    SELECT profile_id INTO v_provider_user FROM public.providers WHERE id = NEW.provider_id;
    IF v_provider_user IS NOT NULL THEN
      INSERT INTO public.conversations (booking_id, customer_id, provider_user_id)
      VALUES (NEW.id, NEW.customer_id, v_provider_user)
      ON CONFLICT (booking_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER bookings_create_conversation
AFTER INSERT OR UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.tg_booking_create_conversation();
