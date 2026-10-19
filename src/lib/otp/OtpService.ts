/**
 * OtpService — thin wrappers around server fns + client-side password sign-in.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  abandonOtpFlowFn,
  beginFirebaseOtpFn,
  confirmFirebaseOtpSentFn,
  completePasswordSetupFn,
  getOtpScreenContextFn,
  getSetPasswordContextFn,
  resendOtpFn,
  sendOtpFn,
  verifyFirebaseOtpFn,
  verifyOtpFn,
} from "@/lib/otp.functions";
import { authEmailForPhone } from "@/lib/auth/authEmail";
import { normalizePhoneE164 } from "@/lib/otp/normalizePhone";
import type { OtpScreenContext, SetPasswordContext } from "@/lib/auth/authIntent.types";

export type Purpose = "signup" | "reset";
export type Role = "customer" | "provider";

export type SendOtpResult =
  | { ok: true; retryAfter?: number; requiresVerification?: true }
  | { ok: false; error?: string; message?: string; retryAfter?: number };
export type VerifyOtpResult =
  | { ok: true; userId: string; isNewUser: boolean }
  | {
      ok: false;
      error: "invalid_code" | "flow_mismatch" | "unknown";
      nextStep?: "signin" | "signup";
      message?: string;
    };

export type CompletePasswordSetupResult =
  | { ok: true; purpose: Purpose; role?: Role }
  | {
      ok: false;
      error: "authorization_missing" | "restart_required" | "sign_in_required";
      message: string;
      nextStep?: "signup" | "reset";
      passwordUpdated?: boolean;
    };

/** Rejects if `promise` has not settled within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// Once the server has saved the password, a stuck client auth step must never
// leave the screen on "Saving..." — fall back to "sign in with your new password".
const POST_SAVE_STEP_TIMEOUT_MS = 15000;
const PASSWORD_SAVE_TIMEOUT_MS = 45000;

function logClientPasswordSetupSession(
  stage: string,
  details: Record<string, string | boolean | null | undefined>,
) {
  if (!import.meta.env.DEV) return;
  console.info("[password.setup.session]", stage, details);
}

export function normalizePhone(raw: string, defaultCountry = "20"): string {
  return normalizePhoneE164(raw, defaultCountry);
}

export const otpService = {
  async getOtpScreenContext(): Promise<OtpScreenContext> {
    return getOtpScreenContextFn();
  },

  async getSetPasswordContext(): Promise<SetPasswordContext> {
    return getSetPasswordContextFn();
  },

  async sendOtp(phone: string, purpose: Purpose, role?: Role): Promise<SendOtpResult> {
    try {
      const res = await sendOtpFn({ data: { phone, purpose, role } });
      return res as SendOtpResult;
    } catch {
      return { ok: false, error: "send_failed", message: "Could not send code. Try again later." };
    }
  },

  async beginFirebaseOtp(phone: string, purpose: Purpose, role?: Role): Promise<SendOtpResult> {
    try {
      const res = await beginFirebaseOtpFn({ data: { phone, purpose, role } });
      return res as SendOtpResult;
    } catch {
      return {
        ok: false,
        error: "send_failed",
        message: "Could not start phone verification. Try again later.",
      };
    }
  },

  async confirmFirebaseOtpSent(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await confirmFirebaseOtpSentFn();
      return res as { ok: boolean; error?: string };
    } catch {
      return { ok: false, error: "intent_missing" };
    }
  },

  async resendOtp(): Promise<SendOtpResult> {
    try {
      const res = await resendOtpFn();
      return res as SendOtpResult;
    } catch {
      return { ok: false, error: "send_failed", message: "Could not send code. Try again later." };
    }
  },

  async verifyOtp(code: string): Promise<VerifyOtpResult> {
    try {
      const res = (await verifyOtpFn({ data: { code } })) as any;
      if (!res.ok) return res;
      const { error } = await supabase.auth.setSession({
        access_token: res.access_token,
        refresh_token: res.refresh_token,
      });
      if (error) return { ok: false, error: "unknown" };
      const { data: sessionData } = await supabase.auth.getSession();
      logClientPasswordSetupSession("client-after-verify-otp", {
        hasSession: !!sessionData.session,
        userId: sessionData.session?.user?.id ?? null,
      });
      return { ok: true, userId: res.userId, isNewUser: res.isNewUser };
    } catch {
      return { ok: false, error: "unknown" };
    }
  },

  async verifyFirebaseOtp(idToken: string): Promise<VerifyOtpResult> {
    try {
      const res = (await verifyFirebaseOtpFn({ data: { idToken } })) as any;
      if (!res.ok) return res;
      const { error } = await supabase.auth.setSession({
        access_token: res.access_token,
        refresh_token: res.refresh_token,
      });
      if (error) return { ok: false, error: "unknown" };
      const { data: sessionData } = await supabase.auth.getSession();
      logClientPasswordSetupSession("client-after-verify-firebase-otp", {
        hasSession: !!sessionData.session,
        userId: sessionData.session?.user?.id ?? null,
      });
      return { ok: true, userId: res.userId, isNewUser: res.isNewUser };
    } catch {
      return { ok: false, error: "unknown" };
    }
  },

  async completePasswordSetup(password: string): Promise<CompletePasswordSetupResult> {
    try {
      const { data: beforeSession } = await supabase.auth.getSession();
      logClientPasswordSetupSession("client-before-complete", {
        hasSession: !!beforeSession.session,
        userId: beforeSession.session?.user?.id ?? null,
      });

      const res = (await withTimeout(
        completePasswordSetupFn({ data: { password } }),
        PASSWORD_SAVE_TIMEOUT_MS,
      )) as {
        ok: boolean;
        error?: string;
        message?: string;
        passwordUpdated?: boolean;
        userId?: string;
        authEmail?: string;
        purpose?: Purpose;
        role?: Role;
        nextStep?: "signup" | "reset";
      };

      if (!res.ok) {
        if (res.error === "restart_required") {
          await withTimeout(supabase.auth.signOut(), POST_SAVE_STEP_TIMEOUT_MS).catch(() => {});
          return {
            ok: false,
            error: "restart_required",
            message:
              res.message ??
              "We could not finish setting your password. Please verify your phone again.",
            nextStep: res.nextStep,
          };
        }
        if (res.error === "sign_in_required" && res.passwordUpdated) {
          await withTimeout(supabase.auth.signOut(), POST_SAVE_STEP_TIMEOUT_MS).catch(() => {});
          return {
            ok: false,
            error: "sign_in_required",
            message: res.message ?? "Password saved. Please sign in with your new password.",
            passwordUpdated: true,
          };
        }
        return {
          ok: false,
          error: (res.error ?? "authorization_missing") as
            "authorization_missing" | "restart_required" | "sign_in_required",
          message: res.message ?? "Could not set password. Try again.",
          nextStep: res.nextStep,
        };
      }

      const savedButSignInRequired = {
        ok: false as const,
        error: "sign_in_required" as const,
        message: "Password saved. Please sign in with your new password.",
        passwordUpdated: true as const,
      };

      let signInError: { code?: string } | null = null;
      try {
        await withTimeout(supabase.auth.signOut(), POST_SAVE_STEP_TIMEOUT_MS);
        ({ error: signInError } = await withTimeout(
          supabase.auth.signInWithPassword({ email: res.authEmail!, password }),
          POST_SAVE_STEP_TIMEOUT_MS,
        ));
      } catch {
        logClientPasswordSetupSession("client-signin-timeout", {});
        return savedButSignInRequired;
      }

      if (signInError) {
        logClientPasswordSetupSession("client-signin-failed", {
          code: signInError.code ?? "unknown",
        });
        return {
          ok: false,
          error: "sign_in_required",
          message: "Password saved. Please sign in with your new password.",
          passwordUpdated: true,
        };
      }

      let user: { id: string } | null = null;
      let userError: { code?: string } | null = null;
      try {
        ({
          data: { user },
          error: userError,
        } = await withTimeout(supabase.auth.getUser(), POST_SAVE_STEP_TIMEOUT_MS));
      } catch {
        return savedButSignInRequired;
      }
      logClientPasswordSetupSession("client-after-complete", {
        hasSession: !!user,
        userId: user?.id ?? null,
        matchesAuthorization: user?.id === res.userId,
        authErrorCode: userError?.code ?? null,
      });

      if (userError || !user || user.id !== res.userId) {
        await withTimeout(supabase.auth.signOut(), POST_SAVE_STEP_TIMEOUT_MS).catch(() => {});
        return {
          ok: false,
          error: "sign_in_required",
          message: "Password saved. Please sign in with your new password.",
          passwordUpdated: true,
        };
      }

      return { ok: true, purpose: res.purpose!, role: res.role };
    } catch {
      return {
        ok: false,
        error: "authorization_missing",
        message: "Could not set password. Try again.",
      };
    }
  },

  async abandonOtpFlow() {
    return abandonOtpFlowFn();
  },

  /** Returning user sign-in: pure client. */
  async signInWithPassword(phone: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email: authEmailForPhone(phone),
      password,
    });
    if (error) return { ok: false as const, error: "invalid_credentials" as const };
    return { ok: true as const };
  },
};
