import { isClientFirebaseOtpProvider } from "@/lib/otp/otpProviderConfig";
import { otpService, type Purpose, type Role } from "@/lib/otp/OtpService";
import {
  FirebasePhoneVerificationSessionError,
  FirebaseRecaptchaContainerError,
} from "@/lib/otp/firebaseAuth.browser";
import { formatOtpSecondsDuration } from "@/lib/auth/otpCountdown";
import { logClientErrorFn } from "@/lib/error-log.functions";
import type { TFunction } from "i18next";

export type PhoneOtpFlowError =
  | "send_failed"
  | "delivery_failed"
  | "temporarily_unavailable"
  | "firebase_start_failed"
  | "firebase_send_failed"
  | "firebase_recaptcha_unavailable"
  | "firebase_session_lost"
  | "rate_limited"
  | "intent_missing";

type StartPhoneOtpResult =
  | { ok: true; retryAfter?: number }
  | {
      ok: false;
      error: PhoneOtpFlowError;
      retryAfter?: number;
      /** Client should leave the OTP screen; pending delivery is unusable. */
      flowAbandoned?: boolean;
      /** True only when the server confirmed clearing the pending intent. */
      intentCleared?: boolean;
      /** Firebase Auth error code when client SMS send failed (e.g. auth/quota-exceeded). */
      firebaseAuthCode?: string;
    };

type PhoneOtpFlowOptions = {
  languageCode?: string;
};

export function firebaseSendFailureMessage(t: TFunction, firebaseAuthCode?: string): string {
  switch (firebaseAuthCode) {
    case "auth/too-many-requests":
      return t("auth.firebaseSendTooManyRequests");
    case "auth/quota-exceeded":
      return t("auth.firebaseSendQuotaExceeded");
    case "auth/invalid-phone-number":
      return t("validation.invalidPhone");
    case "auth/captcha-check-failed":
    case "auth/invalid-app-credential":
    case "auth/missing-app-credential":
      return t("auth.firebaseSendDeviceVerifyFailed");
    default:
      return t("auth.firebaseSendFailed");
  }
}

function extractFirebaseAuthErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.startsWith("auth/") ? code : undefined;
}

function reportFirebaseSendFailure(firebaseAuthCode: string): void {
  void logClientErrorFn({
    data: {
      message: `Firebase send failed: ${firebaseAuthCode}`,
      contextRoute: typeof window !== "undefined" ? window.location.pathname : undefined,
      contextLabel: "firebase_send_failed",
    },
  }).catch(() => {});
}

function mapFirebaseSendCatchError(error: unknown): {
  error: "firebase_recaptcha_unavailable" | "firebase_send_failed";
  firebaseAuthCode?: string;
} {
  if (error instanceof FirebaseRecaptchaContainerError) {
    return { error: "firebase_recaptcha_unavailable" };
  }
  const firebaseAuthCode = extractFirebaseAuthErrorCode(error);
  if (firebaseAuthCode) {
    reportFirebaseSendFailure(firebaseAuthCode);
  }
  return { error: "firebase_send_failed", firebaseAuthCode };
}

export function phoneOtpFlowErrorMessage(
  error: PhoneOtpFlowError,
  t: TFunction,
  retryAfter?: number,
  firebaseAuthCode?: string,
): string {
  switch (error) {
    case "firebase_send_failed":
      return firebaseSendFailureMessage(t, firebaseAuthCode);
    case "firebase_start_failed":
      return t("auth.firebaseStartFailed");
    case "firebase_recaptcha_unavailable":
      return t("auth.firebaseRecaptchaUnavailable");
    case "firebase_session_lost":
      return t("auth.firebaseSessionLost");
    case "rate_limited":
      return retryAfter && retryAfter > 0
        ? t("auth.rateLimited", { time: formatOtpSecondsDuration(retryAfter, t) })
        : t("auth.sendFailed");
    case "delivery_failed":
    case "temporarily_unavailable":
      return t("auth.deliveryUnavailable");
    case "intent_missing":
      return t("auth.sessionExpired");
    default:
      return t("auth.sendFailed");
  }
}

