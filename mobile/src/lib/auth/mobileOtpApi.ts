import { appConfig, supabase } from "@/lib/supabase";
import {
  clearMobileAuthCookies,
  mergeMobileAuthSetCookies,
  mobileAuthCookieHeader,
} from "./mobileAuthCookies";

export type OtpPurpose = "signup" | "reset";
export type OtpRole = "customer" | "provider";

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; body: unknown };

function apiOrigin() {
  return appConfig.webOrigin.replace(/\/$/, "");
}

function collectSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

async function mobileAuthFetch(path: string, init: RequestInit = {}): Promise<ApiResult<unknown>> {
  const cookie = await mobileAuthCookieHeader();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (cookie) headers.set("Cookie", cookie);

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }

  const response = await fetch(`${apiOrigin()}${path}`, { ...init, headers });
  await mergeMobileAuthSetCookies(collectSetCookies(response));

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    return { ok: false, status: response.status, body };
  }
  return { ok: true, data: body };
}

export async function sendMobileOtp(params: {
  phone: string;
  purpose: OtpPurpose;
  role?: OtpRole;
}) {
  return mobileAuthFetch("/api/mobile/otp/send", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function resendMobileOtp() {
  return mobileAuthFetch("/api/mobile/otp/resend", { method: "POST", body: "{}" });
}

export async function confirmMobileFirebaseOtpSent() {
  return mobileAuthFetch("/api/mobile/otp/confirm-firebase", {
    method: "POST",
    body: "{}",
  });
}

export async function verifyMobileOtpCode(code: string) {
  return mobileAuthFetch("/api/mobile/otp/verify", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function verifyMobileFirebaseOtp(idToken: string) {
  return mobileAuthFetch("/api/mobile/otp/verify", {
    method: "POST",
    body: JSON.stringify({ idToken }),
  });
}

export async function fetchMobileOtpContext() {
  return mobileAuthFetch("/api/mobile/otp/context", { method: "GET" });
}

export async function abandonMobileOtpFlow() {
  const res = await mobileAuthFetch("/api/mobile/otp/abandon", {
    method: "POST",
    body: "{}",
  });
  await clearMobileAuthCookies();
  return res;
}

export async function fetchMobileSetPasswordContext() {
  return mobileAuthFetch("/api/mobile/auth/set-password-context", { method: "GET" });
}

export async function completeMobilePasswordSetup(password: string) {
  return mobileAuthFetch("/api/mobile/auth/complete-password", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function applyMobileVerifySession(data: unknown) {
  if (!data || typeof data !== "object") return false;
  const tokens = data as {
    ok?: boolean;
    access_token?: string;
    refresh_token?: string;
  };
  if (!tokens.ok || !tokens.access_token || !tokens.refresh_token) return false;
  const { error } = await supabase.auth.setSession({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  });
  return !error;
}
