import { formatOtpSecondsDuration } from "@/lib/auth/otpCountdown";
import {
  abandonMobileOtpFlow,
  applyMobileVerifySession,
  confirmMobileFirebaseOtpSent,
  resendMobileOtp,
  sendMobileOtp,
  verifyMobileFirebaseOtp,
  verifyMobileOtpCode,
  type OtpPurpose,
  type OtpRole,
} from "./mobileOtpApi";
import {
  confirmNativeFirebasePhoneOtp,
  resetNativeFirebasePhoneSession,
  sendNativeFirebasePhoneOtp,
} from "./firebasePhone";

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
  | { ok: true; retryAfter?: number; delivery?: "firebase" | "server" }
  | {
      ok: false;
      error: PhoneOtpFlowError;
      retryAfter?: number;
      flowAbandoned?: boolean;
      intentCleared?: boolean;
      firebaseAuthCode?: string;
    };

function mapSendError(body: unknown): PhoneOtpFlowError {
  if (!body || typeof body !== "object") return "send_failed";
  const error = (body as { error?: string }).error;
  if (error === "rate_limited" || error === "rate_limited_phone" || error === "rate_limited_ip") {
    return "rate_limited";
  }
  if (error === "delivery_failed") return "delivery_failed";
  if (error === "temporarily_unavailable") return "temporarily_unavailable";
  return "send_failed";
}

export function phoneOtpFlowErrorMessage(
  error: PhoneOtpFlowError,
  t: (key: string, options?: Record<string, unknown>) => string,
  retryAfter?: number,
  firebaseAuthCode?: string,
): string {
  switch (error) {
    case "firebase_send_failed":
      if (firebaseAuthCode === "auth/too-many-requests") return t("auth.firebaseSendTooManyRequests");
      if (firebaseAuthCode === "auth/quota-exceeded") return t("auth.firebaseSendQuotaExceeded");
      if (firebaseAuthCode === "auth/invalid-phone-number") return t("validation.invalidPhone");
      if (firebaseAuthCode === "unavailable") return t("auth.firebaseStartFailed");
      return t("auth.firebaseSendFailed");
    case "firebase_start_failed":
      return t("auth.firebaseStartFailed");
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

async function afterFirebaseNativeSend(): Promise<StartPhoneOtpResult> {
  const confirm = await confirmMobileFirebaseOtpSent();
  if (confirm.ok && confirm.data && typeof confirm.data === "object" && (confirm.data as { ok?: boolean }).ok) {
    return { ok: true };
  }
  await abandonMobileOtpFlow();
  resetNativeFirebasePhoneSession();
  return { ok: false, error: "firebase_send_failed", flowAbandoned: true, intentCleared: true };
}

export async function startPhoneOtpFlow(
  phoneE164: string,
  purpose: OtpPurpose,
  role?: OtpRole,
): Promise<StartPhoneOtpResult> {
  const send = await sendMobileOtp({ phone: phoneE164, purpose, role });
  if (!send.ok) {
    return {
      ok: false,
      error: mapSendError(send.body),
      retryAfter:
        send.body && typeof send.body === "object"
          ? (send.body as { retryAfter?: number }).retryAfter
          : undefined,
    };
  }

  const data = send.data as { ok?: boolean; delivery?: "firebase" | "server"; retryAfter?: number };
  if (!data.ok) {
    return {
      ok: false,
      error: mapSendError(data),
      retryAfter: data.retryAfter,
    };
  }

  if (data.delivery === "firebase") {
    const native = await sendNativeFirebasePhoneOtp(phoneE164);
    if (!native.ok) {
      await abandonMobileOtpFlow();
      return {
        ok: false,
        error: native.code === "unavailable" ? "firebase_start_failed" : "firebase_send_failed",
        firebaseAuthCode: native.code,
        flowAbandoned: true,
        intentCleared: true,
      };
    }
    const confirmed = await afterFirebaseNativeSend();
    if (!confirmed.ok) {
      return confirmed;
    }
    return { ok: true, retryAfter: data.retryAfter, delivery: "firebase" };
  }

  return { ok: true, retryAfter: data.retryAfter, delivery: "server" };
}

export async function resendPhoneOtpFlow(phoneE164: string): Promise<StartPhoneOtpResult> {
  const refresh = await resendMobileOtp();
  if (!refresh.ok) {
    const error =
      refresh.body && typeof refresh.body === "object" && (refresh.body as { error?: string }).error === "intent_missing"
        ? "intent_missing"
        : mapSendError(refresh.body);
    return {
      ok: false,
      error,
      retryAfter:
        refresh.body && typeof refresh.body === "object"
          ? (refresh.body as { retryAfter?: number }).retryAfter
          : undefined,
    };
  }

  const data = refresh.data as { ok?: boolean; delivery?: "firebase" | "server"; retryAfter?: number };
  if (!data.ok) {
    return { ok: false, error: mapSendError(data), retryAfter: data.retryAfter };
  }

  if (data.delivery === "firebase") {
    resetNativeFirebasePhoneSession();
    const native = await sendNativeFirebasePhoneOtp(phoneE164);
    if (!native.ok) {
      await abandonMobileOtpFlow();
      return {
        ok: false,
        error: "firebase_send_failed",
        firebaseAuthCode: native.code,
        flowAbandoned: true,
        intentCleared: true,
      };
    }
    const confirmed = await afterFirebaseNativeSend();
    if (!confirmed.ok) return confirmed;
  }

  return { ok: true, retryAfter: data.retryAfter ?? 30, delivery: data.delivery };
}

export async function verifyPhoneOtpCode(code: string) {
  const res = await verifyMobileOtpCode(code);
  if (!res.ok) {
    const body = res.body as { error?: string; nextStep?: string } | null;
    if (body?.error === "flow_mismatch") {
      return {
        ok: false as const,
        error: "flow_mismatch" as const,
        nextStep: body.nextStep === "signup" ? ("signup" as const) : ("signin" as const),
      };
    }
    return { ok: false as const, error: "invalid_code" as const };
  }
  const applied = await applyMobileVerifySession(res.data);
  if (!applied) return { ok: false as const, error: "invalid_code" as const };
  const data = res.data as { userId?: string; isNewUser?: boolean };
  return { ok: true as const, userId: data.userId ?? "", isNewUser: !!data.isNewUser };
}

export async function verifyPhoneOtpWithFirebase(code: string) {
  const native = await confirmNativeFirebasePhoneOtp(code);
  if (!native.ok) {
    if (native.code === "session_lost") {
      return { ok: false as const, error: "firebase_session_lost" as const };
    }
    return { ok: false as const, error: "invalid_code" as const };
  }
  const res = await verifyMobileFirebaseOtp(native.idToken);
  if (!res.ok) {
    return { ok: false as const, error: "invalid_code" as const };
  }
  const applied = await applyMobileVerifySession(res.data);
  if (!applied) return { ok: false as const, error: "invalid_code" as const };
  const data = res.data as { userId?: string; isNewUser?: boolean };
  return { ok: true as const, userId: data.userId ?? "", isNewUser: !!data.isNewUser };
}
