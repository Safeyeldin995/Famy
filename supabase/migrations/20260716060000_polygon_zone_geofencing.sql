-- Polygon geofencing as the primary zone boundary mode. Circle
-- (center + radius) remains as an optional secondary mode — both the
-- existing zones table and resolve_zone() are extended additively so
-- nothing that already depends on circle zones breaks.

ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS boundary_type text NOT NULL DEFAULT 'circle' CHECK (boundary_type IN ('circle', 'polygon')),
  ADD COLUMN IF NOT EXISTS polygon jsonb;

-- polygon is an open ring: a JSON array of {lat,lng} vertices, >= 3 points,
-- not self-intersecting. Required exactly when boundary_type = 'polygon'.
ALTER TABLE public.zones
  ADD CONSTRAINT zones_polygon_required_for_polygon_type
  CHECK (
    (boundary_type = 'circle' AND polygon IS NULL)
    OR (boundary_type = 'polygon' AND polygon IS NOT NULL AND jsonb_array_length(polygon) >= 3)
  );

-- ============================================================
-- Point-in-polygon (ray casting) over a jsonb [{lat,lng}, ...] ring.
-- ============================================================
CREATE OR REPLACE FUNCTION public.point_in_polygon(p_lat double precision, p_lng double precision, p_polygon jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  n int := jsonb_array_length(p_polygon);
  i int;
  j int;
  xi double precision; yi double precision;
  xj double precision; yj double precision;
  inside boolean := false;
BEGIN
  IF n < 3 THEN RETURN false; END IF;
  j := n - 1;
  FOR i IN 0 .. n - 1 LOOP
    xi := (p_polygon -> i ->> 'lng')::double precision;
    yi := (p_polygon -> i ->> 'lat')::double precision;
    xj := (p_polygon -> j ->> 'lng')::double precision;
    yj := (p_polygon -> j ->> 'lat')::double precision;
    IF ((yi > p_lat) <> (yj > p_lat))
       AND (p_lng < (xj - xi) * (p_lat - yi) / NULLIF(yj - yi, 0) + xi)
    THEN
      inside := NOT inside;
    END IF;
    j := i;
  END LOOP;
  RETURN inside;
END;
$$;
GRANT EXECUTE ON FUNCTION public.point_in_polygon(double precision, double precision, jsonb) TO anon, authenticated;

-- ============================================================
-- Segment-intersection self-intersection guard (standard orientation test).
-- ============================================================
CREATE OR REPLACE FUNCTION public._segments_intersect(
  ax double precision, ay double precision, bx double precision, byy double precision,
  cx double precision, cy double precision, dx double precision, dy double precision
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  d1 double precision; d2 double precision; d3 double precision; d4 double precision;
BEGIN
  d1 := (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  d2 := (dx - cx) * (byy - cy) - (dy - cy) * (bx - cx);
  d3 := (bx - ax) * (cy - ay) - (byy - ay) * (cx - ax);
  d4 := (bx - ax) * (dy - ay) - (byy - ay) * (dx - ax);
  RETURN ((d1 > 0 AND d2 < 0) OR (d1 < 0 AND d2 > 0))
     AND ((d3 > 0 AND d4 < 0) OR (d3 < 0 AND d4 > 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.polygon_self_intersects(p_polygon jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  n int := jsonb_array_length(p_polygon);
  i int; k int;
  ax double precision; ay double precision; bx double precision; byy double precision;
  cx double precision; cy double precision; dx double precision; dy double precision;
BEGIN
  IF n < 4 THEN RETURN false; END IF; -- a triangle can't self-intersect
  FOR i IN 0 .. n - 1 LOOP
    ax := (p_polygon -> i ->> 'lng')::double precision;
    ay := (p_polygon -> i ->> 'lat')::double precision;
    bx := (p_polygon -> ((i + 1) % n) ->> 'lng')::double precision;
    byy := (p_polygon -> ((i + 1) % n) ->> 'lat')::double precision;
    FOR k IN i + 2 .. n - 1 LOOP
      IF i = 0 AND k = n - 1 THEN CONTINUE; END IF; -- adjacent closing edge
      cx := (p_polygon -> k ->> 'lng')::double precision;
      cy := (p_polygon -> k ->> 'lat')::double precision;
      dx := (p_polygon -> ((k + 1) % n) ->> 'lng')::double precision;
      dy := (p_polygon -> ((k + 1) % n) ->> 'lat')::double precision;
      IF public._segments_intersect(ax, ay, bx, byy, cx, cy, dx, dy) THEN
        RETURN true;
      END IF;
    END LOOP;
  END LOOP;
  RETURN false;
END;
$$;
GRANT EXECUTE ON FUNCTION public.polygon_self_intersects(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_validate_zone_polygon()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.boundary_type = 'polygon' AND public.polygon_self_intersects(NEW.polygon) THEN
    RAISE EXCEPTION 'This polygon''s edges cross themselves. Redraw without crossing lines.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_zone_polygon
  BEFORE INSERT OR UPDATE ON public.zones
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_zone_polygon();

-- ============================================================
-- Non-blocking overlap check, exposed to Admin as an RPC (warn, don't block).
-- Heuristic: any vertex of one polygon falls inside the other, or vice versa.
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_zone_overlap(p_polygon jsonb, p_exclude_zone_id uuid DEFAULT NULL)
RETURNS TABLE (zone_id uuid, name_en text, name_ar text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT z.id, z.name_en, z.name_ar
  FROM public.zones z
  WHERE z.is_active
    AND z.boundary_type = 'polygon'
    AND (p_exclude_zone_id IS NULL OR z.id <> p_exclude_zone_id)
    AND (
      EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_polygon) v
        WHERE public.point_in_polygon((v ->> 'lat')::double precision, (v ->> 'lng')::double precision, z.polygon)
      )
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(z.polygon) v
        WHERE public.point_in_polygon((v ->> 'lat')::double precision, (v ->> 'lng')::double precision, p_polygon)
      )
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.check_zone_overlap(jsonb, uuid) TO authenticated;

-- ============================================================
-- resolve_zone(): branch on boundary_type. Polygon zones are checked first
-- (more precise), circle zones as the existing nearest-within-radius fallback.
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_zone(p_lat double precision, p_lng double precision)
RETURNS TABLE (zone_id uuid, name_en text, name_ar text, travel_fee numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  (
    SELECT z.id, z.name_en, z.name_ar, z.travel_fee
    FROM public.zones z
    WHERE z.is_active
      AND p_lat IS NOT NULL AND p_lng IS NOT NULL
      AND z.boundary_type = 'polygon'
      AND public.point_in_polygon(p_lat, p_lng, z.polygon)
    LIMIT 1
  )
  UNION ALL
  (
    SELECT z.id, z.name_en, z.name_ar, z.travel_fee
    FROM public.zones z
    WHERE z.is_active
      AND p_lat IS NOT NULL AND p_lng IS NOT NULL
      AND z.boundary_type = 'circle'
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
    LIMIT 1
  )
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_zone(double precision, double precision) TO anon, authenticated;

-- center_lat/lng/radius_km are only meaningful for circle zones now.
ALTER TABLE public.zones ALTER COLUMN center_lat DROP NOT NULL;
ALTER TABLE public.zones ALTER COLUMN center_lng DROP NOT NULL;
ALTER TABLE public.zones ALTER COLUMN radius_km DROP NOT NULL;
ALTER TABLE public.zones DROP CONSTRAINT IF EXISTS zones_center_lat_check;
ALTER TABLE public.zones DROP CONSTRAINT IF EXISTS zones_center_lng_check;
ALTER TABLE public.zones DROP CONSTRAINT IF EXISTS zones_radius_km_check;
ALTER TABLE public.zones ADD CONSTRAINT zones_center_lat_check CHECK (center_lat IS NULL OR center_lat BETWEEN -90 AND 90);
ALTER TABLE public.zones ADD CONSTRAINT zones_center_lng_check CHECK (center_lng IS NULL OR center_lng BETWEEN -180 AND 180);
ALTER TABLE public.zones ADD CONSTRAINT zones_radius_km_check CHECK (radius_km IS NULL OR radius_km > 0);
ALTER TABLE public.zones
  ADD CONSTRAINT zones_circle_fields_required_for_circle_type
  CHECK (
    boundary_type = 'polygon'
    OR (center_lat IS NOT NULL AND center_lng IS NOT NULL AND radius_km IS NOT NULL)
  );
