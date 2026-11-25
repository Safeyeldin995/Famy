import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { ONLINE_WEB_PREFIX, ONLINE_WEB_ROUTE_IDS } from "./onlineWebSurface";

/** Online web pages that need a signed-in browser session. */
export function isOnlineWebProtectedPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === `${ONLINE_WEB_PREFIX}/wallet`) return true;
  if (p === `${ONLINE_WEB_PREFIX}/lessons` || p.startsWith(`${ONLINE_WEB_PREFIX}/lessons/`))
    return true;
  if (p.startsWith(`${ONLINE_WEB_PREFIX}/provider/`)) return true;
  return /^\/online\/tutors\/[^/]+\/request$/.test(p);
}

/**
 * Only same-site online paths may be used as a post-login destination
 * (keeps the full path + search, rejects open redirects).
 */
export function safeOnlineWebReturnTo(raw: string | null | undefined, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  if (!raw.startsWith(`${ONLINE_WEB_PREFIX}/`) && raw !== ONLINE_WEB_PREFIX) return fallback;
  if (raw.startsWith("//") || raw.includes("\\")) return fallback;
  return raw;
}

/**
 * Route `beforeLoad` guard. Pass the full requested href (path + search) so the
 * lesson / Paymob-return URL survives sign-in.
 *
 * Skipped during SSR: the Supabase session lives in browser localStorage, so the
 * server never sees it and would bounce signed-in users to login on refresh.
 * `useOnlineWebSessionGate` (in the online layout) enforces it after hydration.
 */
export async function requireOnlineWebSession(
  returnTo: string,
  isServer = typeof window === "undefined",
) {
  if (isServer) return;
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  throw redirect({
    to: ONLINE_WEB_ROUTE_IDS.login,
    search: { returnTo },
    replace: true,
  });
}
