-- Sprint 0 / Phase 2A: create the three private storage buckets the app
-- already has RLS policies for (avatars, provider-documents, payment-proofs)
-- but that were never inserted into storage.buckets on a fresh project.
-- Idempotent: safe to re-run, and re-applies config if it ever drifts.
--
-- MIME types / size limits reflect the current upload code, not new policy:
--   avatars:             image/*                 (setup.tsx, pro.profile.tsx — accept="image/*")
--   provider-documents:  image/*, application/pdf (pro.documents.tsx — accept, 10MB client check)
--   payment-proofs:      image/*, application/pdf (PaymentBlock.tsx — accept, 10MB client check)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', false, 5242880, array['image/*']),
  ('provider-documents', 'provider-documents', false, 10485760, array['image/*', 'application/pdf']),
  ('payment-proofs', 'payment-proofs', false, 10485760, array['image/*', 'application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
