import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  famySplashState,
  famySplashYPosition,
  FAMY_SPLASH_ASSEMBLED,
} from "@shared/splash/famySplashState";
import { receiptText, calendarText, type BookingFileInfo } from "@/lib/bookingFiles";

describe("web/native splash and booking file contracts", () => {
  it("uses the identical source PNG bytes", () => {
    for (const name of ["fam-white", "y-body-white", "y-eyes-white"]) {
      const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
      expect(hash(`assets/splash/${name}.png`)).toBe(hash(`../src/assets/splash/${name}.png`));
    }
  });
  it("keeps the shared reveal, blink, final coordinates and 4.2-second completion", () => {
    expect(famySplashState(0).smileOpacity).toBe(0);
    expect(famySplashState(0.8).eyesClosed).toBe(true);
    expect(famySplashState(0.9).eyesClosed).toBe(false);
    expect(famySplashState(2).wordRevealProgress).toBe(1);
    expect(famySplashYPosition(1, 0)).toEqual({
      x: FAMY_SPLASH_ASSEMBLED.y.x,
      y: FAMY_SPLASH_ASSEMBLED.y.y,
    });
    expect(famySplashState(4.19).animationComplete).toBe(false);
    expect(famySplashState(4.2).animationComplete).toBe(true);
  });
  const booking: BookingFileInfo = {
    id: "ABCD1234",
    provider: "Synthetic provider",
    service: "Tutoring",
    date: "1 Jan",
    time: "9 AM",
    duration: "1 hour",
    address: "Fixture, address; only\nNOT:A_FIELD",
    total: "150 EGP",
    start: "2027-01-01T07:00:00Z",
    end: "2027-01-01T08:00:00Z",
  };
  it("exports the displayed receipt without recalculating totals", () => {
    expect(receiptText(booking)).toContain("Total:      150 EGP");
    expect(receiptText(booking)).toContain("Booking ID: #ABCD1234");
  });
  it("exports UTC event times and escapes injected ICS fields", () => {
    const text = calendarText(booking);
    expect(text).toContain("DTSTART:20270101T070000Z\r\nDTEND:20270101T080000Z");
    expect(text).toContain("LOCATION:Fixture\\, address\\; only\\nNOT:A_FIELD");
    expect(text).not.toContain("\nNOT:A_FIELD");
  });
});

const backend = vi.hoisted(() => ({
  rpc: vi.fn(),
  invalidate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: backend.rpc } }));
vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: unknown) => options,
  useQuery: (options: unknown) => options,
  useQueryClient: () => ({ invalidateQueries: backend.invalidate }),
}));
import { useRescheduleAction } from "@/lib/rescheduleQueries";
describe("reschedule server contract", () => {
  function action() {
    // React Query is mocked above to return options, so no React hooks execute here.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useRescheduleAction("fixture-booking") as unknown as {
      mutationFn: (input: unknown) => Promise<void>;
      onSuccess: () => Promise<unknown>;
    };
  }
  it("passes request times and reason without replacing the booking row", async () => {
    backend.rpc.mockResolvedValueOnce({ error: null });
    await action().mutationFn({ type: "request", start: "start", end: "end", reason: "reason" });
    expect(backend.rpc).toHaveBeenLastCalledWith("request_reschedule", {
      p_booking_id: "fixture-booking",
      p_proposed_start: "start",
      p_proposed_end: "end",
      p_reason: "reason",
    });
  });
  it("uses guarded respond/withdraw RPCs and propagates server rejection", async () => {
    backend.rpc.mockResolvedValueOnce({ error: null });
    await action().mutationFn({ type: "withdraw", requestId: "request" });
    expect(backend.rpc).toHaveBeenLastCalledWith("cancel_reschedule_request", {
      p_request_id: "request",
    });
    backend.rpc.mockResolvedValueOnce({ error: { message: "Denied" } });
    await expect(action().mutationFn({ type: "accept", requestId: "request" })).rejects.toEqual({
      message: "Denied",
    });
  });
  it("invalidates the affected booking, request list and customer list after success", async () => {
    await action().onSuccess();
    expect(backend.invalidate).toHaveBeenCalledWith({ queryKey: ["booking", "fixture-booking"] });
    expect(backend.invalidate).toHaveBeenCalledWith({
      queryKey: ["reschedule-requests", "fixture-booking"],
    });
    expect(backend.invalidate).toHaveBeenCalledWith({ queryKey: ["my-bookings"] });
  });
});
