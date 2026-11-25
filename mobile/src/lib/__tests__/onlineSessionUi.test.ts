import { describe, expect, it } from "vitest";
import {
  canOfferScreenShare,
  isJoinWindowOpen,
  JOIN_WINDOW_TICK_MS,
  micButtonLabelKey,
  readJsonBody,
} from "../onlineSessionUi";

describe("micButtonLabelKey", () => {
  it("offers mute while the mic is on and unmute while it is off", () => {
    expect(micButtonLabelKey(true)).toBe("onlineSession.mute");
    expect(micButtonLabelKey(false)).toBe("onlineSession.unmute");
  });
});

describe("canOfferScreenShare", () => {
  it("is teacher-only and iOS-only (no Android foreground service)", () => {
    expect(canOfferScreenShare("ios", "provider")).toBe(true);
    expect(canOfferScreenShare("android", "provider")).toBe(false);
    expect(canOfferScreenShare("ios", "customer")).toBe(false);
    expect(canOfferScreenShare("ios", undefined)).toBe(false);
  });
});

describe("isJoinWindowOpen", () => {
  const start = "2026-12-01T10:00:00.000Z";
  const end = "2026-12-01T11:00:00.000Z";
  it("opens as time passes, so a ticking clock reveals the join button", () => {
    const early = new Date("2026-12-01T09:00:00.000Z");
    const during = new Date("2026-12-01T10:30:00.000Z");
    expect(isJoinWindowOpen(start, end, early)).toBe(false);
    expect(isJoinWindowOpen(start, end, during)).toBe(true);
    expect(JOIN_WINDOW_TICK_MS).toBeLessThanOrEqual(60_000);
  });
  it("is closed for invalid dates", () => {
    expect(isJoinWindowOpen("nope", end, new Date())).toBe(false);
  });
});

describe("readJsonBody", () => {
  it("returns null for a non-JSON (HTML) error page instead of throwing", async () => {
    await expect(
      readJsonBody({ json: () => Promise.reject(new SyntaxError("Unexpected token <")) }),
    ).resolves.toBeNull();
    await expect(readJsonBody({ json: () => Promise.resolve({ ok: true }) })).resolves.toEqual({ ok: true });
  });
});
