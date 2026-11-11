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
  getNativeFirebasePhoneVerificationIdToken,
  hasNativeFirebasePhoneSession,
  mapNativeFirebaseConfirmError,
  resetNativeFirebasePhoneSession,
  sendNativeFirebasePhoneOtp,
  signOutNativeFirebaseAuth,
  type FirebasePhoneErrorCode,
} from "./firebasePhone";
import { forgetOtpFlowPhone, rememberOtpFlowPhone } from "./mobileOtpFlowPhone";
import { logAuthFailure } from "@/lib/auth/authDiagnostics";
import { firebaseSendFailureMessage } from "@shared/auth/firebaseSendFailureMessage";
export { shouldAutoResendFirebaseOtpOnMount } from "@shared/auth/otpFirebaseRecoveryPolicy";

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
      error: PhoneOtpFlowError | "flow_mismatch";
      retryAfter?: number;
      nextStep?: "signin" | "signup";
      flowAbandoned?: boolean;
      intentCleared?: boolean;
      firebaseAuthCode?: string;
    };

function mapSendFailure(body: unknown): Extract<StartPhoneOtpResult, { ok: false }> {
  if (!body || typeof body !== "object") return { ok: false, error: "send_failed" };
  const payload = body as { error?: string; nextStep?: string; retryAfter?: number };
  if (payload.error === "flow_mismatch") {
    return {
      ok: false,
      error: "flow_mismatch",
      nextStep: payload.nextStep === "signup" ? "signup" : "signin",
    };
  }
  const error = payload.error;
  let mapped: PhoneOtpFlowError = "send_failed";
  if (error === "rate_limited" || error === "rate_limited_phone" || error === "rate_limited_ip") {
    mapped = "rate_limited";
  } else if (error === "delivery_failed") {
    mapped = "delivery_failed";
  } else if (error === "temporarily_unavailable") {
    mapped = "temporarily_unavailable";
  }
  return { ok: false, error: mapped, retryAfter: payload.retryAfter };
}

