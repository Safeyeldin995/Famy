import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth/useAuth";

type Role = Database["public"]["Enums"]["app_role"];

export function isProviderOnlyCustomerPortalBlocked(roles: Role[]): boolean {
  if (roles.includes("admin")) return false;
  if (roles.includes("customer")) return false;
  return roles.includes("provider");
}

/**
 * Redirects provider-only accounts away from customer-app routes. Dual-role users
 * keep access to both portals; admin routes are unaffected.
 */
export function useProviderOnlyCustomerRedirect(): { blocking: boolean } {
  const { loading, rolesLoading, rolesError, roles } = useAuth();
  const nav = useNavigate();
  const blocked = isProviderOnlyCustomerPortalBlocked(roles);
  const waitingForRoles = loading || rolesLoading;

  useEffect(() => {
    if (waitingForRoles || rolesError || !blocked) return;
    void nav({ to: "/pro", replace: true });
  }, [waitingForRoles, rolesError, blocked, nav]);

  if (rolesError) {
    return { blocking: false };
  }

  return { blocking: waitingForRoles || blocked };
}
