import { describe, expect, it } from "vitest";
import { adminNavBadgeCount, adminNavBadgeUrgentCount } from "../adminNavBadges";
import { ADMIN_WORK_QUEUE_KEYS, type AdminWorkQueueKey } from "@/lib/db/admin-work-queue";

const emptyQueue = Object.fromEntries(ADMIN_WORK_QUEUE_KEYS.map((key) => [key, 0])) as Record<
  AdminWorkQueueKey,
  number
>;

const noExtras = {
  pendingSettlements: 0,
  providersAtCashLimit: 0,
  studentParentFlags: 0,
};

describe("adminNavBadgeCount", () => {
  it("sums provider queue keys for the providers route", () => {
    const queue = { ...emptyQueue, new_applications: 2, pending_documents: 1 };
    expect(adminNavBadgeCount("/admin/providers", queue, noExtras)).toBe(3);
  });

  it("includes finance queue keys on the finance route", () => {
    const queue = { ...emptyQueue, pending_settlements: 4, providers_at_cash_limit: 2 };
    expect(adminNavBadgeCount("/admin/finance", queue, noExtras)).toBe(6);
  });

  it("does not double-count over-SLA applications in the providers badge", () => {
    const queue = {
      ...emptyQueue,
      new_applications: 1,
      applications_over_sla: 1,
    };
    expect(adminNavBadgeCount("/admin/providers", queue, noExtras)).toBe(1);
    expect(adminNavBadgeUrgentCount("/admin/providers", queue)).toBe(1);
  });

  it("uses student parent flag count on student-links", () => {
    expect(
      adminNavBadgeCount("/admin/student-links", emptyQueue, {
        ...noExtras,
        studentParentFlags: 7,
      }),
    ).toBe(7);
  });
});