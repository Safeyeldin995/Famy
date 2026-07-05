
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS proof_path text,
  ADD COLUMN IF NOT EXISTS proof_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

GRANT INSERT, UPDATE ON public.payments TO authenticated;

DROP POLICY IF EXISTS payments_customer_insert ON public.payments;
CREATE POLICY payments_customer_insert ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (
    customer_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.customer_id = auth.uid())
  );

DROP POLICY IF EXISTS payments_customer_update_proof ON public.payments;
CREATE POLICY payments_customer_update_proof ON public.payments
  FOR UPDATE TO authenticated
  USING (customer_id = auth.uid() AND status = 'pending_review')
  WITH CHECK (customer_id = auth.uid() AND status = 'pending_review');

DROP POLICY IF EXISTS payments_provider_read ON public.payments;
CREATE POLICY payments_provider_read ON public.payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.providers pr ON pr.id = b.provider_id
      WHERE b.id = payments.booking_id AND pr.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS payments_provider_update ON public.payments;
CREATE POLICY payments_provider_update ON public.payments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.providers pr ON pr.id = b.provider_id
      WHERE b.id = payments.booking_id AND pr.profile_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.providers pr ON pr.id = b.provider_id
      WHERE b.id = payments.booking_id AND pr.profile_id = auth.uid()
    )
  );

-- Storage RLS — payment-proofs bucket; path convention: <booking_id>/<filename>
DROP POLICY IF EXISTS "payment_proofs_customer_insert" ON storage.objects;
CREATE POLICY "payment_proofs_customer_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-proofs'
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id::text = (storage.foldername(name))[1] AND b.customer_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "payment_proofs_customer_read" ON storage.objects;
CREATE POLICY "payment_proofs_customer_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id::text = (storage.foldername(name))[1] AND b.customer_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "payment_proofs_provider_read" ON storage.objects;
CREATE POLICY "payment_proofs_provider_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.providers pr ON pr.id = b.provider_id
      WHERE b.id::text = (storage.foldername(name))[1] AND pr.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "payment_proofs_admin_all" ON storage.objects;
CREATE POLICY "payment_proofs_admin_all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'payment-proofs' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'payment-proofs' AND public.has_role(auth.uid(), 'admin'));

INSERT INTO public.settings(key, value)
VALUES ('instapay_receiver', jsonb_build_object(
  'handle', 'famio@instapay',
  'display_name', 'Famio',
  'note', 'Send your transfer to this InstaPay handle and upload the screenshot as proof.'
))
ON CONFLICT (key) DO NOTHING;
