-- Patch 2 / Module 2: Service Requirements and Provider-Service Approval.
-- Additive only.
--
-- Also fixes a real interaction bug introduced by Patch 2 / Module 1
-- (20260713210000): "ps_provider_manage" WITH CHECK hardcoded
-- `status = 'pending'`, which was meant to stop a provider self-approving,
-- but as a side effect also blocked a provider from ever updating their own
-- price_override once already approved (any UPDATE by the provider had to
-- leave NEW.status = 'pending' to pass the check, which an approved row
-- never satisfies). Replaced with ownership-only RLS + a trigger that
-- specifically blocks status changes — the same pattern already used for
-- bookings.status via tg_validate_booking_transition.

-- ============================================================
-- 1) provider_services: fix the RLS/status interaction, and (further down,
-- after service_requirements exists) gate approval on mandatory requirements.
-- ============================================================
DROP POLICY IF EXISTS "ps_provider_manage" ON public.provider_services;
CREATE POLICY "ps_provider_manage" ON public.provider_services FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()))
  WITH CHECK (EXISTS(SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()));

-- ============================================================
-- 2) Service requirements catalog.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.service_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  description_en text,
  description_ar text,
  requirement_type text NOT NULL CHECK (requirement_type IN ('equipment','supplies','certification','training','experience','other')),
  required_for_provider_approval boolean NOT NULL DEFAULT false,
  required_during_booking boolean NOT NULL DEFAULT false,
  fulfillment_mode text NOT NULL DEFAULT 'provider' CHECK (fulfillment_mode IN ('customer','provider','either')),
  provider_extra_fee numeric(10,2) NOT NULL DEFAULT 0 CHECK (provider_extra_fee >= 0),
  evidence_required boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, code)
);
CREATE INDEX IF NOT EXISTS idx_service_requirements_service ON public.service_requirements(service_id, sort_order);
GRANT SELECT ON public.service_requirements TO anon, authenticated;
GRANT ALL ON public.service_requirements TO service_role;
ALTER TABLE public.service_requirements ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_service_requirements_updated BEFORE UPDATE ON public.service_requirements
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP POLICY IF EXISTS "sr_public_read" ON public.service_requirements;
CREATE POLICY "sr_public_read" ON public.service_requirements FOR SELECT TO anon, authenticated USING (is_active);
DROP POLICY IF EXISTS "sr_admin_all" ON public.service_requirements;
CREATE POLICY "sr_admin_all" ON public.service_requirements FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 3) Provider declarations / evidence / admin review, per (provider, requirement).
-- Evidence files reuse the existing 'provider-documents' storage bucket and
-- its RLS (path-prefixed by provider_id) — no new bucket needed.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.provider_requirement_fulfillments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  requirement_id uuid NOT NULL REFERENCES public.service_requirements(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','passed','failed','waived')),
  evidence_storage_path text,
  notes text,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, requirement_id)
);
CREATE INDEX IF NOT EXISTS idx_prf_provider ON public.provider_requirement_fulfillments(provider_id);
CREATE INDEX IF NOT EXISTS idx_prf_requirement ON public.provider_requirement_fulfillments(requirement_id);
GRANT SELECT, INSERT, UPDATE ON public.provider_requirement_fulfillments TO authenticated;
GRANT ALL ON public.provider_requirement_fulfillments TO service_role;
ALTER TABLE public.provider_requirement_fulfillments ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_prf_updated BEFORE UPDATE ON public.provider_requirement_fulfillments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP POLICY IF EXISTS "prf_provider_read" ON public.provider_requirement_fulfillments;
CREATE POLICY "prf_provider_read" ON public.provider_requirement_fulfillments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()));
DROP POLICY IF EXISTS "prf_provider_write" ON public.provider_requirement_fulfillments;
CREATE POLICY "prf_provider_write" ON public.provider_requirement_fulfillments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()));
DROP POLICY IF EXISTS "prf_admin_all" ON public.provider_requirement_fulfillments;
CREATE POLICY "prf_admin_all" ON public.provider_requirement_fulfillments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Providers can declare/upload evidence freely, but can never approve
-- themselves — only admin may set status away from 'pending', and
-- reviewed_by/at are always server-stamped from the acting admin.
CREATE OR REPLACE FUNCTION public.tg_guard_requirement_fulfillment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending' AND NOT v_is_admin THEN
      RAISE EXCEPTION 'Requirement fulfillment must start pending.' USING ERRCODE = '42501';
    END IF;
    IF NOT v_is_admin THEN
      NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.review_notes := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admin can review and set requirement status.' USING ERRCODE = '42501';
  END IF;
  IF v_is_admin AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.reviewed_by := auth.uid();
    NEW.reviewed_at := now();
  ELSIF NOT v_is_admin THEN
    NEW.reviewed_by := OLD.reviewed_by; NEW.reviewed_at := OLD.reviewed_at; NEW.review_notes := OLD.review_notes;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_requirement_fulfillment ON public.provider_requirement_fulfillments;
