import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  ONLINE_SESSION_REVIEW_SELECT,
  mapOnlineSessionReviewRow,
} from "../admin-online-session-queries";

const base = {
  id: "r1",
  booking_id: "b1",
  reason: "Online session evidence: admin_review_no_events",
  status: "open",
  created_at: "2026-11-26T10:00:00Z",
};

describe("admin online session review queue (#556)", () => {
  it("selects only columns that exist on online_session_admin_reviews", () => {
    const cols = ONLINE_SESSION_REVIEW_SELECT.split(",").map((c) => c.trim());
    expect(cols).toEqual(["id", "booking_id", "reason", "status", "metadata", "created_at"]);
    expect(cols).not.toContain("overlap_minutes");
  });

  it("reads the overlap from metadata, as a number or a numeric string", () => {
    expect(mapOnlineSessionReviewRow({ ...base, metadata: { overlap_minutes: "0" } }).overlap_minutes).toBe(0);
    expect(mapOnlineSessionReviewRow({ ...base, metadata: { overlap_minutes: 12 } }).overlap_minutes).toBe(12);
  });

  it("leaves the overlap empty when metadata has none or it is not a number", () => {
    expect(mapOnlineSessionReviewRow({ ...base, metadata: null }).overlap_minutes).toBeNull();
    expect(mapOnlineSessionReviewRow({ ...base, metadata: {} }).overlap_minutes).toBeNull();
    expect(mapOnlineSessionReviewRow({ ...base, metadata: { overlap_minutes: "" } }).overlap_minutes).toBeNull();
    expect(mapOnlineSessionReviewRow({ ...base, metadata: { overlap_minutes: "abc" } }).overlap_minutes).toBeNull();
  });

  it("keeps the other fields", () => {
    const row = mapOnlineSessionReviewRow({ ...base, metadata: { overlap_minutes: 3 } });
    expect(row).toEqual({ ...base, overlap_minutes: 3 });
  });
});
