import type { AdminWorkQueueKey } from "@/lib/db/admin-work-queue";

/** Routes that show a pending-count badge in the admin sidebar. */
export type AdminNavBadgeKey =
  | AdminWorkQueueKey
  | "pending_settlements"
  | "providers_at_cash_limit";

export const ADMIN_NAV_BADGE_ROUTES: Record<string, readonly AdminNavBadgeKey[]> = {
  "/admin/providers": [
    "new_applications",
    "resubmitted_applications",
    "pending_services",
    "pending_teaching_groups",
    "pending_documents",
  ],
  "/admin/service-requests": ["new_service_requests"],
  "/admin/price-change-requests": ["price_change_requests"],
  "/admin/bookings": ["bookings_needing_action", "bookings_lifecycle_attention"],
  "/admin/cases": ["open_cases"],
  "/admin/payments": ["payments_pending_review"],
  "/admin/finance": ["pending_settlements", "providers_at_cash_limit"],
  "/admin/online-lesson-issues": ["online_lesson_issue_reports"],
};

export type AdminNavBadgeExtras = {
  pendingSettlements: number;
  providersAtCashLimit: number;
  studentParentFlags: number;
};

export function adminNavBadgeCount(
  route: string,
  queue: Record<AdminWorkQueueKey, number>,
  extras: AdminNavBadgeExtras,
): number {
  if (route === "/admin/student-links") return extras.studentParentFlags;
  const keys = ADMIN_NAV_BADGE_ROUTES[route];
  if (!keys?.length) return 0;
  return keys.reduce((sum, key) => sum + (queue[key] ?? 0), 0);
}