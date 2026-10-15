import { formatLocale } from "@/lib/format";
import { adminDate } from "./adminPresentation";

export const bookingStatuses = [
  "pending",
  "confirmed",
  "in_progress",
  "completion_requested",
  "disputed",
  "no_show",
  "completed",
  "cancelled",
];
export const paymentStatuses = [
  "pending_review",
  "pending",
  "authorized",
  "captured",
  "rejected",
  "failed",
  "refunded",
  "partially_refunded",
];
export const adminControl =
  "focus-ring min-h-11 rounded-xl border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50";
export const adminScreen =
  "space-y-4 px-4 py-5 text-sm [&_button]:min-h-11 [&_input]:min-h-11 [&_select]:min-h-11 [&_textarea]:text-sm";
export function bookingCode(id?: string) {
  return id ? `#${id.replace(/-/g, "").slice(0, 6).toUpperCase()}` : "—";
}
export function canCancelBooking(status: string) {
  return status === "pending" || status === "confirmed";
}
export function canReviewTransfer(p: {
  status?: string;
  payment_method_type?: string;
  method?: string;
}) {
  return (
    p.status === "pending_review" &&
    (p.payment_method_type === "manual_transfer" ||
      (!p.payment_method_type && p.method === "instapay"))
  );
}
export function operationDate(value: string | null | undefined, language: string) {
  return adminDate(value, language);
}
export function caseAge(value: string, language: string, now = Date.now()) {
  const elapsed = Math.max(0, (now - Date.parse(value)) / 60000);
  if (!Number.isFinite(elapsed)) return "—";
  const unit = elapsed >= 1440 ? "day" : elapsed >= 60 ? "hour" : "minute";
  const count = Math.floor(elapsed / (unit === "day" ? 1440 : unit === "hour" ? 60 : 1));
  return new Intl.RelativeTimeFormat(formatLocale(language), { numeric: "auto" }).format(
    -count,
    unit,
  );
}
export function matchesBooking(b: any, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  return (
    !needle ||
    [b.id, bookingCode(b.id), b.customer?.full_name, b.provider?.profile?.full_name].some((v) =>
      String(v ?? "")
        .toLocaleLowerCase()
        .includes(needle),
    )
  );
}
export function mergeCases(tickets: any[], disputes: any[], reports: any[]) {
  return [
    ...tickets.map((row) => ({ kind: "support", row })),
    ...disputes.map((row) => ({ kind: "disputes", row })),
    ...reports.map((row) => ({ kind: "no_shows", row })),
  ].sort(
    (a, b) =>
      Number(["resolved", "rejected", "closed"].includes(a.row.status)) -
        Number(["resolved", "rejected", "closed"].includes(b.row.status)) ||
      Date.parse(a.row.created_at) - Date.parse(b.row.created_at),
  );
}
