import { describe, expect, it } from "vitest";
import { adminNavBadgeCount } from "../adminNavBadges";
import type { AdminWorkQueueKey } from "@/lib/db/admin-work-queue";

const emptyQueue = Object.fromEntries(
  [
    "new_applications",
    "resubmitted_applications",
    "applications_over_sla",
    "new_service_requests",
    "price_change_requests",
    "pending_services",
    "pending_teaching_groups",
    "pending_documents",
    "documents_expiring_soon",
    "open_cases",
    "bookings_needing_action",
    "bookings_lifecycle_attention",
    "payments_pending_review",
    "online_lesson_issue_reports",
    "ugc_reports",
  ].map((key) => [key, 0]),
) as Record<AdminWorkQueueKey, number>;

describe("adminNavBadgeCount", () => {
  it("sums provider queue keys for the providers route", () => {
    const queue = { ...emptyQueue, new_applications: 2, pending_documents: 1 };
    expect(
      adminNavBadgeCount("/admin/providers", queue, {
        pendingSettlements: 0,
        providersAtCashLimit: 0,
        studentParentFlags: 0,
      }),
    ).toBe(3);
  });

  it("includes finance extras on the finance route", () => {
    expect(
      adminNavBadgeCount("/admin/finance", emptyQueue, {
        pendingSettlements: 4,
        providersAtCashLimit: 2,
        studentParentFlags: 0,
      }),
    ).toBe(6);
  });
});
