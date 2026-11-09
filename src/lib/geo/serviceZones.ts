/**
 * Client-side mirror of public.resolve_zone / public.point_in_polygon so the
 * address screens can tie the chosen area to the map pin before saving.
 */

export type LatLng = { lat: number; lng: number };

export type ServiceZone = {
  id: string;
  name_en: string;
  name_ar: string;
  boundary_type: string | null;
  polygon: LatLng[] | null;
  center_lat: number | null;
  center_lng: number | null;
  radius_km: number | string | null;
};

/** Same ray-casting rule as public.point_in_polygon. */
export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i]!.lng;
    const yi = polygon[i]!.lat;
    const xj = polygon[j]!.lng;
    const yj = polygon[j]!.lat;
    if (yi > point.lat !== yj > point.lat && yj !== yi) {
      if (point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const cos =
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng) - rad(a.lng)) +
    Math.sin(rad(a.lat)) * Math.sin(rad(b.lat));
  return 6371 * Math.acos(Math.min(1, Math.max(-1, cos)));
}

export function pointInZone(point: LatLng, zone: ServiceZone): boolean {
  if (zone.boundary_type === "polygon") return pointInPolygon(point, zone.polygon ?? []);
  if (zone.boundary_type === "circle" && zone.center_lat != null && zone.center_lng != null) {
    return (
      distanceKm(point, { lat: zone.center_lat, lng: zone.center_lng }) <= Number(zone.radius_km)
    );
  }
  return false;
}

/** Like resolve_zone: a containing polygon first, else the nearest containing circle. */
export function zoneForPoint(point: LatLng, zones: ServiceZone[]): ServiceZone | null {
  const polygon = zones.find((z) => z.boundary_type === "polygon" && pointInZone(point, z));
  if (polygon) return polygon;
  let best: ServiceZone | null = null;
  let bestKm = Infinity;
  for (const z of zones) {
    if (z.boundary_type !== "circle" || !pointInZone(point, z)) continue;
    const km = distanceKm(point, { lat: z.center_lat!, lng: z.center_lng! });
    if (km < bestKm) {
      best = z;
      bestKm = km;
    }
  }
  return best;
}

/** A point to centre the map on for a zone (average of polygon corners). */
export function zoneCenter(zone: ServiceZone): LatLng | null {
  const pts = zone.polygon ?? [];
  if (zone.boundary_type === "polygon" && pts.length) {
    return {
      lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
      lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
    };
  }
  if (zone.center_lat != null && zone.center_lng != null) {
    return { lat: zone.center_lat, lng: zone.center_lng };
  }
  return null;
}

const key = (s: string) => s.trim().toLowerCase();

/** Service-area names (settings.service_areas) and zone names differ only in case. */
export function zoneForAreaName(area: string, zones: ServiceZone[]): ServiceZone | null {
  return zones.find((z) => key(z.name_en) === key(area)) ?? null;
}

export function areaNameForZone(zone: ServiceZone, areaNames: string[]): string | null {
  return areaNames.find((a) => key(a) === key(zone.name_en)) ?? null;
}
