
-- =========================================================
-- 1. VERIFICATION WORKFLOW
-- =========================================================
ALTER TYPE verification_status ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE verification_status ADD VALUE IF NOT EXISTS 'renewal_required';

ALTER TABLE public.verification_records
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_required_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_reason text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id);

ALTER TABLE public.provider_documents
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_reason text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_verification_records_expires ON public.verification_records(expires_at) WHERE expires_at IS NOT NULL;

-- =========================================================
-- 2. AVAILABILITY ENGINE
-- =========================================================
ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS buffer_minutes integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS min_notice_hours integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS max_advance_days integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS vacation_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.availability_exceptions
  ADD COLUMN IF NOT EXISTS end_date date;

UPDATE public.availability_exceptions SET end_date = date WHERE end_date IS NULL;

CREATE TABLE IF NOT EXISTS public.provider_vacations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_vacations TO authenticated;
GRANT SELECT ON public.provider_vacations TO anon;
GRANT ALL ON public.provider_vacations TO service_role;
ALTER TABLE public.provider_vacations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vacations readable by all" ON public.provider_vacations FOR SELECT USING (true);
CREATE POLICY "providers manage own vacations" ON public.provider_vacations
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid())
    OR public.has_role(auth.uid(),'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid())
    OR public.has_role(auth.uid(),'admin')
  );

CREATE INDEX IF NOT EXISTS idx_provider_vacations_provider ON public.provider_vacations(provider_id, start_date, end_date);

