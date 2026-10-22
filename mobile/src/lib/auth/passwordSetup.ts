import { supabase } from "@/lib/supabase";
import { completeMobilePasswordSetup } from "./mobileOtpApi";
import { clearMobileAuthCookies } from "./mobileAuthCookies";

export type CompletePasswordResult =
  | { ok: true; purpose: "signup" | "reset"; role?: "customer" | "provider" }
  | {
      ok: false;
      error: "authorization_missing" | "restart_required" | "sign_in_required";
      message: string;
      nextStep?: "signup" | "reset";
      passwordUpdated?: boolean;
    };

export async function completePasswordSetup(password: string): Promise<CompletePasswordResult> {
  const res = await completeMobilePasswordSetup(password);
  if (!res.ok) {
    const body = (res.body ?? {}) as {
      error?: CompletePasswordResult extends { ok: false } ? string : never;
      message?: string;
      nextStep?: "signup" | "reset";
      passwordUpdated?: boolean;
    };
    return {
      ok: false,
      error: (body.error ?? "authorization_missing") as
        | "authorization_missing"
        | "restart_required"
        | "sign_in_required",
      message: body.message ?? "Could not set password. Try again.",
      nextStep: body.nextStep,
      passwordUpdated: body.passwordUpdated,
    };
  }

  const data = res.data as {
    ok?: boolean;
    purpose?: "signup" | "reset";
    role?: "customer" | "provider";
    authEmail?: string;
    userId?: string;
  };

  if (!data.ok || !data.authEmail || !data.userId) {
    return {
      ok: false,
      error: "authorization_missing",
      message: "Could not set password. Try again.",
    };
  }

  await supabase.auth.signOut();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: data.authEmail,
    password,
  });
  await clearMobileAuthCookies();

  if (signInError) {
    return {
      ok: false,
      error: "sign_in_required",
      message: "Password saved. Please sign in with your new password.",
      passwordUpdated: true,
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== data.userId) {
    return {
      ok: false,
      error: "sign_in_required",
      message: "Password saved. Please sign in with your new password.",
      passwordUpdated: true,
    };
  }

  return { ok: true, purpose: data.purpose ?? "signup", role: data.role };
}