CREATE TRIGGER trg_guard_requirement_fulfillment
  BEFORE INSERT OR UPDATE ON public.provider_requirement_fulfillments
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_requirement_fulfillment();

DROP TRIGGER IF EXISTS trg_audit_requirement_fulfillment ON public.provider_requirement_fulfillments;
CREATE TRIGGER trg_audit_requirement_fulfillment AFTER INSERT OR UPDATE OR DELETE ON public.provider_requirement_fulfillments
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes();

-- ============================================================
-- 4) provider_services: block self-approval the same way, and gate
-- transitions INTO 'approved' on every mandatory active requirement being
-- passed/waived. Existing approved rows are never touched by this — it
-- only runs when status is actively changing to 'approved'.
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_guard_provider_services()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin');
  v_becoming_approved boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending' AND NOT v_is_admin THEN
      RAISE EXCEPTION 'New service requests must start pending.' USING ERRCODE = '42501';
    END IF;
    v_becoming_approved := (NEW.status = 'approved');
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT v_is_admin THEN
      RAISE EXCEPTION 'Only admin can change service approval status.' USING ERRCODE = '42501';
    END IF;
    v_becoming_approved := (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved');
  END IF;

  IF v_becoming_approved AND EXISTS (
    SELECT 1 FROM public.service_requirements sr
    WHERE sr.service_id = NEW.service_id AND sr.is_active AND sr.required_for_provider_approval
      AND NOT EXISTS (
        SELECT 1 FROM public.provider_requirement_fulfillments prf
        WHERE prf.provider_id = NEW.provider_id AND prf.requirement_id = sr.id AND prf.status IN ('passed','waived')
      )
  ) THEN
    RAISE EXCEPTION 'This provider has not completed all mandatory requirements for this service.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_provider_services ON public.provider_services;
CREATE TRIGGER trg_guard_provider_services
  BEFORE INSERT OR UPDATE ON public.provider_services
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_provider_services();

-- A newly added/activated mandatory requirement never revokes an existing
-- approval — it only flags it (reusing provider_services.flagged_for_review
-- from Patch 2 / Module 1) for admin to review.
CREATE OR REPLACE FUNCTION public.tg_flag_provider_services_on_new_requirement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_active AND NEW.required_for_provider_approval THEN
    UPDATE public.provider_services ps
      SET flagged_for_review = true
      WHERE ps.service_id = NEW.service_id
        AND ps.status = 'approved'
        AND NOT EXISTS (
          SELECT 1 FROM public.provider_requirement_fulfillments prf
          WHERE prf.provider_id = ps.provider_id AND prf.requirement_id = NEW.id AND prf.status IN ('passed','waived')
        );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_flag_on_new_requirement ON public.service_requirements;
CREATE TRIGGER trg_flag_on_new_requirement
  AFTER INSERT OR UPDATE OF is_active, required_for_provider_approval ON public.service_requirements
  FOR EACH ROW EXECUTE FUNCTION public.tg_flag_provider_services_on_new_requirement();

-- ============================================================
-- 5) Booking-time requirement selection: immutable snapshot + fee capture.
-- ============================================================
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS requirement_selections jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.booking_requirement_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  requirement_id uuid REFERENCES public.service_requirements(id) ON DELETE SET NULL,
  requirement_code text NOT NULL,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  fulfillment_mode text NOT NULL,
  chosen_by text NOT NULL CHECK (chosen_by IN ('customer','provider')),
  extra_fee numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_booking_requirement_selections_booking ON public.booking_requirement_selections(booking_id);

