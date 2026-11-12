import { describe, expect, it } from "vitest";
import {
  chatComposerVisible,
  chatPhaseForBookingStatus,
  isChatClosedError,
} from "@/ui/chat/chatThreadPresentation";

describe("mobile chat thread read-only", () => {
  it("customer chat screen: hides the composer on completed, cancelled, and no_show", () => {
    for (const status of ["completed", "cancelled", "no_show"] as const) {
      const phase = chatPhaseForBookingStatus(status);
      expect(phase).toBe("readonly");
      expect(chatComposerVisible(phase)).toBe(false);
    }
  });

  it("provider chat screen: keeps the composer for active booking statuses", () => {
    for (const status of ["confirmed", "in_progress", "completion_requested"] as const) {
      const phase = chatPhaseForBookingStatus(status);
      expect(phase).toBe("writable");
      expect(chatComposerVisible(phase)).toBe(true);
    }
  });

  it("maps server chat_closed to the read-only affordance", () => {
    expect(isChatClosedError(new Error("chat_closed"))).toBe(true);
    expect(isChatClosedError({ message: "chat_closed" })).toBe(true);
    expect(isChatClosedError(new Error("contact_masked"))).toBe(false);
  });
});
