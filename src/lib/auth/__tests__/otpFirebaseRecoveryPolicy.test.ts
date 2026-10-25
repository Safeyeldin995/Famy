import { describe, expect, it } from "vitest";
import { shouldAutoResendFirebaseOtpOnMount } from "@/lib/auth/otpFirebaseRecoveryPolicy";

describe("shouldAutoResendFirebaseOtpOnMount", () => {
  it("does not resend when a live Firebase confirmation exists (fresh send → OTP)", () => {
    expect(shouldAutoResendFirebaseOtpOnMount(true, 30)).toBe(false);
    expect(shouldAutoResendFirebaseOtpOnMount(true, 0)).toBe(false);
  });

  it("does not resend while server retryAfter is active", () => {
    expect(shouldAutoResendFirebaseOtpOnMount(false, 25)).toBe(false);
  });

  it("allows one resend when confirmation was lost and retry window elapsed", () => {
    expect(shouldAutoResendFirebaseOtpOnMount(false, 0)).toBe(true);
  });
});
