-- Patch 1 / Module 2: Admin Zones and Provider Coverage.
-- No PostGIS on this project (only btree_gist) — zones use a validated
-- center point + radius_km, resolved via haversine distance. Additive only.

-- ============================================================
-- 1) Zones
-- ============================================================
CREATE TABLE IF NOT EXISTS public.zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en text NOT NULL,
  name_ar text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  center_lat double precision NOT NULL CHECK (center_lat BETWEEN -90 AND 90),
  center_lng double precision NOT NULL CHECK (center_lng BETWEEN -180 AND 180),
  radius_km numeric(6,2) NOT NULL CHECK (radius_km > 0),
  travel_fee numeric(10,2) NOT NULL DEFAULT 0 CHECK (travel_fee >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.zones TO anon, authenticated;
GRANT ALL ON public.zones TO service_role;
ALTER TABLE public.zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "zones_public_read" ON public.zones FOR SELECT TO anon, authenticated USING (is_active);
CREATE POLICY "zones_admin_all" ON public.zones FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_zones_updated BEFORE UPDATE ON public.zones FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Service coverage per zone.
CREATE TABLE IF NOT EXISTS public.zone_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (zone_id, service_id)
);
CREATE INDEX IF NOT EXISTS idx_zone_services_zone ON public.zone_services(zone_id);
CREATE INDEX IF NOT EXISTS idx_zone_services_service ON public.zone_services(service_id);
GRANT SELECT ON public.zone_services TO anon, authenticated;
GRANT ALL ON public.zone_services TO service_role;
ALTER TABLE public.zone_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "zone_services_public_read" ON public.zone_services FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "zone_services_admin_all" ON public.zone_services FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Provider coverage per zone.
CREATE TABLE IF NOT EXISTS public.zone_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (zone_id, provider_id)
);
CREATE INDEX IF NOT EXISTS idx_zone_providers_zone ON public.zone_providers(zone_id);
CREATE INDEX IF NOT EXISTS idx_zone_providers_provider ON public.zone_providers(provider_id);
GRANT SELECT ON public.zone_providers TO anon, authenticated;
GRANT ALL ON public.zone_providers TO service_role;
ALTER TABLE public.zone_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "zone_providers_public_read" ON public.zone_providers FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "zone_providers_admin_all" ON public.zone_providers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 2) Zone resolution — nearest active zone whose radius contains the point.
-- Haversine great-circle distance in km; no PostGIS required.
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_zone(p_lat double precision, p_lng double precision)
RETURNS TABLE (zone_id uuid, name_en text, name_ar text, travel_fee numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT z.id, z.name_en, z.name_ar, z.travel_fee
  FROM public.zones z
  WHERE z.is_active
    AND p_lat IS NOT NULL AND p_lng IS NOT NULL
    AND (
      6371 * acos(
        LEAST(1, GREATEST(-1,
          cos(radians(p_lat)) * cos(radians(z.center_lat)) * cos(radians(z.center_lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(z.center_lat))
        ))
      )
    ) <= z.radius_km
  ORDER BY (
    6371 * acos(
      LEAST(1, GREATEST(-1,
        cos(radians(p_lat)) * cos(radians(z.center_lat)) * cos(radians(z.center_lng) - radians(p_lng))
        + sin(radians(p_lat)) * sin(radians(z.center_lat))
      ))
    )
  ) ASC
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_zone(double precision, double precision) TO anon, authenticated;

-- ============================================================
-- 3) Booking snapshot gains zone fields (additive columns on the immutable
-- snapshot table added in Module 1).
-- ============================================================
ALTER TABLE public.booking_locations
  ADD COLUMN IF NOT EXISTS zone_id uuid REFERENCES public.zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS zone_name_en text,
  ADD COLUMN IF NOT EXISTS zone_name_ar text,
  ADD COLUMN IF NOT EXISTS travel_fee numeric(10,2);

CREATE OR REPLACE FUNCTION public.tg_booking_location_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_addr RECORD;
  v_zone RECORD;
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

  SELECT * INTO v_zone FROM public.resolve_zone(v_addr.lat, v_addr.lng);

  INSERT INTO public.booking_locations (
    booking_id, address_id, label, custom_label, city, area, street, building,
    floor, apartment, compound, landmark, access_notes, lat, lng,
    zone_id, zone_name_en, zone_name_ar, travel_fee
  ) VALUES (
    NEW.id, v_addr.id, v_addr.label, v_addr.custom_label, v_addr.city, v_addr.area, v_addr.street, v_addr.building,
    v_addr.floor, v_addr.apartment, v_addr.compound, v_addr.landmark, v_addr.access_notes, v_addr.lat, v_addr.lng,
    v_zone.zone_id, v_zone.name_en, v_zone.name_ar, v_zone.travel_fee
  );
  RETURN NEW;
END; $$;

-- ============================================================
-- 4) Booking-creation zone enforcement — extends the existing
-- trg_validate_booking_service / tg_validate_booking_service BEFORE INSERT
-- guard (supabase/migrations/20260712160000_inactive-service-booking-safety.sql)
-- with zone checks. zone_id is never accepted from the client — it is
-- always resolved server-side from the address, so it cannot be spoofed.
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_validate_booking_service()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_addr RECORD;
  v_zone RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.services s WHERE s.id = NEW.service_id AND s.is_active = true
  ) THEN
    RAISE EXCEPTION 'Selected service is not currently available.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.provider_services ps
    WHERE ps.provider_id = NEW.provider_id
      AND ps.service_id = NEW.service_id
      AND ps.status = 'approved'
  ) THEN
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

  IF NOT EXISTS (
    SELECT 1 FROM public.zone_services zs WHERE zs.zone_id = v_zone.zone_id AND zs.service_id = NEW.service_id
  ) THEN
    RAISE EXCEPTION 'The selected service is not offered in this area.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.zone_providers zp WHERE zp.zone_id = v_zone.zone_id AND zp.provider_id = NEW.provider_id
  ) THEN
    RAISE EXCEPTION 'This provider does not serve the selected area.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_validate_booking_service() FROM PUBLIC, anon, authenticated;
