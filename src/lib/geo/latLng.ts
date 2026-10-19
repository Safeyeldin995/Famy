export type LatLng = { lat: number; lng: number };

/**
 * True when a coordinate pair can actually be used for zone matching.
 *
 * This is load-bearing for the booking funnel: marketplace eligibility checks the customer's
 * address against a zone's circle, so an address without a usable pin can never match a
 * provider and the customer sees an empty marketplace.
 */
export function isValidLatLng(v: LatLng | null | undefined): v is LatLng {
  return (
    !!v &&
    Number.isFinite(v.lat) &&
    Number.isFinite(v.lng) &&
    v.lat >= -90 &&
    v.lat <= 90 &&
    v.lng >= -180 &&
    v.lng <= 180
  );
}

/** Narrow a possibly-null database row pair to a usable LatLng. */
export function toLatLng(lat: number | null | undefined, lng: number | null | undefined): LatLng | null {
  const candidate = { lat: lat ?? NaN, lng: lng ?? NaN };
  return isValidLatLng(candidate) ? candidate : null;
}
