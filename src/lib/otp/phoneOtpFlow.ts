import { isClientFirebaseOtpProvider } from "@/lib/otp/otpProviderConfig";
import { otpService, type Purpose, type Role } from "@/lib/otp/OtpService";

type StartPhoneOtpResult =
  { ok: true; retryAfter?: number } | { ok: false; message: string; retryAfter?: number };

export async function startPhoneOtpFlow(
  phoneE164: string,
  purpose: Purpose,
  role?: Role,
): Promise<StartPhoneOtpResult> {
  if (isClientFirebaseOtpProvider()) {
    const begin = await otpService.beginFirebaseOtp(phoneE164, purpose, role);
    if (!begin.ok) {
      return {
        ok: false,
        message: begin.message ?? "Could not start phone verification.",
        retryAfter: begin.retryAfter,
      };
    }

    try {
      const { sendFirebasePhoneOtp } = await import("@/lib/otp/firebaseAuth.browser");
      await sendFirebasePhoneOtp(phoneE164);
      return { ok: true };
    } catch {
      await otpService.abandonOtpFlow();
      return { ok: false, message: "Could not send verification SMS. Try again later." };
    }
  }

  const send = await otpService.sendOtp(phoneE164, purpose, role);
  if (!send.ok) {
    return {
      ok: false,
      message: send.message ?? "Could not send code. Try again later.",
      retryAfter: send.retryAfter,
    };
  }
  return { ok: true };
}

export async function resendPhoneOtpFlow(phoneE164: string): Promise<StartPhoneOtpResult> {
  const refresh = await otpService.resendOtp();
  if (!refresh.ok) {
    return {
      ok: false,
      message: refresh.message ?? "Please wait before requesting another code.",
      retryAfter: refresh.retryAfter,
    };
  }

  if (!isClientFirebaseOtpProvider()) {
    return { ok: true, retryAfter: refresh.retryAfter ?? 30 };
  }

  try {
    const { sendFirebasePhoneOtp } = await import("@/lib/otp/firebaseAuth.browser");
    await sendFirebasePhoneOtp(phoneE164);
    return { ok: true, retryAfter: refresh.retryAfter ?? 30 };
  } catch {
    return { ok: false, message: "Could not send verification SMS. Try again later." };
  }
}

export async function verifyPhoneOtpCode(code: string) {
  if (isClientFirebaseOtpProvider()) {
    try {
      const { confirmFirebasePhoneOtp } = await import("@/lib/otp/firebaseAuth.browser");
      const idToken = await confirmFirebasePhoneOtp(code);
      return otpService.verifyFirebaseOtp(idToken);
    } catch {
      return { ok: false as const, error: "invalid_code" as const };
    }
  }
  return otpService.verifyOtp(code);
}
