-- Patch 1 / Module 1: Saved Addresses and Customer Location.
-- Additive only. Existing `addresses` rows are normalized in place (label
-- backfilled into the new enum, never dropped), never deleted.

-- ============================================================
-- 1) Addresses: structured fields
-- ============================================================
ALTER TABLE public.addresses
  ADD COLUMN IF NOT EXISTS custom_label text,
  ADD COLUMN IF NOT EXISTS street text,
  ADD COLUMN IF NOT EXISTS building text,
  ADD COLUMN IF NOT EXISTS floor text,
  ADD COLUMN IF NOT EXISTS apartment text,
  ADD COLUMN IF NOT EXISTS compound text,
  ADD COLUMN IF NOT EXISTS landmark text,
  ADD COLUMN IF NOT EXISTS access_notes text;

-- Normalize existing free-text labels (e.g. "Home") into the canonical
-- enum, preserving the original text in custom_label so nothing is lost.
UPDATE public.addresses
  SET custom_label = COALESCE(custom_label, label),
      label = 'other'
  WHERE label IS NULL OR lower(label) NOT IN ('home','work','family','other');
UPDATE public.addresses SET label = lower(label) WHERE label IN ('HOME','Home','WORK','Work','FAMILY','Family','OTHER','Other');

ALTER TABLE public.addresses ALTER COLUMN label SET DEFAULT 'other';
ALTER TABLE public.addresses ALTER COLUMN label SET NOT NULL;
ALTER TABLE public.addresses DROP CONSTRAINT IF EXISTS addresses_label_check;
ALTER TABLE public.addresses ADD CONSTRAINT addresses_label_check
  CHECK (label IN ('home','work','family','other'));

-- Coordinates, when present, must be real-world valid. NOT VALID so
-- historical rows with partial/garbage data are never retroactively broken;
-- every new write is still checked.
ALTER TABLE public.addresses DROP CONSTRAINT IF EXISTS addresses_coords_check;
ALTER TABLE public.addresses ADD CONSTRAINT addresses_coords_check
  CHECK (
    (lat IS NULL AND lng IS NULL) OR
    (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)
  ) NOT VALID;

-- ============================================================
-- 2) Exactly one default address per customer
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_addresses_single_default()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE public.addresses SET is_default = false
      WHERE user_id = NEW.user_id AND id <> NEW.id AND is_default;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_addresses_single_default ON public.addresses;
CREATE TRIGGER trg_addresses_single_default
  BEFORE INSERT OR UPDATE OF is_default ON public.addresses
  FOR EACH ROW WHEN (NEW.is_default) EXECUTE FUNCTION public.tg_addresses_single_default();

-- Authoritative concurrency guard behind the trigger above (a genuine race
-- between two concurrent "set default" calls surfaces as 23505, never as
-- two simultaneous defaults).
DROP INDEX IF EXISTS addresses_one_default_per_user;
CREATE UNIQUE INDEX addresses_one_default_per_user ON public.addresses(user_id) WHERE is_default;

-- Admin read access for support/disputes (customer-only self policy already existed).
DROP POLICY IF EXISTS "addresses_admin_read" ON public.addresses;
CREATE POLICY "addresses_admin_read" ON public.addresses FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 3) Immutable per-booking address snapshot
-- ============================================================
CREATE TABLE IF NOT EXISTS public.booking_locations (
  booking_id uuid PRIMARY KEY REFERENCES public.bookings(id) ON DELETE CASCADE,
  address_id uuid REFERENCES public.addresses(id) ON DELETE SET NULL,
  label text NOT NULL,
  custom_label text,
  city text NOT NULL,
  area text,
  street text,
  building text,
  floor text,
  apartment text,
  compound text,
  landmark text,
  access_notes text,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.tg_block_booking_location_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'booking_locations rows are immutable' USING ERRCODE = '42501';
END; $$;
DROP TRIGGER IF EXISTS trg_booking_locations_immutable ON public.booking_locations;
CREATE TRIGGER trg_booking_locations_immutable
  BEFORE UPDATE ON public.booking_locations
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_booking_location_mutation();

GRANT SELECT ON public.booking_locations TO authenticated;
GRANT ALL ON public.booking_locations TO service_role;
ALTER TABLE public.booking_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_locations_customer_read" ON public.booking_locations;
CREATE POLICY "booking_locations_customer_read" ON public.booking_locations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.customer_id = auth.uid()));

