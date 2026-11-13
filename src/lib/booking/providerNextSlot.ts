import { bookingTimeLabel } from "./bookingLabels";
import {
  cairoBookingDayKey,
  providerUpcomingDayLabel,
} from "../provider/providerJobsList";

export type NextBookableSlot = { start: Date; end: Date; label: string };

/** Advance the scan day while slots for the current day are still loading or empty. */
export function nextProviderScanDay(
  scanDate: Date,
  maxAdvanceDays: number,
  opts: { loading: boolean; slotCount: number; now?: Date },
): Date | null {
  if (opts.loading) return null;
  if (opts.slotCount > 0) return null;
  const now = opts.now ?? new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const scanned = Math.round((+scanDate - +today) / 86_400_000);
  const cap = Math.min(14, maxAdvanceDays);
  if (scanned + 1 >= cap) return null;
  return new Date(+scanDate + 86_400_000);
}

export function formatProviderNextSlotLine(
  slot: NextBookableSlot,
  language: string,
  cairoTime: boolean,
  now = new Date(),
): string {
  const locale = language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB";
  const dayKey = cairoBookingDayKey(slot.start);
  const day =
    dayKey === cairoBookingDayKey(now)
      ? language.startsWith("ar")
        ? "النهارده"
        : "Today"
      : providerUpcomingDayLabel(dayKey, language, now);
  const time = bookingTimeLabel(slot.start, locale, cairoTime);
  return `${day} ${time}`;
}
