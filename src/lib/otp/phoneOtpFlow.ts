import { isClientFirebaseOtpProvider } from "@/lib/otp/otpProviderConfig";
import { otpService, type Purpose, type Role } from "@/lib/otp/OtpService";
import { FirebasePhoneVerificationSessionError } from "@/lib/otp/firebaseAuth.browser";
import type { TFunction } from "i18next";

export type PhoneOtpFlowError =
  | "send_failed"
  | "firebase_start_failed"
  | "firebase_send_failed"
  | "firebase_session_lost"
  | "rate_limited"
  | "intent_missing";

type StartPhoneOtpResult =
  | { ok: true; retryAfter?: number }
  | { ok: false; error: PhoneOtpFlowError; retryAfter?: number };

type PhoneOtpFlowOptions = {
  languageCode?: string;
};

export function phoneOtpFlowErrorMessage(error: PhoneOtpFlowError, t: TFunction): string {
  switch (error) {
    case "firebase_send_failed":
      return t("auth.firebaseSendFailed");
    case "firebase_start_failed":
      return t("auth.firebaseStartFailed");
    case "firebase_session_lost":
      return t("auth.firebaseSessionLost");
    case "rate_limited":
      return t("auth.sendFailed");
    case "intent_missing":
      return t("auth.sessionExpired");
    default:
      return t("auth.sendFailed");
  }
}

export async function startPhoneOtpFlow(
  phoneE164: string,
  purpose: Purpose,
  role?: Role,
  options: PhoneOtpFlowOptions = {},
): Promise<StartPhoneOtpResult> {
  if (isClientFirebaseOtpProvider()) {
    const begin = await otpService.beginFirebaseOtp(phoneE164, purpose, role);
    if (!begin.ok) {
      return {
        ok: false,
        error: "firebase_start_failed",
        retryAfter: begin.retryAfter,
      };
    }

    try {
      const { sendFirebasePhoneOtp } = await import("@/lib/otp/firebaseAuth.browser");
      await sendFirebasePhoneOtp(phoneE164, { languageCode: options.languageCode });
      return { ok: true };
    } catch {
      await otpService.abandonOtpFlow();
      return { ok: false, error: "firebase_send_failed" };
    }
  }

  const send = await otpService.sendOtp(phoneE164, purpose, role);
  if (!send.ok) {
    return {
      ok: false,
      error: send.error === "rate_limited" ? "rate_limited" : "send_failed",
      retryAfter: send.retryAfter,
    };
  }
  return { ok: true };
}

export async function resendPhoneOtpFlow(
  phoneE164: string,
  options: PhoneOtpFlowOptions = {},
): Promise<StartPhoneOtpResult> {
  const refresh = await otpService.resendOtp();
  if (!refresh.ok) {
    return {
      ok: false,
      error: refresh.error === "rate_limited" ? "rate_limited" : "intent_missing",
      retryAfter: refresh.retryAfter,
    };
  }

  if (!isClientFirebaseOtpProvider()) {
    return { ok: true, retryAfter: refresh.retryAfter ?? 30 };
  }

  try {
    const { sendFirebasePhoneOtp } = await import("@/lib/otp/firebaseAuth.browser");
    await sendFirebasePhoneOtp(phoneE164, { languageCode: options.languageCode });
    return { ok: true, retryAfter: refresh.retryAfter ?? 30 };
  } catch {
    return { ok: false, error: "firebase_send_failed" };
  }
}

export async function verifyPhoneOtpCode(code: string) {
  if (isClientFirebaseOtpProvider()) {
    try {
      const { confirmFirebasePhoneOtp } = await import("@/lib/otp/firebaseAuth.browser");
      const idToken = await confirmFirebasePhoneOtp(code);
      return otpService.verifyFirebaseOtp(idToken);
    } catch (error) {
      if (
        error instanceof FirebasePhoneVerificationSessionError &&
        error.code === "session_lost"
      ) {
        return { ok: false as const, error: "firebase_session_lost" as const };
      }
      return { ok: false as const, error: "invalid_code" as const };
    }
  }
  return otpService.verifyOtp(code);
}

export { hasFirebasePhoneVerificationSession } from "@/lib/otp/firebaseAuth.browser";
