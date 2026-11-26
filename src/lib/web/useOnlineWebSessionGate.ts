import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth/useAuth";
import { useMyProfile } from "@/lib/db/queries";
import { resolveOnlinePostAuthTarget } from "@/lib/auth/onlineWebAuth";
import { isOnlineWebProtectedPath } from "./onlineWebSession";
import { ONLINE_WEB_ROUTE_IDS } from "./onlineWebSurface";

/**
 * Client-side session check for protected online pages. Route `beforeLoad`
 * guards skip during SSR (the session is in browser storage), so this runs after
 * hydration and sends signed-out visitors to login with the full href kept.
 * Signed-in students without a name or contact phone (email / Google sign-ups)
 * finish their profile first, because bookings need a phone.
 * Returns whether the page content may render.
 */
export function useOnlineWebSessionGate(): boolean {
  const nav = useNavigate();
  const { pathname, href } = useRouterState({
    select: (s) => ({ pathname: s.location.pathname, href: s.location.href }),
  });
  const { loading, isAuthenticated } = useAuth();
  const isProtected = isOnlineWebProtectedPath(pathname);
  const profileQ = useMyProfile();
  const checkProfile = isProtected && !loading && isAuthenticated;
  const profileIncomplete =
    checkProfile &&
    !!profileQ.data &&
    resolveOnlinePostAuthTarget({
      profilePhone: profileQ.data.phone,
      profileFullName: profileQ.data.full_name,
      returnTo: href,
    }) === ONLINE_WEB_ROUTE_IDS.completeProfile;

  useEffect(() => {
    if (!isProtected || loading || isAuthenticated) return;
    void nav({ to: ONLINE_WEB_ROUTE_IDS.login, search: { returnTo: href }, replace: true });
  }, [isProtected, loading, isAuthenticated, href, nav]);

  useEffect(() => {
    if (!profileIncomplete) return;
    void nav({
      to: ONLINE_WEB_ROUTE_IDS.completeProfile,
      search: { returnTo: href },
      replace: true,
    });
  }, [profileIncomplete, href, nav]);

  if (!isProtected) return true;
  if (loading || !isAuthenticated) return false;
  // Render while the profile loads or fails; booking itself still enforces the phone.
  return !profileIncomplete;
}
