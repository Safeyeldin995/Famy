import { describe, expect, it } from "vitest";
import { pickProviderNextAction } from "../providerNextAction";

describe("pickProviderNextAction", () => {
  const now = new Date("2026-11-25T10:00:00.000Z");

  it("prioritizes pending requests", () => {
    const action = pickProviderNextAction({
      pending: [{ id: "a", status: "pending", created_at: now.toISOString(), start_at: "2026-11-26T10:00:00.000Z" }],
      upcoming: [{ id: "b", status: "confirmed", start_at: "2026-11-25T10:30:00.000Z" }],
      missingDocument: false,
      rejectedService: false,
      now,
    });
    expect(action?.kind).toBe("pending_request");
  });

  it("suggests start when job within one hour", () => {
    const action = pickProviderNextAction({
      pending: [],
      upcoming: [{ id: "b", status: "confirmed", start_at: "2026-11-25T10:45:00.000Z" }],
      missingDocument: false,
      rejectedService: false,
      now,
    });
    expect(action?.kind).toBe("start_job");
    expect(action?.ctaKey).toBe("proNextAction.start");
  });
});