GRANT SELECT ON public.booking_requirement_selections TO authenticated;
GRANT ALL ON public.booking_requirement_selections TO service_role;
ALTER TABLE public.booking_requirement_selections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brs_customer_read" ON public.booking_requirement_selections;
CREATE POLICY "brs_customer_read" ON public.booking_requirement_selections FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.customer_id = auth.uid()));

-- "Provider sees selected requirements after confirmation" — same
-- status-windowed access as booking_locations.
DROP POLICY IF EXISTS "brs_provider_read" ON public.booking_requirement_selections;
CREATE POLICY "brs_provider_read" ON public.booking_requirement_selections FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b JOIN public.providers p ON p.id = b.provider_id
      WHERE b.id = booking_id AND p.profile_id = auth.uid()
        AND b.status IN ('confirmed','on_the_way','arrived','arrival_confirmed','in_progress','completion_requested')
    )
  );
DROP POLICY IF EXISTS "brs_admin_all" ON public.booking_requirement_selections;
CREATE POLICY "brs_admin_all" ON public.booking_requirement_selections FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.tg_block_booking_requirement_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'booking_requirement_selections rows are immutable' USING ERRCODE = '42501';
END; $$;
DROP TRIGGER IF EXISTS trg_booking_requirement_selections_immutable ON public.booking_requirement_selections;
CREATE TRIGGER trg_booking_requirement_selections_immutable
  BEFORE UPDATE ON public.booking_requirement_selections
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_booking_requirement_mutation();

-- ============================================================
-- 6) Booking creation: validate mandatory choices + extras cap, then
-- extends tg_validate_booking_service (BEFORE INSERT) once more.
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_validate_booking_service()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_addr RECORD;
  v_zone RECORD;
  v_service RECORD;
  v_ps RECORD;
  v_provider_hourly_rate numeric(10,2);
  v_rate numeric(10,2);
  v_hours numeric;
  v_expected_subtotal numeric(10,2);
  v_req RECORD;
  v_selection jsonb;
  v_extras_total numeric(10,2) := 0;
