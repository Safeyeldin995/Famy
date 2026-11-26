import { describe, expect, it } from "vitest";
import { WORK_QUEUE_ITEMS } from "../AdminWorkQueue";
import { ADMIN_WORK_QUEUE_KEYS, normalizeAdminWorkQueueCounts } from "@/lib/db/admin-work-queue";

describe("admin work queue counts", () => {
  const rows = ADMIN_WORK_QUEUE_KEYS.map((key, index) => ({ queue: key, item_count: index }));

  it("maps every server count to its action without losing zeroes", () => {
    const counts = normalizeAdminWorkQueueCounts(rows);
    expect(counts.new_applications).toBe(0);
    expect(counts.resubmitted_applications).toBe(1);
    expect(counts.new_service_requests).toBe(3);
    expect(counts.pending_teaching_groups).toBe(6);
    expect(counts.online_session_reviews).toBe(11);
    expect(counts.payments_pending_review).toBe(13);
    expect(counts.online_lesson_issue_reports).toBe(14);
    expect(counts.ugc_reports).toBe(15);
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
