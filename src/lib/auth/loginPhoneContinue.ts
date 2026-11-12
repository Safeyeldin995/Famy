/**
 * Interprets a throttled signup OTP send (resolveOtpFlowMismatch runs after rate limit).
 * Used by the unified phone-first login screen.
 */
export type LoginPhoneContinueInterpretation =
  | { kind: "registered" }
  | { kind: "proceed_signup_otp" }
  | { kind: "flow_mismatch_signup" }
  | {
      kind: "error";
      error: string;
      retryAfter?: number;
      firebaseAuthCode?: string;
    };

export function interpretSignupSendForLoginPhoneContinue(result: {
  ok: boolean;
  error?: string;
  nextStep?: "signin" | "signup";
  retryAfter?: number;
  firebaseAuthCode?: string;
}): LoginPhoneContinueInterpretation {
  if (result.ok) {
    return { kind: "proceed_signup_otp" };
  }
  if (result.error === "flow_mismatch") {
    if (result.nextStep === "signin") {
      return { kind: "registered" };
    }
    return { kind: "flow_mismatch_signup" };
  }
  return {
    kind: "error",
    error: result.error ?? "send_failed",
    retryAfter: result.retryAfter,
    firebaseAuthCode: result.firebaseAuthCode,
  };
}