BEGIN
  SELECT * INTO v_service FROM public.services WHERE id = NEW.service_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected service is not currently available.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_ps FROM public.provider_services
    WHERE provider_id = NEW.provider_id AND service_id = NEW.service_id AND status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This provider is not approved to offer the selected service.' USING ERRCODE = '23514';
  END IF;

  IF NEW.address_id IS NULL THEN
    RAISE EXCEPTION 'A saved address with a valid location is required to book.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_addr FROM public.addresses WHERE id = NEW.address_id;
  IF NOT FOUND OR v_addr.lat IS NULL OR v_addr.lng IS NULL THEN
    RAISE EXCEPTION 'Selected address has no valid location coordinates.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_zone FROM public.resolve_zone(v_addr.lat, v_addr.lng);
  IF v_zone.zone_id IS NULL THEN
    RAISE EXCEPTION 'This area is not currently served.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.zone_services zs WHERE zs.zone_id = v_zone.zone_id AND zs.service_id = NEW.service_id) THEN
    RAISE EXCEPTION 'The selected service is not offered in this area.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.zone_providers zp WHERE zp.zone_id = v_zone.zone_id AND zp.provider_id = NEW.provider_id) THEN
    RAISE EXCEPTION 'This provider does not serve the selected area.' USING ERRCODE = '23514';
  END IF;

  -- ---- Provider price validation ----
  SELECT hourly_rate INTO v_provider_hourly_rate FROM public.providers WHERE id = NEW.provider_id;
  v_rate := COALESCE(v_ps.price_override, v_provider_hourly_rate);
  IF v_ps.price_override IS NOT NULL THEN
    IF NOT v_service.provider_pricing_allowed
       OR (v_service.minimum_price IS NOT NULL AND v_rate < v_service.minimum_price)
       OR (v_service.maximum_price IS NOT NULL AND v_rate > v_service.maximum_price)
    THEN
      RAISE EXCEPTION 'This provider''s price for the selected service no longer meets current pricing rules.' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_service.pricing_model = 'hourly' THEN
    v_hours := EXTRACT(EPOCH FROM (NEW.end_at - NEW.start_at)) / 3600.0;
    v_expected_subtotal := ROUND(v_rate * v_hours, 2);
  ELSE
    v_expected_subtotal := v_rate;
  END IF;

  IF ABS(NEW.price_subtotal - v_expected_subtotal) > 0.01 THEN
    RAISE EXCEPTION 'Booking price does not match the current service price.' USING ERRCODE = '23514';
  END IF;

  -- ---- Requirements: mandatory choices + extras cap (server-computed,
  -- never trusting a client-supplied fee) ----
  FOR v_req IN
    SELECT * FROM public.service_requirements WHERE service_id = NEW.service_id AND is_active AND required_during_booking
  LOOP
    IF v_req.fulfillment_mode = 'provider' THEN
      v_extras_total := v_extras_total + v_req.provider_extra_fee;
    ELSIF v_req.fulfillment_mode = 'either' THEN
      SELECT elem INTO v_selection FROM jsonb_array_elements(COALESCE(NEW.requirement_selections, '[]'::jsonb)) elem
        WHERE (elem->>'requirement_id')::uuid = v_req.id LIMIT 1;
      IF v_selection IS NULL OR (v_selection->>'chosen_by') NOT IN ('customer', 'provider') THEN
        RAISE EXCEPTION 'A choice is required for: %', v_req.name_en USING ERRCODE = '23514';
      END IF;
      IF v_selection->>'chosen_by' = 'provider' THEN
        v_extras_total := v_extras_total + v_req.provider_extra_fee;
      END IF;
    END IF;
  END LOOP;

  IF v_service.maximum_extras_total IS NOT NULL AND v_extras_total > v_service.maximum_extras_total THEN
    RAISE EXCEPTION 'Selected extras exceed the maximum allowed for this service.' USING ERRCODE = '23514';
  END IF;

  PERFORM public.check_booking_slot(NEW.provider_id, NEW.start_at, NEW.end_at, NULL);

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_validate_booking_service() FROM PUBLIC, anon, authenticated;

-- Populates the immutable per-requirement snapshot once the booking row
-- exists — re-derives the same chosen_by/fee the BEFORE trigger already
-- validated, so this never fails for a booking that was actually created.
CREATE OR REPLACE FUNCTION public.tg_booking_requirement_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req RECORD;
  v_selection jsonb;
  v_chosen text;
  v_fee numeric(10,2);
BEGIN
  FOR v_req IN
    SELECT * FROM public.service_requirements WHERE service_id = NEW.service_id AND is_active AND required_during_booking
  LOOP
    IF v_req.fulfillment_mode = 'customer' THEN
      v_chosen := 'customer'; v_fee := 0;
    ELSIF v_req.fulfillment_mode = 'provider' THEN
      v_chosen := 'provider'; v_fee := v_req.provider_extra_fee;
    ELSE
      SELECT elem INTO v_selection FROM jsonb_array_elements(COALESCE(NEW.requirement_selections, '[]'::jsonb)) elem
        WHERE (elem->>'requirement_id')::uuid = v_req.id LIMIT 1;
      v_chosen := COALESCE(v_selection->>'chosen_by', 'customer');
      v_fee := CASE WHEN v_chosen = 'provider' THEN v_req.provider_extra_fee ELSE 0 END;
    END IF;

    INSERT INTO public.booking_requirement_selections (
      booking_id, requirement_id, requirement_code, name_en, name_ar, fulfillment_mode, chosen_by, extra_fee
    ) VALUES (
      NEW.id, v_req.id, v_req.code, v_req.name_en, v_req.name_ar, v_req.fulfillment_mode, v_chosen, v_fee
    );
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_booking_requirement_snapshot ON public.bookings;
CREATE TRIGGER trg_booking_requirement_snapshot
  AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_requirement_snapshot();
