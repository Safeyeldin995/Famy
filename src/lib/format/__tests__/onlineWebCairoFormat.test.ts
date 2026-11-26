import { describe, expect, it } from "vitest";
import { formatTime } from "@/lib/format";
import { ONLINE_WEB_TIME_ZONE } from "@/lib/online/onlineWebCairoTime";

describe("online web Cairo formatting", () => {
  it("shows Cairo wall time even when the runtime timezone differs", () => {
    const instant = new Date("2026-07-15T15:00:00.000Z");
    const cairo = formatTime(instant, "en", ONLINE_WEB_TIME_ZONE);
    const local = formatTime(instant, "en");
    expect(cairo).not.toBe(local);
    expect(cairo.toLowerCase()).toMatch(/5|6/);
  });
});