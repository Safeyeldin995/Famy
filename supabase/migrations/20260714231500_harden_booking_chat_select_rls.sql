-- Famy Patch 3 / Module 3 follow-up: harden booking chat SELECT RLS.
-- Additive only — replaces conv_select / messages_select from 20260628223929
-- with versions that also require the underlying booking to be past
-- 'pending'. Today conversations are only ever created once a booking hits
-- 'confirmed' (tg_booking_create_conversation), so this changes no current
-- behavior — it closes the gap where a conversation row existing for a
-- still-pending booking (e.g. future code path, admin backfill, direct
-- write) would otherwise be readable by the two parties, mirroring the
-- status gate trg_validate_booking_message already enforces on INSERT.
-- Admin/support visibility is unchanged (unconditional, as before).

DROP POLICY IF EXISTS conv_select ON public.conversations;
CREATE POLICY conv_select ON public.conversations FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR (
    (auth.uid() = customer_id OR auth.uid() = provider_user_id)
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = booking_id AND b.status <> 'pending'
    )
  )
);

DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.conversations c
  WHERE c.id = conversation_id
    AND (
      public.has_role(auth.uid(), 'admin')
      OR (
        (auth.uid() = c.customer_id OR auth.uid() = c.provider_user_id)
        AND EXISTS (
          SELECT 1 FROM public.bookings b
          WHERE b.id = c.booking_id AND b.status <> 'pending'
        )
      )
    )
));
