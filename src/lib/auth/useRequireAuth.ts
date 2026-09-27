import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth/useAuth";

/**
 * Client-side gate for screens that only make sense when signed in (/setup, /profile).
 *
 * This is a UX guard, not a security boundary: it stops a signed-out visitor landing on a
 * screen that can only render empty. The authorization boundary is Supabase RLS, which already
 * restricts these reads and writes to auth.uid().
 *
 * It deliberately does NOT run in `beforeLoad`. The browser client keeps the session in
 * localStorage, so during server rendering `getSession()` always resolves to null and a
 * route-level guard would bounce signed-in users to /login on every refresh.
 *
 * Preview routes are unaffected: useAuth synthesises a session for them.
 */
export function useRequireAuth(): { checking: boolean; isAuthenticated: boolean } {
  const { loading, isAuthenticated } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (loading || isAuthenticated) return;
    void nav({ to: "/login", replace: true });
  }, [loading, isAuthenticated, nav]);

  return { checking: loading || !isAuthenticated, isAuthenticated };
}
