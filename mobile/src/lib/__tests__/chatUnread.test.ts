import { describe, expect, it } from "vitest";
import {
  unreadConversationCount,
  unreadConversationsByBookingId,
  type ConversationListItem,
} from "@/lib/chatQueries";

const base = (booking_id: string, unread: boolean): ConversationListItem => ({
  id: `c-${booking_id}`,
  booking_id,
  customer_id: "cust",
  provider_user_id: "prov",
  updated_at: "2026-01-01T00:00:00Z",
  other_name: "Test",
  other_avatar: null,
  last_message: "hi",
  last_time: "2026-01-01T00:00:00Z",
  last_sender_id: "prov",
  unread,
  booking_status: "confirmed",
  chat_closed: false,
});

describe("unread conversation helpers", () => {
  it("counts unread threads", () => {
    const items = [base("b1", true), base("b2", false), base("b3", true)];
    expect(unreadConversationCount(items)).toBe(2);
  });

  it("maps unread flags by booking id", () => {
    const map = unreadConversationsByBookingId([
      base("b1", true),
      base("b2", false),
      base("b3", true),
    ]);
    expect(map.get("b1")).toBe(true);
    expect(map.has("b2")).toBe(false);
    expect(map.get("b3")).toBe(true);
  });
});