-- =========================================================
-- 3. TRUST ENGINE
-- =========================================================
ALTER TABLE public.trust_scores
  ADD COLUMN IF NOT EXISTS review_score numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completion_score numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS verification_score numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS response_score numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS repeat_score numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reliability_score numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tenure_score numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS incidents_score numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_bookings integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_bookings integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_bookings integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS no_show_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS incident_count integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  CREATE TYPE incident_severity AS ENUM ('low','medium','high','critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE incident_status AS ENUM ('open','investigating','resolved','dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.provider_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  reported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL,
  severity incident_severity NOT NULL DEFAULT 'low',
  status incident_status NOT NULL DEFAULT 'open',
  description text,
  resolution text,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_incidents TO authenticated;
GRANT ALL ON public.provider_incidents TO service_role;
ALTER TABLE public.provider_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "incidents visible to admin and provider"
  ON public.provider_incidents FOR SELECT
  USING (
    public.has_role(auth.uid(),'admin')
    OR EXISTS (SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid())
    OR reported_by = auth.uid()
  );
CREATE POLICY "users can report incidents"
  ON public.provider_incidents FOR INSERT
  WITH CHECK (auth.uid() = reported_by);
CREATE POLICY "admins manage incidents"
  ON public.provider_incidents FOR UPDATE
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_incidents_updated_at BEFORE UPDATE ON public.provider_incidents
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_provider_incidents_provider ON public.provider_incidents(provider_id, status);

-- Trust score recompute function
CREATE OR REPLACE FUNCTION public.recompute_trust_score(_provider_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review numeric := 0;
  v_review_count int := 0;
  v_total int := 0;
  v_completed int := 0;
  v_cancelled int := 0;
  v_no_show int := 0;
  v_incidents int := 0;
  v_tenure_days int := 0;
  v_repeat int := 0;
  v_verified boolean := false;
  v_response int := 60;
  s_review numeric; s_completion numeric; s_verification numeric;
  s_response numeric; s_repeat numeric; s_reliability numeric;
  s_tenure numeric; s_incidents numeric; s_total numeric;
BEGIN
  SELECT COALESCE(AVG(rating),0), COUNT(*) INTO v_review, v_review_count
    FROM public.reviews WHERE provider_id = _provider_id;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status='completed'),
    COUNT(*) FILTER (WHERE status='cancelled'),
    COUNT(*) FILTER (WHERE status='no_show')
  INTO v_total, v_completed, v_cancelled, v_no_show
  FROM public.bookings WHERE provider_id = _provider_id;

  SELECT COUNT(*) INTO v_incidents
    FROM public.provider_incidents
    WHERE provider_id = _provider_id AND status IN ('open','investigating');

  SELECT EXTRACT(DAY FROM (now() - created_at))::int, is_verified, COALESCE(response_time_min,60)
    INTO v_tenure_days, v_verified, v_response
    FROM public.providers WHERE id = _provider_id;

  SELECT COALESCE(SUM(c-1),0) INTO v_repeat FROM (
    SELECT customer_id, COUNT(*) c FROM public.bookings
    WHERE provider_id = _provider_id AND status='completed'
    GROUP BY customer_id HAVING COUNT(*) > 1
  ) x;

  s_review       := LEAST(100, (v_review/5.0)*100);
  s_completion   := CASE WHEN v_total=0 THEN 70 ELSE (v_completed::numeric/v_total)*100 END;
  s_verification := CASE WHEN v_verified THEN 100 ELSE 40 END;
  s_response     := GREATEST(0, 100 - v_response); -- 0 min => 100, 100+ min => 0
  s_repeat       := LEAST(100, v_repeat * 10);
  s_reliability  := CASE WHEN v_total=0 THEN 70 ELSE GREATEST(0, 100 - (v_cancelled+v_no_show*2)::numeric*100/GREATEST(v_total,1)) END;
  s_tenure       := LEAST(100, v_tenure_days::numeric / 3.65); -- ~1 year => 100
  s_incidents    := GREATEST(0, 100 - v_incidents * 20);

  s_total := ROUND(
    s_review*0.30 + s_completion*0.18 + s_verification*0.15
    + s_response*0.10 + s_repeat*0.08 + s_reliability*0.10
    + s_tenure*0.04 + s_incidents*0.05, 2);

  INSERT INTO public.trust_scores(
    provider_id, score, components,
    review_score, completion_score, verification_score, response_score,
    repeat_score, reliability_score, tenure_score, incidents_score,
    total_bookings, completed_bookings, cancelled_bookings, no_show_count, incident_count,
    updated_at)
  VALUES (
    _provider_id, s_total,
    jsonb_build_object('review',s_review,'completion',s_completion,'verification',s_verification,
                       'response',s_response,'repeat',s_repeat,'reliability',s_reliability,
                       'tenure',s_tenure,'incidents',s_incidents),
    s_review, s_completion, s_verification, s_response,
    s_repeat, s_reliability, s_tenure, s_incidents,
    v_total, v_completed, v_cancelled, v_no_show, v_incidents,
    now())
  ON CONFLICT (provider_id) DO UPDATE SET
    score=EXCLUDED.score, components=EXCLUDED.components,
    review_score=EXCLUDED.review_score, completion_score=EXCLUDED.completion_score,
    verification_score=EXCLUDED.verification_score, response_score=EXCLUDED.response_score,
    repeat_score=EXCLUDED.repeat_score, reliability_score=EXCLUDED.reliability_score,
    tenure_score=EXCLUDED.tenure_score, incidents_score=EXCLUDED.incidents_score,
    total_bookings=EXCLUDED.total_bookings, completed_bookings=EXCLUDED.completed_bookings,
    cancelled_bookings=EXCLUDED.cancelled_bookings, no_show_count=EXCLUDED.no_show_count,
    incident_count=EXCLUDED.incident_count, updated_at=now();
END $$;

CREATE OR REPLACE FUNCTION public.tg_recompute_trust()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid;
BEGIN
  pid := COALESCE(NEW.provider_id, OLD.provider_id);
  IF pid IS NOT NULL THEN PERFORM public.recompute_trust_score(pid); END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_trust_on_review ON public.reviews;
CREATE TRIGGER trg_trust_on_review AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_trust();

DROP TRIGGER IF EXISTS trg_trust_on_booking ON public.bookings;
CREATE TRIGGER trg_trust_on_booking AFTER INSERT OR UPDATE OF status OR DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_trust();

DROP TRIGGER IF EXISTS trg_trust_on_incident ON public.provider_incidents;
CREATE TRIGGER trg_trust_on_incident AFTER INSERT OR UPDATE OR DELETE ON public.provider_incidents
  FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_trust();

-- =========================================================
-- 4. AUDIT SYSTEM
-- =========================================================
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS ip_address inet,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS old_values jsonb,
  ADD COLUMN IF NOT EXISTS new_values jsonb;

ALTER TABLE public.profiles    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.bookings    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.reviews     ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.services    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE OR REPLACE FUNCTION public.tg_audit_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW); v_id := NEW.id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW); v_id := NEW.id;
    IF v_old = v_new THEN RETURN NEW; END IF;
  ELSE
    v_old := to_jsonb(OLD); v_id := OLD.id;
  END IF;
  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, old_values, new_values, diff)
  VALUES (auth.uid(), TG_OP, TG_TABLE_NAME, v_id, v_old, v_new,
          CASE WHEN TG_OP='UPDATE' THEN v_new - (SELECT jsonb_object_agg(k, v_old->k) FROM jsonb_object_keys(v_old) k WHERE v_old->k = v_new->k) ELSE NULL END);
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_audit_bookings ON public.bookings;
CREATE TRIGGER trg_audit_bookings AFTER INSERT OR UPDATE OR DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

DROP TRIGGER IF EXISTS trg_audit_providers ON public.providers;
CREATE TRIGGER trg_audit_providers AFTER INSERT OR UPDATE OR DELETE ON public.providers
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

DROP TRIGGER IF EXISTS trg_audit_verification ON public.verification_records;
CREATE TRIGGER trg_audit_verification AFTER INSERT OR UPDATE OR DELETE ON public.verification_records
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

DROP TRIGGER IF EXISTS trg_audit_reviews ON public.reviews;
CREATE TRIGGER trg_audit_reviews AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();