-- Provider sees the snapshot only while the booking is in an active,
-- in-progress-adjacent status; access ends the instant status moves past it.
DROP POLICY IF EXISTS "booking_locations_provider_read" ON public.booking_locations;
CREATE POLICY "booking_locations_provider_read" ON public.booking_locations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.providers p ON p.id = b.provider_id
      WHERE b.id = booking_id
        AND p.profile_id = auth.uid()
        AND b.status IN ('confirmed','on_the_way','arrived','arrival_confirmed','in_progress','completion_requested')
    )
  );

DROP POLICY IF EXISTS "booking_locations_admin_all" ON public.booking_locations;
CREATE POLICY "booking_locations_admin_all" ON public.booking_locations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Snapshot is captured server-side, atomically, at booking creation — never
-- client-supplied, so it can't be forged or skipped.
CREATE OR REPLACE FUNCTION public.tg_booking_location_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_addr RECORD;
BEGIN
  IF NEW.address_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_addr FROM public.addresses WHERE id = NEW.address_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_addr.lat IS NULL OR v_addr.lng IS NULL THEN
    RAISE EXCEPTION 'Selected address has no valid location coordinates' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.booking_locations (
    booking_id, address_id, label, custom_label, city, area, street, building,
    floor, apartment, compound, landmark, access_notes, lat, lng
  ) VALUES (
    NEW.id, v_addr.id, v_addr.label, v_addr.custom_label, v_addr.city, v_addr.area, v_addr.street, v_addr.building,
    v_addr.floor, v_addr.apartment, v_addr.compound, v_addr.landmark, v_addr.access_notes, v_addr.lat, v_addr.lng
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_booking_location_snapshot ON public.bookings;
CREATE TRIGGER trg_booking_location_snapshot
  AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_location_snapshot();

-- address_id is part of a booking's locked identity, same as provider/service/schedule/price.
CREATE OR REPLACE FUNCTION public.tg_validate_booking_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_customer boolean := false;
  v_is_provider boolean := false;
  v_is_admin boolean := false;
  v_allowed boolean := false;
  v_changing boolean := (NEW.status IS DISTINCT FROM OLD.status);
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
     OR NEW.service_id IS DISTINCT FROM OLD.service_id
     OR NEW.address_id IS DISTINCT FROM OLD.address_id
     OR NEW.start_at IS DISTINCT FROM OLD.start_at
     OR NEW.end_at IS DISTINCT FROM OLD.end_at
     OR NEW.price_subtotal IS DISTINCT FROM OLD.price_subtotal
     OR NEW.price_discount IS DISTINCT FROM OLD.price_discount
     OR NEW.price_total IS DISTINCT FROM OLD.price_total
  THEN
    RAISE EXCEPTION 'Booking customer, provider, service, address, schedule, and pricing cannot be changed after creation.'
      USING ERRCODE = '42501';
  END IF;

  IF v_changing THEN
    v_is_customer := (OLD.customer_id = v_uid);
    v_is_provider := EXISTS (
      SELECT 1 FROM public.providers p WHERE p.id = OLD.provider_id AND p.profile_id = v_uid
    );
    v_is_admin := public.has_role(v_uid, 'admin');

    IF v_is_admin AND (
         (OLD.status = 'disputed' AND NEW.status IN ('completed', 'cancelled'))
      OR (OLD.status = 'no_show' AND NEW.status IN ('completed', 'cancelled'))
    ) THEN
      v_allowed := true;
    END IF;

    IF NOT v_allowed AND v_is_provider AND (
         (OLD.status = 'pending' AND NEW.status = 'confirmed')
      OR (OLD.status = 'pending' AND NEW.status = 'cancelled')
      OR (OLD.status = 'confirmed' AND NEW.status = 'on_the_way')
      OR (OLD.status = 'confirmed' AND NEW.status = 'cancelled')
      OR (OLD.status = 'on_the_way' AND NEW.status = 'arrived')
      OR (OLD.status = 'on_the_way' AND NEW.status = 'no_show' AND NEW.no_show_party = 'customer')
      OR (OLD.status = 'arrived' AND NEW.status = 'no_show' AND NEW.no_show_party = 'customer')
      OR (OLD.status = 'arrival_confirmed' AND NEW.status = 'in_progress')
      OR (OLD.status = 'in_progress' AND NEW.status = 'completion_requested')
    ) THEN
      v_allowed := true;
    END IF;

    IF NOT v_allowed AND v_is_customer AND (
         (OLD.status = 'pending' AND NEW.status = 'cancelled')
      OR (OLD.status = 'confirmed' AND NEW.status = 'cancelled')
      OR (OLD.status = 'on_the_way' AND NEW.status = 'no_show' AND NEW.no_show_party = 'provider')
      OR (OLD.status = 'arrived' AND NEW.status = 'arrival_confirmed')
      OR (OLD.status = 'arrived' AND NEW.status = 'no_show' AND NEW.no_show_party = 'provider')
      OR (OLD.status = 'completion_requested' AND NEW.status = 'completed')
      OR (OLD.status = 'completion_requested' AND NEW.status = 'disputed')
    ) THEN
      v_allowed := true;
    END IF;

    IF NOT v_allowed THEN
      RAISE EXCEPTION 'Booking transition % -> % is not permitted for this user', OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.status_changed_at := CASE WHEN v_changing THEN now() ELSE OLD.status_changed_at END;
  NEW.status_changed_by := CASE WHEN v_changing THEN v_uid ELSE OLD.status_changed_by END;

  NEW.completion_requested_at := CASE WHEN v_changing AND NEW.status = 'completion_requested' THEN now() ELSE OLD.completion_requested_at END;
  NEW.completed_at := CASE WHEN v_changing AND NEW.status = 'completed' THEN now() ELSE OLD.completed_at END;

  IF v_changing AND NEW.status = 'arrival_confirmed' THEN
    NEW.arrival_confirmed_at := now();
    NEW.arrival_confirmed_by := v_uid;
  ELSE
    NEW.arrival_confirmed_at := OLD.arrival_confirmed_at;
    NEW.arrival_confirmed_by := OLD.arrival_confirmed_by;
  END IF;

  IF v_changing AND NEW.status = 'cancelled' THEN
    NEW.cancelled_at := now();
    NEW.cancelled_by := v_uid;
  ELSE
    NEW.cancelled_at := OLD.cancelled_at;
    NEW.cancelled_by := OLD.cancelled_by;
    NEW.cancellation_reason := OLD.cancellation_reason;
  END IF;

  IF v_changing AND NEW.status = 'no_show' THEN
    NEW.no_show_reported_by := v_uid;
  ELSE
    NEW.no_show_party := OLD.no_show_party;
    NEW.no_show_reported_by := OLD.no_show_reported_by;
    NEW.no_show_reason := OLD.no_show_reason;
  END IF;

  IF v_changing AND NEW.status = 'disputed' THEN
    NEW.disputed_at := now();
  ELSE
    NEW.disputed_at := OLD.disputed_at;
    NEW.dispute_reason := OLD.dispute_reason;
  END IF;

  IF v_changing AND v_is_admin AND OLD.status = 'disputed' AND NEW.status IN ('completed', 'cancelled') THEN
    NEW.dispute_resolved_at := now();
    NEW.dispute_resolved_by := v_uid;
  ELSE
    NEW.dispute_resolved_at := OLD.dispute_resolved_at;
    NEW.dispute_resolved_by := OLD.dispute_resolved_by;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_validate_booking_transition() FROM PUBLIC, anon, authenticated;
