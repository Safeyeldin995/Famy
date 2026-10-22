import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, timingSafeEqual } from "crypto";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import type { AuthFlowPurpose, AuthFlowRole } from "./authIntent.types";
import {
  MOBILE_AUTH_COOKIE_NAMES,
  OTP_PENDING_COOKIE,
  SET_PASSWORD_COOKIE,
} from "./authIntent.constants";

export { MOBILE_AUTH_COOKIE_NAMES, OTP_PENDING_COOKIE, SET_PASSWORD_COOKIE };

type MobileCookieEntry = { value: string; maxAge: number };

type MobileAuthCookieStore = {
  entries: Map<string, MobileCookieEntry>;
  cleared: Set<string>;
};

const mobileAuthCookieStore = new AsyncLocalStorage<MobileAuthCookieStore>();

function activeMobileAuthCookies(): MobileAuthCookieStore | undefined {
  return mobileAuthCookieStore.getStore();
}

function readCookie(name: string): string | undefined {
  const mobile = activeMobileAuthCookies();
  if (mobile) {
    return mobile.entries.get(name)?.value;
  }
  return getCookie(name);
}

function writeCookie(name: string, value: string, maxAge: number): void {
  const mobile = activeMobileAuthCookies();
  if (mobile) {
    mobile.cleared.delete(name);
    mobile.entries.set(name, { value, maxAge });
    return;
  }
  setCookie(name, value, cookieOptions(maxAge));
}

function removeCookie(name: string): void {
  const mobile = activeMobileAuthCookies();
  if (mobile) {
    mobile.entries.delete(name);
    mobile.cleared.add(name);
    return;
  }
  deleteCookie(name, { path: "/" });
}

export function parseRequestCookieValue(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    if (key !== name) continue;
    return trimmed.slice(eq + 1);
  }
  return undefined;
}

function buildSetCookieHeader(name: string, value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  if (maxAge <= 0) {
    return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  }
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function formatMobileAuthSetCookieHeaders(store: MobileAuthCookieStore): string[] {
  const headers: string[] = [];
  for (const name of store.cleared) {
    headers.push(buildSetCookieHeader(name, "", 0));
  }
  for (const [name, entry] of store.entries) {
    headers.push(buildSetCookieHeader(name, entry.value, entry.maxAge));
  }
  return headers;
}

function createMobileAuthCookieStore(cookieHeader: string | undefined): MobileAuthCookieStore {
  const store: MobileAuthCookieStore = { entries: new Map(), cleared: new Set() };
  for (const name of MOBILE_AUTH_COOKIE_NAMES) {
    const value = parseRequestCookieValue(cookieHeader, name);
    if (value) {
      store.entries.set(name, { value, maxAge: OTP_TTL_SECONDS });
    }
  }
  return store;
}

/** Run OTP/password-intent handlers with cookies from the native app Cookie header. */
export async function withMobileAuthCookies<T>(
  cookieHeader: string | undefined,
  fn: () => Promise<T>,
): Promise<{ result: T; setCookieHeaders: string[] }> {
  const store = createMobileAuthCookieStore(cookieHeader);
  const result = await mobileAuthCookieStore.run(store, fn);
  return { result, setCookieHeaders: formatMobileAuthSetCookieHeaders(store) };
}
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
  /** False for Firebase until client SMS send succeeds; server OTP sets true on issue. */
  deliveryConfirmed?: boolean;
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
  deliveryConfirmed?: boolean;
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
    deliveryConfirmed: params.deliveryConfirmed ?? true,
  };
  writeCookie(OTP_PENDING_COOKIE, signPayload(payload), OTP_TTL_SECONDS);
}

/** Marks Firebase (or other client-delivered) OTP as successfully sent without resetting TTL. */
export function confirmOtpPendingDelivery(): boolean {
  const pending = readOtpPendingIntent();
  if (!pending || pending.deliveryConfirmed !== false) return false;
  const now = Math.floor(Date.now() / 1000);
  const maxAge = Math.max(1, pending.exp - now);
  const updated: OtpPendingIntent = { ...pending, deliveryConfirmed: true };
  writeCookie(OTP_PENDING_COOKIE, signPayload(updated), maxAge);
  return true;
}

export function readOtpPendingIntent(): OtpPendingIntent | null {
  return readSignedPayload<OtpPendingIntent>(readCookie(OTP_PENDING_COOKIE));
}

export function clearOtpPendingIntent(): void {
  removeCookie(OTP_PENDING_COOKIE);
}

export function setSetPasswordIntent(params: { authId: string }): void {
  const now = Math.floor(Date.now() / 1000);
  const payload: SetPasswordIntent = {
    v: TOKEN_VERSION,
    authId: params.authId,
    exp: now + SET_PASSWORD_TTL_SECONDS,
  };
  writeCookie(SET_PASSWORD_COOKIE, signPayload(payload), SET_PASSWORD_TTL_SECONDS);
}

export function readSetPasswordIntent(): SetPasswordIntent | null {
  return readSignedPayload<SetPasswordIntent>(readCookie(SET_PASSWORD_COOKIE));
}

export function consumeSetPasswordIntent(): SetPasswordIntent | null {
  const intent = readSetPasswordIntent();
  if (!intent) return null;
  removeCookie(SET_PASSWORD_COOKIE);
  return intent;
}

export function clearSetPasswordIntent(): void {
  removeCookie(SET_PASSWORD_COOKIE);
}
