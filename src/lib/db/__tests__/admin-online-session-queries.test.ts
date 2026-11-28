import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  ONLINE_SESSION_REVIEW_SELECT,
  mapOnlineSessionReviewRow,
  onlineSessionReviewReasonText,
} from "../admin-online-session-queries";
import ar from "@/lib/i18n/locales/ar";

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
    expect(
      mapOnlineSessionReviewRow({ ...base, metadata: { overlap_minutes: "0" } }).overlap_minutes,
    ).toBe(0);
    expect(
      mapOnlineSessionReviewRow({ ...base, metadata: { overlap_minutes: 12 } }).overlap_minutes,
    ).toBe(12);
  });

  it("leaves the overlap empty when metadata has none or it is not a number", () => {
    expect(mapOnlineSessionReviewRow({ ...base, metadata: null }).overlap_minutes).toBeNull();
    expect(mapOnlineSessionReviewRow({ ...base, metadata: {} }).overlap_minutes).toBeNull();
    expect(
      mapOnlineSessionReviewRow({ ...base, metadata: { overlap_minutes: "" } }).overlap_minutes,
    ).toBeNull();
    expect(
      mapOnlineSessionReviewRow({ ...base, metadata: { overlap_minutes: "abc" } }).overlap_minutes,
    ).toBeNull();
  });

  it("keeps the other fields", () => {
    const row = mapOnlineSessionReviewRow({ ...base, metadata: { overlap_minutes: 3 } });
    expect(row).toEqual({
      ...base,
      outcome: "admin_review_no_events",
      overlap_minutes: 3,
      required_overlap_minutes: null,
    });
  });
});

describe("admin online session review reason (#568)", () => {
  const t = (key: string, opts?: Record<string, unknown>) => {
    const leaf = key.split(".").reduce<any>((o, k) => o?.[k], ar as any);
    if (typeof leaf !== "string") throw new Error(`missing ar key ${key}`);
    return leaf.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts?.[k] ?? ""));
  };
  const read = (reason: string, metadata: Record<string, unknown> | null) =>
    onlineSessionReviewReasonText(t, mapOnlineSessionReviewRow({ ...base, reason, metadata }));

  it("shows the overlap minutes in Arabic", () => {
    expect(
      read("Online session evidence: admin_review_overlap", {
        outcome: "admin_review_overlap",
        overlap_minutes: 12,
        required_overlap_minutes: 30,
      }),
    ).toBe("الطالب والمدرس اتقابلوا 12 دقيقة من 30");
  });

  it("maps every outcome to Arabic, also from legacy reasons without metadata.outcome", () => {
    for (const code of [
      "admin_review_overlap",
      "admin_review_no_events",
      "provider_absent",
      "customer_absent",
      "both_absent",
    ]) {
      const text = read(`Automatic online session resolution: ${code}`, {});
      expect(text).not.toMatch(/[a-z]+_[a-z_]+/);
      expect(text).toMatch(/[\u0600-\u06FF]/);
    }
  });

  it("falls back to a generic Arabic label, never the stored text", () => {
    expect(read("Something unexpected", null)).toBe("الحصة محتاجة مراجعة");
  });
});
