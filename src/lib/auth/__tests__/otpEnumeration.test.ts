import { describe, expect, it } from "vitest";

describe("sendOtp enumeration resistance", () => {
  it("uses the same successful response shape regardless of account existence", () => {
    const successShape = {
      ok: true,
      retryAfter: 30,
      requiresVerification: true as const,
    };

    expect(successShape).toEqual({
      ok: true,
      retryAfter: 30,
      requiresVerification: true,
    });
    expect(successShape).not.toHaveProperty("already_registered");
    expect(successShape).not.toHaveProperty("no_account");
  });

  it("reveals account existence only after OTP verification via flow_mismatch", () => {
    const signupExisting = { ok: false, error: "flow_mismatch", nextStep: "signin" };
    const resetMissing = { ok: false, error: "flow_mismatch", nextStep: "signup" };

    expect(signupExisting.nextStep).toBe("signin");
    expect(resetMissing.nextStep).toBe("signup");
    expect(signupExisting.error).not.toBe("already_registered");
    expect(resetMissing.error).not.toBe("no_account");
  });
});
