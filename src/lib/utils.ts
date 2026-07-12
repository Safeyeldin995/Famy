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
  if (status === "pending") return "coral";
  if (status === "confirmed" || status === "in_progress" || status === "upcoming") return "navy";
  return "muted";
}
