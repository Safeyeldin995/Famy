import { describe, expect, it } from "vitest";
import {
  assertOnlineBookingPrepaid,
  authorizeSessionJoin,
  sessionJoinWindow,
  type SessionBookingSnapshot,
} from "@/lib/livekit/sessionAccess";

const baseBooking = (
  overrides: Partial<SessionBookingSnapshot> = {},
): SessionBookingSnapshot => ({
  id: "00000000-0000-4000-8000-000000000001",
  service_mode: "online",
  status: "confirmed",
  customer_id: "c1",
  provider_id: "p1",
  provider_profile_id: "pr1",
  start_at: "2026-11-23T14:00:00.000Z",
  end_at: "2026-11-23T15:00:00.000Z",
  payment_captured: true,
  ...overrides,
});

describe("sessionJoinWindow", () => {
  it("opens 10 minutes before start through 15 minutes after end", () => {
    const start = new Date("2026-11-23T14:00:00Z");
    const end = new Date("2026-11-23T15:00:00Z");
    expect(sessionJoinWindow(start, end, new Date("2026-11-23T13:49:59Z")).open).toBe(false);
    expect(sessionJoinWindow(start, end, new Date("2026-11-23T13:50:00Z")).open).toBe(true);
    expect(sessionJoinWindow(start, end, new Date("2026-11-23T15:14:59Z")).open).toBe(true);
    expect(sessionJoinWindow(start, end, new Date("2026-11-23T15:15:01Z")).open).toBe(false);
  });
});

describe("authorizeSessionJoin", () => {
  it("allows customer inside the window when paid", () => {
    const result = authorizeSessionJoin(
      baseBooking(),
      "c1",
      new Date("2026-11-23T14:05:00Z"),
    );
    expect(result).toEqual({ ok: true, party: "customer" });
  });

  it("rejects unpaid online bookings", () => {
    const result = authorizeSessionJoin(
      baseBooking({ payment_captured: false }),
      "c1",
      new Date("2026-11-23T14:05:00Z"),
    );
    expect(result).toEqual({ ok: false, code: "payment_required" });
  });

  it("rejects cash-style payment for online bookings at RPC layer", () => {
    expect(() => assertOnlineBookingPrepaid("cash")).toThrow("BOOKING_ONLINE_PREPAID_ONLY");
    expect(() => assertOnlineBookingPrepaid("online")).not.toThrow();
  });
});