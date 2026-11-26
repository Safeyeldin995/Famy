import { supabase } from "@/integrations/supabase/client";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";

/** Where email confirmation and Google sign-in send the browser back to. */
export function onlineAuthCallbackUrl(origin: string) {
  return `${origin}${ONLINE_WEB_ROUTE_IDS.authCallback}`;
}

/** Where the password reset email sends the browser back to. */
export function onlineResetPasswordUrl(origin: string) {
  return `${origin}${ONLINE_WEB_ROUTE_IDS.resetPassword}`;
}

export const ONLINE_PASSWORD_MIN_LENGTH = 8;

export function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim());
}

/**
 * After any sign-in on the online website: students without a name or a
 * contact phone finish their profile first (bookings need a phone), everyone
 * else continues to where they were going.
 */
export function resolveOnlinePostAuthTarget(input: {
  profilePhone: string | null | undefined;
  profileFullName: string | null | undefined;
  returnTo: string;
}): string {
  if (!input.profilePhone?.trim() || !input.profileFullName?.trim()) {
    return ONLINE_WEB_ROUTE_IDS.completeProfile;
  }
  return input.returnTo;
}

export type EmailAuthError =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "already_registered"
  | "weak_password"
  | "rate_limited"
  | "failed";

/** Maps Supabase auth errors to our own codes (and from there to i18n keys). */
export function emailAuthErrorCode(error: { message?: string; code?: string; status?: number } | null): EmailAuthError {
  const code = (error?.code ?? "").toLowerCase();
  const message = (error?.message ?? "").toLowerCase();
  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "invalid_credentials";
  }
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return "email_not_confirmed";
  }
  if (code === "user_already_exists" || message.includes("already registered")) {
    return "already_registered";
  }
  if (code === "weak_password" || message.includes("password should be")) return "weak_password";
  if (error?.status === 429 || code.includes("rate_limit") || message.includes("rate limit")) {
    return "rate_limited";
  }
  return "failed";
}

export function emailAuthErrorKey(code: EmailAuthError): string {
  return `onlineWeb.auth.errors.${code}`;
}

export async function signUpOnlineStudentWithEmail(input: {
  email: string;
  password: string;
  fullName: string;
}) {
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    options: {
      emailRedirectTo: onlineAuthCallbackUrl(window.location.origin),
      // handle_new_user() reads these: customer role, profile name.
      data: { full_name: input.fullName.trim(), signup_role: "customer" },
    },
  });
  if (error) return { ok: false as const, error: emailAuthErrorCode(error) };
  // With "Confirm email" on, Supabase returns no session and an empty identities
  // list when the email already has an account (it does not reveal it as an error).
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    return { ok: false as const, error: "already_registered" as const };
  }
  return { ok: true as const, needsConfirmation: !data.session };
}

export async function signInOnlineWithEmail(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) return { ok: false as const, error: emailAuthErrorCode(error) };
  return { ok: true as const };
}

export async function sendOnlinePasswordResetEmail(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: onlineResetPasswordUrl(window.location.origin),
  });
  if (error) return { ok: false as const, error: emailAuthErrorCode(error) };
  return { ok: true as const };
}

export async function resendOnlineSignupConfirmation(email: string) {
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: onlineAuthCallbackUrl(window.location.origin) },
  });
  if (error) return { ok: false as const, error: emailAuthErrorCode(error) };
  return { ok: true as const };
}
