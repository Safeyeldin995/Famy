-- Provider credentials: education, work experience and certificates (PO, 28 Nov).
-- Providers add them from the «كمل ملفك» checklist; admin verifies certificates;
-- the public tutor profile shows education, experience and ONLY admin-verified certificates.
-- Free text stays in plain columns so a later auto-translation job can read it.

-- 1. Tables ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.provider_education (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  institution text NOT NULL CHECK (length(btrim(institution)) BETWEEN 2 AND 160),
  degree text NOT NULL CHECK (length(btrim(degree)) BETWEEN 2 AND 160),
  field_of_study text CHECK (field_of_study IS NULL OR length(btrim(field_of_study)) <= 160),
  start_year smallint CHECK (start_year IS NULL OR start_year BETWEEN 1950 AND 2100),
  end_year smallint CHECK (end_year IS NULL OR end_year BETWEEN 1950 AND 2100),
  proof_path text CHECK (proof_path IS NULL OR length(proof_path) <= 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_education_years CHECK (start_year IS NULL OR end_year IS NULL OR end_year >= start_year)
);

CREATE TABLE IF NOT EXISTS public.provider_work_experience (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  role_title text NOT NULL CHECK (length(btrim(role_title)) BETWEEN 2 AND 160),
  place text NOT NULL CHECK (length(btrim(place)) BETWEEN 2 AND 160),
  start_year smallint CHECK (start_year IS NULL OR start_year BETWEEN 1950 AND 2100),
  end_year smallint CHECK (end_year IS NULL OR end_year BETWEEN 1950 AND 2100),
  is_current boolean NOT NULL DEFAULT false,
  description text CHECK (description IS NULL OR length(description) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_work_experience_years CHECK (start_year IS NULL OR end_year IS NULL OR end_year >= start_year),
  CONSTRAINT provider_work_experience_current CHECK (NOT is_current OR end_year IS NULL)
);

CREATE TABLE IF NOT EXISTS public.provider_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 160),
  issuer text NOT NULL CHECK (length(btrim(issuer)) BETWEEN 2 AND 160),
  issued_year smallint CHECK (issued_year IS NULL OR issued_year BETWEEN 1950 AND 2100),
  file_path text NOT NULL CHECK (length(file_path) BETWEEN 3 AND 512),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  review_note text CHECK (review_note IS NULL OR length(review_note) <= 500),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_education_provider_idx ON public.provider_education(provider_id);
CREATE INDEX IF NOT EXISTS provider_work_experience_provider_idx ON public.provider_work_experience(provider_id);
CREATE INDEX IF NOT EXISTS provider_certificates_provider_idx ON public.provider_certificates(provider_id);
CREATE INDEX IF NOT EXISTS provider_certificates_reviewed_by_idx ON public.provider_certificates(reviewed_by);
CREATE INDEX IF NOT EXISTS provider_certificates_pending_idx ON public.provider_certificates(created_at) WHERE status = 'pending';

-- 2. Integrity triggers ------------------------------------------------------

-- Files must live in the provider's own folder of the private bucket.
CREATE OR REPLACE FUNCTION public.tg_provider_credential_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_path text;
  v_is_admin boolean := public.has_role((SELECT auth.uid()), 'admin'::public.app_role);
BEGIN
  NEW.updated_at := now();

  IF TG_TABLE_NAME = 'provider_certificates' THEN
    v_path := NEW.file_path;
  ELSIF TG_TABLE_NAME = 'provider_education' THEN
    v_path := NEW.proof_path;
  END IF;

  IF v_path IS NOT NULL AND split_part(v_path, '/', 1) <> NEW.provider_id::text THEN
    RAISE EXCEPTION 'CREDENTIAL_FILE_OUTSIDE_PROVIDER_FOLDER' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN
    RAISE EXCEPTION 'CREDENTIAL_PROVIDER_IMMUTABLE' USING ERRCODE = '22023';
  END IF;

  IF TG_TABLE_NAME = 'provider_certificates' AND NOT v_is_admin
     AND COALESCE(current_setting('famy.credential_review', true), '') <> 'on' THEN
    -- Providers never set review fields. Any edit by the provider sends it back to review.
    IF TG_OP = 'INSERT' THEN
      NEW.status := 'pending';
      NEW.review_note := NULL;
      NEW.reviewed_by := NULL;
      NEW.reviewed_at := NULL;
    ELSIF NEW.title IS DISTINCT FROM OLD.title
       OR NEW.issuer IS DISTINCT FROM OLD.issuer
       OR NEW.issued_year IS DISTINCT FROM OLD.issued_year
       OR NEW.file_path IS DISTINCT FROM OLD.file_path THEN
      NEW.status := 'pending';
      NEW.review_note := NULL;
      NEW.reviewed_by := NULL;
      NEW.reviewed_at := NULL;
    ELSE
      NEW.status := OLD.status;
      NEW.review_note := OLD.review_note;
      NEW.reviewed_by := OLD.reviewed_by;
      NEW.reviewed_at := OLD.reviewed_at;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_provider_credential_guard() FROM PUBLIC, anon, authenticated;

-- At most 15 rows per provider per table (keeps the profile readable and blocks spam).
CREATE OR REPLACE FUNCTION public.tg_provider_credential_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  EXECUTE format('SELECT count(*) FROM public.%I WHERE provider_id = $1', TG_TABLE_NAME)
    INTO v_count USING NEW.provider_id;
  IF v_count >= 15 THEN
    RAISE EXCEPTION 'CREDENTIAL_LIMIT_REACHED' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_provider_credential_limit() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['provider_education', 'provider_work_experience', 'provider_certificates'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_guard ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_provider_credential_guard()', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_limit ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_limit BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_provider_credential_limit()', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%s ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_audit_%s AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes()', t, t);
  END LOOP;
END;
$$;

-- 3. RLS: the owner provider and admin only. The public reads through the RPC below.

ALTER TABLE public.provider_education ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_work_experience ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_certificates ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['provider_education', 'provider_work_experience', 'provider_certificates'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_all', t);
    EXECUTE format($p$
      CREATE POLICY %I ON public.%I FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.providers p
                     WHERE p.id = provider_id AND p.profile_id = (SELECT auth.uid()) AND p.deleted_at IS NULL))
      WITH CHECK (EXISTS (SELECT 1 FROM public.providers p
                     WHERE p.id = provider_id AND p.profile_id = (SELECT auth.uid()) AND p.deleted_at IS NULL))
    $p$, t || '_owner_all', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_all', t);
    EXECUTE format($p$
      CREATE POLICY %I ON public.%I FOR ALL TO authenticated
      USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
    $p$, t || '_admin_all', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END;
$$;

-- 4. Private storage bucket. Path: {provider_id}/{kind}/{uuid}.{ext}

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('provider-credentials', 'provider-credentials', false, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS provider_credentials_owner_read ON storage.objects;
CREATE POLICY provider_credentials_owner_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'provider-credentials' AND EXISTS (
    SELECT 1 FROM public.providers p
    WHERE p.profile_id = (SELECT auth.uid()) AND p.id::text = (storage.foldername(name))[1]));

DROP POLICY IF EXISTS provider_credentials_owner_insert ON storage.objects;
CREATE POLICY provider_credentials_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'provider-credentials' AND EXISTS (
    SELECT 1 FROM public.providers p
    WHERE p.profile_id = (SELECT auth.uid()) AND p.id::text = (storage.foldername(name))[1]
      AND p.deleted_at IS NULL));

DROP POLICY IF EXISTS provider_credentials_owner_delete ON storage.objects;
CREATE POLICY provider_credentials_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'provider-credentials' AND EXISTS (
    SELECT 1 FROM public.providers p
    WHERE p.profile_id = (SELECT auth.uid()) AND p.id::text = (storage.foldername(name))[1]));

DROP POLICY IF EXISTS provider_credentials_admin_read ON storage.objects;
CREATE POLICY provider_credentials_admin_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'provider-credentials' AND public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

-- 5. Public read: education, experience and VERIFIED certificates of an approved provider.
-- No file paths, no review notes, no ids of reviewers.

CREATE OR REPLACE FUNCTION public.public_provider_credentials(p_provider_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = p_provider_id
        AND p.onboarding_status = 'APPROVED'
        AND p.deleted_at IS NULL
        AND p.is_active)
    THEN jsonb_build_object('education', '[]'::jsonb, 'experience', '[]'::jsonb, 'certificates', '[]'::jsonb)
    ELSE jsonb_build_object(
      'education', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', e.id, 'institution', e.institution, 'degree', e.degree,
          'field_of_study', e.field_of_study, 'start_year', e.start_year, 'end_year', e.end_year)
          ORDER BY e.end_year DESC NULLS FIRST, e.start_year DESC NULLS LAST, e.created_at)
        FROM public.provider_education e WHERE e.provider_id = p_provider_id), '[]'::jsonb),
      'experience', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', w.id, 'role_title', w.role_title, 'place', w.place,
          'start_year', w.start_year, 'end_year', w.end_year, 'is_current', w.is_current,
          'description', w.description)
          ORDER BY w.is_current DESC, w.end_year DESC NULLS FIRST, w.start_year DESC NULLS LAST, w.created_at)
        FROM public.provider_work_experience w WHERE w.provider_id = p_provider_id), '[]'::jsonb),
      'certificates', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', c.id, 'title', c.title, 'issuer', c.issuer, 'issued_year', c.issued_year)
          ORDER BY c.issued_year DESC NULLS LAST, c.created_at)
        FROM public.provider_certificates c
        WHERE c.provider_id = p_provider_id AND c.status = 'verified'), '[]'::jsonb))
  END;
