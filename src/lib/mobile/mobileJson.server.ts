import { getRequestHeader } from "@tanstack/react-start/server";
import { withMobileAuthCookies } from "@/lib/auth/authIntent.server";

export function mobileJson(body: unknown, status = 200, setCookieHeaders: string[] = []) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  for (const cookie of setCookieHeaders) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export async function runWithMobileAuthCookies<T>(fn: () => Promise<T>) {
  const cookieHeader = getRequestHeader("cookie") ?? undefined;
  return withMobileAuthCookies(cookieHeader, fn);
}
