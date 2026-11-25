import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth/useAuth";
import { isOnlineWebProtectedPath } from "./onlineWebSession";
import { ONLINE_WEB_ROUTE_IDS } from "./onlineWebSurface";

/**
 * Client-side session check for protected online pages. Route `beforeLoad`
 * guards skip during SSR (the session is in browser storage), so this runs after
 * hydration and sends signed-out visitors to login with the full href kept.
 * Returns whether the page content may render.
 */
export function useOnlineWebSessionGate(): boolean {
  const nav = useNavigate();
  const { pathname, href } = useRouterState({
    select: (s) => ({ pathname: s.location.pathname, href: s.location.href }),
  });
  const { loading, isAuthenticated } = useAuth();
  const isProtected = isOnlineWebProtectedPath(pathname);

  useEffect(() => {
    if (!isProtected || loading || isAuthenticated) return;
    void nav({ to: ONLINE_WEB_ROUTE_IDS.login, search: { returnTo: href }, replace: true });
  }, [isProtected, loading, isAuthenticated, href, nav]);

  return !isProtected || (!loading && isAuthenticated);
}
