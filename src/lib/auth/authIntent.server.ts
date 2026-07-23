import { createHmac, timingSafeEqual } from "crypto";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import type { AuthFlowPurpose, AuthFlowRole } from "./authIntent.types";

const OTP_PENDING_COOKIE = "famy_otp_pending";
const SET_PASSWORD_COOKIE = "famy_set_password_auth";
const OTP_TTL_SECONDS = 5 * 60;
const SET_PASSWORD_TTL_SECONDS = 10 * 60;
const TOKEN_VERSION = 1 as const;

type SignedPayload = {
  v: typeof TOKEN_VERSION;
  exp: number;
};

export type OtpPendingIntent = SignedPayload & {
  phone: string;
  purpose: AuthFlowPurpose;
  role?: AuthFlowRole;
  otpExp: number;
  resendAt: number;
};

export type SetPasswordIntent = SignedPayload & {
  authId: string;
};

export class AuthIntentConfigurationError extends Error {
  constructor() {
    super("AUTH_INTENT_SECRET is not configured");
    this.name = "AuthIntentConfigurationError";
  }
}

export function requireAuthIntentSecret(): string {
  const secret = process.env.AUTH_INTENT_SECRET?.trim();
  if (!secret) {
    throw new AuthIntentConfigurationError();
  }
  return secret;
}

function intentSecret(): string {
  return requireAuthIntentSecret();
}

function signPayload(payload: SignedPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", intentSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function readSignedPayload<T extends SignedPayload>(token: string | undefined): T | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = createHmac("sha256", intentSecret()).update(body).digest("base64url");
  if (signature.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  let payload: T;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }

  if (payload.v !== TOKEN_VERSION || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function maskPhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return phone;
  const tail = digits.slice(-4);
  if (digits.startsWith("20") && digits.length >= 11) {
    return `+20 *** *** ${tail}`;
  }
  const country = digits.slice(0, Math.min(3, digits.length - 4));
  return `+${country} *** *** ${tail}`;
}

export function setOtpPendingIntent(params: {
  phone: string;
  purpose: AuthFlowPurpose;
  role?: AuthFlowRole;
  retryAfterSeconds: number;
}): void {
  const now = Math.floor(Date.now() / 1000);
  const payload: OtpPendingIntent = {
    v: TOKEN_VERSION,
    phone: params.phone,
    purpose: params.purpose,
    role: params.role,
    otpExp: now + OTP_TTL_SECONDS,
    resendAt: now + params.retryAfterSeconds,
    exp: now + OTP_TTL_SECONDS,
  };
  setCookie(OTP_PENDING_COOKIE, signPayload(payload), cookieOptions(OTP_TTL_SECONDS));
}

export function readOtpPendingIntent(): OtpPendingIntent | null {
  return readSignedPayload<OtpPendingIntent>(getCookie(OTP_PENDING_COOKIE));
}

export function clearOtpPendingIntent(): void {
  deleteCookie(OTP_PENDING_COOKIE, { path: "/" });
}

export function setSetPasswordIntent(params: { authId: string }): void {
  const now = Math.floor(Date.now() / 1000);
  const payload: SetPasswordIntent = {
    v: TOKEN_VERSION,
    authId: params.authId,
    exp: now + SET_PASSWORD_TTL_SECONDS,
  };
  setCookie(SET_PASSWORD_COOKIE, signPayload(payload), cookieOptions(SET_PASSWORD_TTL_SECONDS));
}

export function readSetPasswordIntent(): SetPasswordIntent | null {
  return readSignedPayload<SetPasswordIntent>(getCookie(SET_PASSWORD_COOKIE));
}

export function consumeSetPasswordIntent(): SetPasswordIntent | null {
  const intent = readSetPasswordIntent();
  if (!intent) return null;
  deleteCookie(SET_PASSWORD_COOKIE, { path: "/" });
  return intent;
}

export function clearSetPasswordIntent(): void {
  deleteCookie(SET_PASSWORD_COOKIE, { path: "/" });
}
