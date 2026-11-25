/**
 * Pure helpers for the provider app's work screens (dashboard, request
 * countdown, per-booking money breakdown, directions). Shared with mobile via
 * `@shared/provider/providerWorkHelpers` and unit tested in `src/lib`.
 */
import {
  DEFAULT_BOOKING_EXPIRY_SETTINGS,
  pendingResponseDeadline,
  type BookingExpirySettings,
} from "../booking/pending-expiry";
import { isCommissionSnapshotted, providerBookingValue } from "../earnings/aggregateProviderEarnings";
import { cairoBookingDayKey, isProviderJobsNowStatus } from "./providerJobsList";

/** Statuses a provider is still working on (same set as the mobile constants). */
const ACTIVE_STATUSES = new Set([
  "confirmed",
  "on_the_way",
  "arrived",
  "arrival_confirmed",
  "in_progress",
  "completion_requested",
]);

type DashboardBooking = { status?: string | null; start_at: string };

/**
 * Dashboard "upcoming": everything from today on (Cairo calendar day, not the
 * phone's), plus any job already under way whatever its start date — a job that
 * started yesterday evening and is still in progress must not disappear.
 * In-flight jobs come first, then by start time.
 */
export function dashboardUpcomingBookings<T extends DashboardBooking>(
  bookings: readonly T[],
  now: Date = new Date(),
  limit = 3,
): T[] {
  const today = cairoBookingDayKey(now);
  return bookings
    .filter((b) => {
      const status = String(b.status ?? "");
      if (!ACTIVE_STATUSES.has(status)) return false;
      if (isProviderJobsNowStatus(status)) return true;
      return cairoBookingDayKey(new Date(b.start_at)) >= today;
    })
    .sort((a, b) => {
      const aNow = isProviderJobsNowStatus(String(a.status ?? "")) ? 0 : 1;
      const bNow = isProviderJobsNowStatus(String(b.status ?? "")) ? 0 : 1;
      if (aNow !== bNow) return aNow - bNow;
      return +new Date(a.start_at) - +new Date(b.start_at);
    })
    .slice(0, limit);
}

/** Under this many minutes the countdown turns red. */
export const REQUEST_COUNTDOWN_URGENT_MINUTES = 30;

export type RequestCountdown =
  | { kind: "overdue" }
  | { kind: "left"; hours: number; minutes: number; totalMinutes: number; urgent: boolean };

/** Time left before an unanswered request expires (server rule in `expire_pending_bookings`). */
export function requestCountdown(
  createdAt: Date | string,
  startAt: Date | string,
  settings: BookingExpirySettings = DEFAULT_BOOKING_EXPIRY_SETTINGS,
  now: Date = new Date(),
): RequestCountdown {
  const deadline = pendingResponseDeadline(createdAt, startAt, settings);
  const ms = deadline.getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return { kind: "overdue" };
  // Round up: "1 minute left" until the very end, never "0 minutes".
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  return {
    kind: "left",
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
    totalMinutes,
    urgent: totalMinutes < REQUEST_COUNTDOWN_URGENT_MINUTES,
  };
}

/** Localised countdown text, e.g. «رد خلال ٢ س و١٤ د». */
export function requestCountdownLabel(
  countdown: RequestCountdown,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (countdown.kind === "overdue") return t("pro.bookings.respondOverdue");
  if (countdown.hours === 0) {
    return t("pro.bookings.respondCountdownMinutes", { minutes: countdown.minutes });
  }
  return t("pro.bookings.respondCountdownHoursMinutes", {
    hours: countdown.hours,
    minutes: countdown.minutes,
  });
}

export type ProviderMoneyBreakdown = {
  bookingValue: number;
  commission: number;
  net: number;
};

type BreakdownRow = {
  price_subtotal?: number | null;
  price_extras_total?: number | null;
  price_travel_fee?: number | null;
  price_provider_net?: number | null;
  price_commission_amount?: number | null;
};

/**
 * «سعر الحجز − عمولة فامي = صافيك» from the booking snapshot. Returns null when
 * the commission was not snapshotted (older bookings): never recompute it.
 */
export function providerMoneyBreakdown(row: BreakdownRow): ProviderMoneyBreakdown | null {
  if (!isCommissionSnapshotted(row)) return null;
  const bookingValue = round2(providerBookingValue(row));
  const net = round2(Number(row.price_provider_net));
  const snapshotCommission = Number(row.price_commission_amount);
  const commission = round2(
    Number.isFinite(snapshotCommission) && row.price_commission_amount != null
      ? snapshotCommission
      : Math.max(0, bookingValue - net),
  );
  return { bookingValue, commission, net };
}

/** Ledger kinds that put a booking's money into (or against) the provider wallet. */
const BOOKING_WALLET_KINDS = new Set(["online_provider_share", "cash_collected_platform_share"]);

/** True when the provider wallet already records this booking. */
export function bookingRecordedInWallet(
  bookingId: string,
  ledger: readonly { booking_id?: string | null; kind?: string | null }[] | null | undefined,
): boolean {
  return (ledger ?? []).some(
    (e) => e.booking_id === bookingId && BOOKING_WALLET_KINDS.has(String(e.kind ?? "")),
  );
}

/** Google Maps directions to the booking address; null without valid coordinates. */
export function directionsUrl(lat: unknown, lng: unknown): string | null {
  const la = Number(lat);
  const lo = Number(lng);
  if (lat == null || lng == null || !Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180 || (la === 0 && lo === 0)) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${la},${lo}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
