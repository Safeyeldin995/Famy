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
    "applications_over_sla",
    "pending_services",
    "pending_teaching_groups",
    "pending_documents",
  ],
  "/admin/documents-expiring": ["documents_expiring_soon"],
  "/admin/service-requests": ["new_service_requests"],
  "/admin/price-change-requests": ["price_change_requests"],
  "/admin/bookings": ["bookings_needing_action", "bookings_lifecycle_attention"],
  "/admin/cases": ["open_cases"],
  "/admin/payments": ["payments_pending_review"],
  "/admin/finance": ["pending_settlements", "providers_at_cash_limit"],
  "/admin/online-lesson-issues": ["online_lesson_issue_reports"],
  "/admin/reports-ugc": ["ugc_reports"],
};

export type AdminNavBadgeExtras = {
  pendingSettlements: number;
  providersAtCashLimit: number;
  studentParentFlags: number;
};

export function adminNavBadgeUrgentCount(
  route: string,
  queue: Record<AdminWorkQueueKey, number>,
): number {
  if (route === "/admin/providers") return queue.applications_over_sla ?? 0;
  if (route === "/admin/documents-expiring") return queue.documents_expiring_soon ?? 0;
  return 0;
}

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