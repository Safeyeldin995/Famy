import { describe, expect, it } from "vitest";
import { WORK_QUEUE_ITEMS } from "../AdminWorkQueue";
import { normalizeAdminWorkQueueCounts } from "@/lib/db/admin-work-queue";

describe("admin work queue counts", () => {
  const rows = WORK_QUEUE_ITEMS.map((item, index) => ({ queue: item.key, item_count: index }));

  it("maps every server count to its action without losing zeroes", () => {
    const counts = normalizeAdminWorkQueueCounts(rows);
    expect(counts.new_applications).toBe(0);
    expect(counts.resubmitted_applications).toBe(1);
    expect(counts.new_service_requests).toBe(2);
    expect(counts.pending_teaching_groups).toBe(4);
    expect(counts.payments_pending_review).toBe(8);
    expect(WORK_QUEUE_ITEMS.every((item) => item.route.startsWith("/admin/"))).toBe(true);
  });

  it("refuses missing, duplicate, negative or malformed counts instead of showing a false empty queue", () => {
    expect(() => normalizeAdminWorkQueueCounts(rows.slice(1))).toThrow();
    expect(() => normalizeAdminWorkQueueCounts([...rows, rows[0]])).toThrow();
    expect(() =>
      normalizeAdminWorkQueueCounts([{ ...rows[0], item_count: -1 }, ...rows.slice(1)]),
    ).toThrow();
    expect(() =>
      normalizeAdminWorkQueueCounts([{ ...rows[0], item_count: "oops" }, ...rows.slice(1)]),
    ).toThrow();
  });
});
