export const BOOKING_ACTIVE_STATUSES = [
  "confirmed",
  "on_the_way",
  "arrived",
  "arrival_confirmed",
  "in_progress",
  "completion_requested",
] as const;

export function shortBookingCode(id: string): string {
  const clean = id.replace(/[^a-z0-9]/gi, "");
  if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) {
    return clean.slice(0, 6).toUpperCase();
  }
  return clean.slice(-6).toUpperCase();
}
