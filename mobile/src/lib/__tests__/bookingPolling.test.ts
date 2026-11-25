import { describe, expect, it } from "vitest";
import {
  BOOKING_POLL_MAX_MS,
  BOOKING_POLL_MS,
  bookingPollInterval,
} from "../bookingPolling";

const now = Date.parse("2026-11-25T12:00:00Z");
const base = {
  status: "pending",
  startAt: "2026-11-28T12:00:00Z",
  focused: true,
  pollingSinceMs: now - 60_000,
  nowMs: now,
  consecutiveErrors: 0,
};

describe("bookingPollInterval", () => {
  it("polls moving bookings every 20s while focused", () => {
    for (const status of ["pending", "on_the_way", "arrived"]) {
      expect(bookingPollInterval({ ...base, status })).toBe(BOOKING_POLL_MS);
    }
  });
  it("never polls when the screen is not focused", () => {
    expect(bookingPollInterval({ ...base, focused: false })).toBe(false);
  });
  it("stops after 15 minutes of continuous polling", () => {
    expect(bookingPollInterval({ ...base, pollingSinceMs: now - BOOKING_POLL_MAX_MS })).toBe(false);
  });
  it("stops after 3 consecutive errors", () => {
    expect(bookingPollInterval({ ...base, consecutiveErrors: 2 })).toBe(BOOKING_POLL_MS);
    expect(bookingPollInterval({ ...base, consecutiveErrors: 3 })).toBe(false);
  });
  it("polls a confirmed booking only when it starts within 2 hours", () => {
    expect(bookingPollInterval({ ...base, status: "confirmed" })).toBe(false);
    expect(
      bookingPollInterval({ ...base, status: "confirmed", startAt: "2026-11-25T13:30:00Z" }),
    ).toBe(BOOKING_POLL_MS);
  });
  it("does not poll finished bookings", () => {
    for (const status of ["completed", "cancelled", "in_progress"]) {
      expect(bookingPollInterval({ ...base, status })).toBe(false);
    }
  });
});
