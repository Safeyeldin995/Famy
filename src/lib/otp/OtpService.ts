/**
 * OtpService — thin wrappers around server fns + client-side password sign-in.
 */
import { supabase } from "@/integrations/supabase/client";
import { sendOtpFn, verifyOtpFn, authEmailForPhone } from "@/lib/otp.functions";
import { normalizePhoneE164 } from "@/lib/otp/normalizePhone";

export type Purpose = "signup" | "reset";
export type Role = "customer" | "provider";

export type SendOtpResult =
  | { ok: true; retryAfter?: number; requiresVerification?: true }
  | { ok: false; error?: string; message?: string; retryAfter?: number };
export type VerifyOtpResult =
  | { ok: true; userId: string; isNewUser: boolean }
  | {
      ok: false;
      error:
        | "invalid_code"
        | "expired"
        | "max_attempts"
        | "already_registered"
        | "no_account"
        | "otp_verification_required"
        | "unknown";
      message?: string;
    };

export function normalizePhone(raw: string, defaultCountry = "20"): string {
  return normalizePhoneE164(raw, defaultCountry);
}

export const otpService = {
  async sendOtp(phone: string, purpose: Purpose): Promise<SendOtpResult> {
    try {
      const res = await sendOtpFn({ data: { phone, purpose } });
      return res as SendOtpResult;
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "send_failed" };
    }
  },

  async verifyOtp(
    phone: string,
    code: string,
    purpose: Purpose,
    role?: Role,
  ): Promise<VerifyOtpResult> {
    try {
      const res = (await verifyOtpFn({ data: { phone, code, purpose, role } })) as any;
      if (!res.ok) return res;
      const { error } = await supabase.auth.setSession({
        access_token: res.access_token,
        refresh_token: res.refresh_token,
      });
      if (error) return { ok: false, error: "unknown", message: error.message };
      return { ok: true, userId: res.userId, isNewUser: res.isNewUser };
    } catch (e: any) {
      return { ok: false, error: "unknown", message: e?.message };
    }
  },

  /** Returning user sign-in: pure client. */
  async signInWithPassword(phone: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email: authEmailForPhone(phone),
      password,
    });
    if (error) return { ok: false as const, error: "invalid_credentials" as const, message: error.message };
    return { ok: true as const };
  },

  /** Update password for the currently signed-in user. */
  async setPassword(password: string) {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { ok: false as const, message: error.message };
    return { ok: true as const };
  },
};
