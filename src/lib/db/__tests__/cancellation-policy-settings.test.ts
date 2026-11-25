import { describe, expect, it } from "vitest";
import {
  parseCancellationPolicySettings,
  serializeCancellationPolicySettings,
} from "../settings-queries";

const PROD = {
  online: { fee_mode: "percent", fee_value: 50, free_cancel_hours: 4 },
  in_person: { fee_mode: "fixed", fee_value: 50, free_cancel_hours: 1 },
};

describe("parseCancellationPolicySettings", () => {
  it("reads the per-mode shape stored in Production", () => {
    expect(parseCancellationPolicySettings(PROD)).toEqual({
      in_person: { fee_mode: "fixed", fee_value: 50, free_cancel_hours: 1 },
      online: { fee_mode: "percent", fee_value: 50, free_cancel_hours: 4 },
    });
  });

  it("maps a legacy flat rule to both modes, like cancellation_policy_for()", () => {
    const flat = { fee_mode: "percent", fee_value: 30, free_cancel_hours: 6 };
    const parsed = parseCancellationPolicySettings(flat);
    expect(parsed.in_person).toEqual({ fee_mode: "percent", fee_value: 30, free_cancel_hours: 6 });
    expect(parsed.online).toEqual(parsed.in_person);
  });

  it("falls back to in_person for online when online is missing (DB behaviour)", () => {
    const parsed = parseCancellationPolicySettings({ in_person: PROD.in_person });
    expect(parsed.online).toEqual(parsed.in_person);
  });

  it("uses the database defaults when empty", () => {
    const parsed = parseCancellationPolicySettings(null);
    expect(parsed.in_person).toEqual({ fee_mode: "fixed", fee_value: 0, free_cancel_hours: 2 });
    expect(parsed.online).toEqual({ fee_mode: "fixed", fee_value: 0, free_cancel_hours: 2 });
  });
});

describe("serializeCancellationPolicySettings", () => {
  it("round-trips the per-mode shape", () => {
    const modes = parseCancellationPolicySettings(PROD);
    const stored = serializeCancellationPolicySettings(PROD, modes);
    expect(stored).toEqual(PROD);
    expect(parseCancellationPolicySettings(stored)).toEqual(modes);
  });

  it("always writes per-mode and drops legacy flat keys", () => {
    const flat = { fee_mode: "fixed", fee_value: 20, free_cancel_hours: 3 };
    const stored = serializeCancellationPolicySettings(flat, parseCancellationPolicySettings(flat));
    expect(stored).not.toHaveProperty("fee_mode");
    expect(stored).not.toHaveProperty("fee_value");
    expect(stored).not.toHaveProperty("free_cancel_hours");
    expect(stored.in_person).toEqual(flat);
    expect(stored.online).toEqual(flat);
  });

  it("keeps unknown keys at the root and inside each mode", () => {
    const existing = {
      note: "keep me",
      in_person: { ...PROD.in_person, extra: 1 },
      online: PROD.online,
    };
    const modes = parseCancellationPolicySettings(existing);
    modes.online = { fee_mode: "percent", fee_value: 40, free_cancel_hours: 5 };
    const stored = serializeCancellationPolicySettings(existing, modes) as Record<string, unknown>;
    expect(stored.note).toBe("keep me");
    expect((stored.in_person as Record<string, unknown>).extra).toBe(1);
    expect(stored.online).toEqual({ fee_mode: "percent", fee_value: 40, free_cancel_hours: 5 });
  });
});
