import { cairoWallTime } from "@/lib/pricing/servicePackages";

const CAIRO = "Africa/Cairo";
const DAY_MS = 86_400_000;

/** Cairo calendar date (YYYY-MM-DD) for an instant. */
export function cairoYmd(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CAIRO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function ymdToWallDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Cairo local midnight for a Cairo calendar date, as UTC epoch ms. */
export function cairoMidnightMs(ymd: string): number {
  return cairoWallTime(ymdToWallDate(ymd), "00:00").getTime();
}

/** Cairo calendar date offset by whole days via Cairo noon (stable under DST within a band). */
export function cairoDatePlusDays(ymd: string, days: number): string {
  const noon = cairoWallTime(ymdToWallDate(ymd), "12:00");
  return cairoYmd(new Date(noon.getTime() + days * DAY_MS));
}

/** True when Cairo midnights from ymd through ymd+3 are each 24h apart (no DST transition). */
export function isStableCairoBookingSpan(ymd: string): boolean {
  for (let i = 0; i < 3; i++) {
    const d0 = cairoDatePlusDays(ymd, i);
    const d1 = cairoDatePlusDays(ymd, i + 1);
    if (cairoMidnightMs(d1) - cairoMidnightMs(d0) !== DAY_MS) return false;
  }
  return true;
}

/**
 * Earliest Cairo date ≥ today+2 with no Africa/Cairo UTC-offset change between
 * that date 00:00 and date+3 00:00 (for booking slot tests).
 */
export function stableCairoBookingBaseDate(now = new Date()): string {
  let candidate = cairoDatePlusDays(cairoYmd(now), 2);
  for (let attempt = 0; attempt < 90; attempt++) {
    if (isStableCairoBookingSpan(candidate)) return candidate;
    candidate = cairoDatePlusDays(candidate, 1);
  }
  throw new Error("stableCairoBookingBaseDate: no stable Cairo date found within 90 days");
}
