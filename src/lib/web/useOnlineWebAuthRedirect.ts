import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { resolveOnlinePostAuthTarget } from "@/lib/auth/onlineWebAuth";
import { stashOnlineWebReturnTo } from "./onlineWebReturnTo";
import { safeOnlineWebReturnTo } from "./onlineWebSession";
import { ONLINE_WEB_ROUTE_IDS } from "./onlineWebSurface";

/** Reads the signed-in user's profile and returns where the online site should go next. */
export async function onlineWebNextPathForCurrentUser(returnTo: string): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("phone, full_name")
    .eq("id", user.id)
    .maybeSingle();
  return resolveOnlinePostAuthTarget({
    profilePhone: profile?.phone,
    profileFullName: profile?.full_name,
    returnTo,
  });
}

/**
 * Sign-in / sign-up pages: once a session exists (any method), go to the
 * profile step when the student still has no name or phone, else to returnTo.
 */
export function useOnlineWebAuthRedirect(rawReturnTo: string) {
  const nav = useNavigate();
  const { isAuthenticated, loading } = useAuth();
  const returnTo = safeOnlineWebReturnTo(rawReturnTo, ONLINE_WEB_ROUTE_IDS.home);

  useEffect(() => {
    stashOnlineWebReturnTo(returnTo);
  }, [returnTo]);

  useEffect(() => {
    if (loading || !isAuthenticated) return;
    let cancelled = false;
    void onlineWebNextPathForCurrentUser(returnTo).then((target) => {
      if (cancelled || !target) return;
      if (target === ONLINE_WEB_ROUTE_IDS.completeProfile) {
        nav({ to: ONLINE_WEB_ROUTE_IDS.completeProfile, search: { returnTo }, replace: true });
        return;
      }
      nav({ href: target, replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [loading, isAuthenticated, returnTo, nav]);
}
