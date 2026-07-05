
-- Storage RLS for provider documents: providers can manage their own files (path prefix = their provider_id)
CREATE POLICY "Providers can read own documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'provider-documents'
    AND EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.profile_id = auth.uid()
      AND p.id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "Providers can upload own documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'provider-documents'
    AND EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.profile_id = auth.uid()
      AND p.id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "Providers can delete own documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'provider-documents'
    AND EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.profile_id = auth.uid()
      AND p.id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "Admins can read all documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'provider-documents' AND public.has_role(auth.uid(), 'admin'));
