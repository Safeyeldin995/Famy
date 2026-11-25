import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth/useAuth";

type Role = Database["public"]["Enums"]["app_role"];

export function isAdminPortalOnlyAccount(roles: Role[]): boolean {
  return roles.includes("admin");
}

/** Keeps admin accounts on the staff portal, not customer or provider surfaces. */
export function useAdminAccountRedirect(): { blocking: boolean } {
  const { loading, rolesLoading, rolesError, roles } = useAuth();
  const nav = useNavigate();
  const shouldRedirect = isAdminPortalOnlyAccount(roles);
  const waitingForRoles = loading || rolesLoading;

  useEffect(() => {
    if (waitingForRoles || rolesError || !shouldRedirect) return;
    void nav({ to: "/admin", replace: true });
  }, [waitingForRoles, rolesError, shouldRedirect, nav]);

  if (rolesError) {
    return { blocking: false };
  }

  return { blocking: waitingForRoles || shouldRedirect };
}
