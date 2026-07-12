import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export { formatEGP, formatNumber, formatDate, formatTime } from "./format";

/** Map a booking status to a Famy Badge tone. */
export function bookingStatusTone(
  status: "upcoming" | "completed" | "cancelled" | string,
): "navy" | "mint" | "muted" | "coral" {
  if (status === "completed") return "mint";
  if (status === "cancelled" || status === "no_show") return "muted";
  if (status === "pending" || status === "completion_requested" || status === "disputed") return "coral";
  if (
    status === "confirmed" ||
    status === "on_the_way" ||
    status === "arrived" ||
    status === "arrival_confirmed" ||
    status === "in_progress" ||
    status === "upcoming"
  )
    return "navy";
  return "muted";
}

/** Ordered lifecycle statuses between "accepted" and "provider requested
 * completion" — a booking sitting in any of these is in-flight and should
 * appear in "upcoming"/active booking lists, not just 'confirmed'/'in_progress'. */
export const BOOKING_ACTIVE_STATUSES = [
  "confirmed",
  "on_the_way",
  "arrived",
  "arrival_confirmed",
  "in_progress",
  "completion_requested",
] as const;

/** Full forward order of the happy-path lifecycle, for rendering a step timeline. */
export const BOOKING_TIMELINE_STEPS = [
  "pending",
  "confirmed",
  "on_the_way",
  "arrived",
  "arrival_confirmed",
  "in_progress",
  "completion_requested",
  "completed",
] as const;
