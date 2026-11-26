import { describe, expect, it, vi } from "vitest";
import {
  isRoomNotFoundError,
  lessonRoomName,
  liveKitHttpUrl,
  presenceFromParticipants,
  runPresencePoll,
} from "@/lib/livekit/presencePoll.server";

describe("presence poll helpers", () => {
  it("turns the LiveKit websocket URL into the HTTPS API host", () => {
    expect(liveKitHttpUrl("wss://famy.livekit.cloud")).toBe("https://famy.livekit.cloud");
    expect(liveKitHttpUrl("ws://localhost:7880")).toBe("http://localhost:7880");
    expect(liveKitHttpUrl("https://x.example")).toBe("https://x.example");
  });

  it("reads who is in the room from participant identities and ignores disconnected ones", () => {
    expect(
      presenceFromParticipants([
        { identity: "customer:u1", state: 2 },
        { identity: "provider:u2", state: 3 },
        { identity: "recorder", state: 2 },
      ]),
    ).toEqual({ customer: true, provider: false });
    expect(presenceFromParticipants([])).toEqual({ customer: false, provider: false });
  });

  it("treats a missing room as an empty room, not a failure", () => {
    expect(isRoomNotFoundError({ status: 404, code: "not_found" })).toBe(true);
    expect(isRoomNotFoundError({ code: "not_found" })).toBe(true);
    // A bare 404 (wrong URL / proxy page) is a failed poll, never "empty room".
    expect(isRoomNotFoundError({ status: 404 })).toBe(false);
    expect(isRoomNotFoundError(new Error("timeout"))).toBe(false);
  });

  it("records one result per active lesson; LiveKit errors are recorded as failed polls", async () => {
    const record = vi.fn(async () => undefined);
    const now = new Date("2026-11-26T18:00:00Z");
    const result = await runPresencePoll({
      activeBookingIds: async () => ["a", "b", "c"],
      listParticipants: async (room) => {
        if (room === lessonRoomName("a")) return [{ identity: "provider:p", state: 2 }];
        if (room === lessonRoomName("b")) throw Object.assign(new Error("nf"), { status: 404, code: "not_found" });
        throw new Error("network down");
      },
      record,
      now: () => now,
    });
    expect(result).toEqual({ polled: 3, failed: 1 });
    expect(record).toHaveBeenNthCalledWith(1, {
      bookingId: "a",
      polledAt: now,
      ok: true,
      customer: false,
      provider: true,
    });
    expect(record).toHaveBeenNthCalledWith(2, {
      bookingId: "b",
      polledAt: now,
      ok: true,
      customer: false,
      provider: false,
    });
    expect(record).toHaveBeenNthCalledWith(3, {
      bookingId: "c",
      polledAt: now,
      ok: false,
      customer: false,
      provider: false,
    });
  });
});