export function phoneOtpFlowErrorMessage(
  error: PhoneOtpFlowError,
  t: (key: string, options?: Record<string, unknown>) => string,
  retryAfter?: number,
  firebaseAuthCode?: string,
): string {
  switch (error) {
    case "firebase_send_failed":
      return firebaseSendFailureMessage(t, firebaseAuthCode);
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
  if (
    confirm.ok &&
    confirm.data &&
    typeof confirm.data === "object" &&
    (confirm.data as { ok?: boolean }).ok
  ) {
    return { ok: true, delivery: "firebase" };
  }
  await abandonMobileOtpFlow();
  await signOutNativeFirebaseAuth();
  await forgetOtpFlowPhone();
  return { ok: false, error: "firebase_send_failed", flowAbandoned: true, intentCleared: true };
}

async function finalizeFirebaseNativeSend(data: {
  retryAfter?: number;
}): Promise<StartPhoneOtpResult> {
  const confirmed = await afterFirebaseNativeSend();
  if (!confirmed.ok) return confirmed;
  return { ok: true, retryAfter: data.retryAfter, delivery: "firebase" };
}

export async function startPhoneOtpFlow(
  phoneE164: string,
  purpose: OtpPurpose,
  role?: OtpRole,
): Promise<StartPhoneOtpResult> {
  const send = await sendMobileOtp({ phone: phoneE164, purpose, role });
  if (!send.ok) {
    return mapSendFailure(send.body);
  }

  const data = send.data as { ok?: boolean; delivery?: "firebase" | "server"; retryAfter?: number };
  if (!data.ok) {
    return mapSendFailure(data);
  }

  if (data.delivery === "firebase") {
    const native = await sendNativeFirebasePhoneOtp(phoneE164);
    if (!native.ok) {
      await abandonMobileOtpFlow();
      await forgetOtpFlowPhone();
      return {
        ok: false,
        error: native.code === "unavailable" ? "firebase_start_failed" : "firebase_send_failed",
        firebaseAuthCode: native.code,
        flowAbandoned: true,
        intentCleared: true,
      };
    }
    const confirmed = await finalizeFirebaseNativeSend(data);
    if (!confirmed.ok) return confirmed;
    await rememberOtpFlowPhone(phoneE164);
    return confirmed;
  }

  await rememberOtpFlowPhone(phoneE164);
  return { ok: true, retryAfter: data.retryAfter, delivery: "server" };
}

export async function resendPhoneOtpFlow(phoneE164: string): Promise<StartPhoneOtpResult> {
  const refresh = await resendMobileOtp();
  if (!refresh.ok) {
    const body = refresh.body;
    if (body && typeof body === "object" && (body as { error?: string }).error === "intent_missing") {
      return { ok: false, error: "intent_missing" };
    }
    return mapSendFailure(body);
  }

  const data = refresh.data as {
    ok?: boolean;
    delivery?: "firebase" | "server";
    retryAfter?: number;
  };
  if (!data.ok) {
    return mapSendFailure(data);
  }

  if (data.delivery === "firebase") {
    resetNativeFirebasePhoneSession();
    const native = await sendNativeFirebasePhoneOtp(phoneE164);
    if (!native.ok) {
      await abandonMobileOtpFlow();
      await forgetOtpFlowPhone();
      return {
        ok: false,
        error: "firebase_send_failed",
        firebaseAuthCode: native.code,
        flowAbandoned: true,
        intentCleared: true,
      };
    }
    const confirmed = await finalizeFirebaseNativeSend(data);
    if (!confirmed.ok) return confirmed;
    await rememberOtpFlowPhone(phoneE164);
    return { ok: true, retryAfter: data.retryAfter ?? 30, delivery: "firebase" };
  }

  await rememberOtpFlowPhone(phoneE164);
  return { ok: true, retryAfter: data.retryAfter ?? 30, delivery: data.delivery };
}

/** Re-establish native Firebase SMS session when the in-memory confirmation was lost. */
export async function recoverNativeFirebaseOtpSession(
  phoneE164: string,
): Promise<StartPhoneOtpResult> {
  if (hasNativeFirebasePhoneSession()) {
    return { ok: true, delivery: "firebase" };
  }
  return resendPhoneOtpFlow(phoneE164);
}

async function verifyWithFirebaseIdToken(idToken: string) {
  const res = await verifyMobileFirebaseOtp(idToken);
  if (!res.ok) {
    // Firebase already accepted the code; a 5xx is our failure, not a wrong code.
    if (res.status >= 500) return { ok: false as const, error: "server_error" as const };
    const body = res.body as { error?: string; nextStep?: string } | null;
    if (body?.error === "flow_mismatch") {
      return {
        ok: false as const,
        error: "flow_mismatch" as const,
        nextStep: body.nextStep === "signup" ? ("signup" as const) : ("signin" as const),
      };
    }
    return { ok: false as const, error: "session_expired" as const };
  }
  const applied = await applyMobileVerifySession(res.data);
  if (!applied) return { ok: false as const, error: "session_expired" as const };
  const data = res.data as { userId?: string; isNewUser?: boolean };
  await forgetOtpFlowPhone();
  await signOutNativeFirebaseAuth();
  return { ok: true as const, userId: data.userId ?? "", isNewUser: !!data.isNewUser };
}

export async function completeNativeFirebaseAutoVerification(phoneE164: string) {
  const auto = await getNativeFirebasePhoneVerificationIdToken(phoneE164);
  if (!auto.ok) {
    return { ok: false as const, error: "firebase_session_lost" as const };
  }
  return verifyWithFirebaseIdToken(auto.idToken);
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
  await forgetOtpFlowPhone();
  return { ok: true as const, userId: data.userId ?? "", isNewUser: !!data.isNewUser };
}

export async function verifyPhoneOtpWithFirebase(code: string, phoneE164: string) {
  const native = await confirmNativeFirebasePhoneOtp(code, phoneE164);
  if (!native.ok) {
    const mapped = mapNativeFirebaseConfirmError(native.code as FirebasePhoneErrorCode);
    if (mapped === "session_lost") {
      return { ok: false as const, error: "firebase_session_lost" as const };
    }
    logAuthFailure("firebase_confirm", native.code);
    return { ok: false as const, error: "invalid_code" as const };
  }
  return verifyWithFirebaseIdToken(native.idToken);
}

export async function abandonPhoneOtpFlow() {
  const res = await abandonMobileOtpFlow();
  await signOutNativeFirebaseAuth();
  await forgetOtpFlowPhone();
  return res;
}