function mapServerSendError(error: string | undefined): PhoneOtpFlowError {
  if (error === "rate_limited" || error === "rate_limited_phone" || error === "rate_limited_ip") {
    return "rate_limited";
  }
  if (error === "delivery_failed") return "delivery_failed";
  if (error === "temporarily_unavailable") return "temporarily_unavailable";
  return "send_failed";
}

async function confirmClientOtpDelivery(): Promise<boolean> {
  const res = await otpService.confirmFirebaseOtpSent();
  return res.ok;
}

/** Best-effort server cancel; never throws. Returns whether clear was confirmed. */
async function bestEffortAbandonOtpFlow(): Promise<boolean> {
  try {
    const res = await otpService.abandonOtpFlow();
    return res?.ok === true;
  } catch {
    return false;
  }
}

async function abandonAfterFailedFirebaseClientSend(): Promise<{
  flowAbandoned: true;
  intentCleared: boolean;
}> {
  const intentCleared = await bestEffortAbandonOtpFlow();
  return { flowAbandoned: true, intentCleared };
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
      const confirmed = await confirmClientOtpDelivery();
      if (!confirmed) {
        await bestEffortAbandonOtpFlow();
        return { ok: false, error: "firebase_send_failed" };
      }
      return { ok: true };
    } catch (error) {
      await bestEffortAbandonOtpFlow();
      const mapped = mapFirebaseSendCatchError(error);
      return { ok: false, ...mapped };
    }
  }

  const send = await otpService.sendOtp(phoneE164, purpose, role);
  if (!send.ok) {
    return {
      ok: false,
      error: mapServerSendError(send.error),
      retryAfter: send.retryAfter,
    };
  }
  return { ok: true, retryAfter: send.retryAfter };
}

export async function resendPhoneOtpFlow(
  phoneE164: string,
  options: PhoneOtpFlowOptions = {},
): Promise<StartPhoneOtpResult> {
  const refresh = await otpService.resendOtp();
  if (!refresh.ok) {
    const mapped =
      refresh.error === "intent_missing" ? "intent_missing" : mapServerSendError(refresh.error);
    return {
      ok: false,
      error: mapped,
      retryAfter: refresh.retryAfter,
    };
  }

  if (!isClientFirebaseOtpProvider()) {
    return { ok: true, retryAfter: refresh.retryAfter ?? 30 };
  }

  try {
    const { sendFirebasePhoneOtp } = await import("@/lib/otp/firebaseAuth.browser");
    await sendFirebasePhoneOtp(phoneE164, { languageCode: options.languageCode });
    const confirmed = await confirmClientOtpDelivery();
    if (!confirmed) {
      const abandoned = await abandonAfterFailedFirebaseClientSend();
      return {
        ok: false,
        error: "firebase_send_failed",
        flowAbandoned: abandoned.flowAbandoned,
        intentCleared: abandoned.intentCleared,
      };
    }
    return { ok: true, retryAfter: refresh.retryAfter ?? 30 };
  } catch (error) {
    const abandoned = await abandonAfterFailedFirebaseClientSend();
    const mapped = mapFirebaseSendCatchError(error);
    return {
      ok: false,
      ...mapped,
      flowAbandoned: abandoned.flowAbandoned,
      intentCleared: abandoned.intentCleared,
    };
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
        (error.code === "session_lost" || error.code === "not_started")
      ) {
        return { ok: false as const, error: "firebase_session_lost" as const };
      }
      return { ok: false as const, error: "invalid_code" as const };
    }
  }
  return otpService.verifyOtp(code);
}

export { hasFirebasePhoneVerificationSession } from "@/lib/otp/firebaseAuth.browser";
