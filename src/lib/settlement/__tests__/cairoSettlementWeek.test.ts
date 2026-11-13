import { afterEach, describe, expect, it } from "vitest";
import { formatInstantForDatetimeLocal } from "../cairoSettlementWeek";

describe("formatInstantForDatetimeLocal", () => {
  const previousTz = process.env.TZ;

  afterEach(() => {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  it("uses local calendar components instead of slicing a UTC ISO string", () => {
    process.env.TZ = "Africa/Cairo";
    const iso = "2026-11-13T12:00:00.000Z";
    expect(formatInstantForDatetimeLocal(iso)).toBe("2026-11-13T14:00");
    expect(formatInstantForDatetimeLocal(iso)).not.toBe(iso.slice(0, 16));
  });
});