$$;
REVOKE ALL ON FUNCTION public.public_provider_credentials(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_provider_credentials(uuid) TO anon, authenticated;

-- 6. Admin review of a certificate.

CREATE OR REPLACE FUNCTION public.admin_review_provider_certificate(
  p_certificate_id uuid,
  p_status text,
  p_note text DEFAULT NULL
)
RETURNS public.provider_certificates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_row public.provider_certificates;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('verified', 'rejected', 'pending') THEN
    RAISE EXCEPTION 'INVALID_CERTIFICATE_STATUS' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'rejected' AND length(btrim(COALESCE(p_note, ''))) < 3 THEN
    RAISE EXCEPTION 'CERTIFICATE_REJECT_REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('famy.credential_review', 'on', true);
  UPDATE public.provider_certificates
     SET status = p_status,
         review_note = NULLIF(btrim(COALESCE(p_note, '')), ''),
         reviewed_by = CASE WHEN p_status = 'pending' THEN NULL ELSE v_uid END,
         reviewed_at = CASE WHEN p_status = 'pending' THEN NULL ELSE now() END
   WHERE id = p_certificate_id
   RETURNING * INTO v_row;
  PERFORM set_config('famy.credential_review', '', true);

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'CERTIFICATE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_provider_certificate(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_provider_certificate(uuid, text, text) TO authenticated;

COMMENT ON TABLE public.provider_education IS 'Provider education entries; public via public_provider_credentials.';
COMMENT ON TABLE public.provider_work_experience IS 'Provider work experience entries; public via public_provider_credentials.';
COMMENT ON TABLE public.provider_certificates IS 'Provider certificates; only status=verified is public. Files in private bucket provider-credentials.';
