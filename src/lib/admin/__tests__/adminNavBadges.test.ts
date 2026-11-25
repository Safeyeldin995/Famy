import { describe, expect, it } from "vitest";
import { adminNavBadgeCount } from "../adminNavBadges";
import { ADMIN_WORK_QUEUE_KEYS, type AdminWorkQueueKey } from "@/lib/db/admin-work-queue";

const emptyQueue = Object.fromEntries(ADMIN_WORK_QUEUE_KEYS.map((key) => [key, 0])) as Record<
  AdminWorkQueueKey,
  number
>;

describe("adminNavBadgeCount", () => {
  it("sums provider queue keys for the providers route", () => {
    const queue = { ...emptyQueue, new_applications: 2, pending_documents: 1 };
    expect(adminNavBadgeCount("/admin/providers", queue)).toBe(3);
  });

  it("includes finance extras on the finance route", () => {
    const queue = { ...emptyQueue, pending_settlements: 4, providers_at_cash_limit: 2 };
    expect(adminNavBadgeCount("/admin/finance", queue)).toBe(6);
  });
});
