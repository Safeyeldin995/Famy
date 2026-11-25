import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth/useAuth";

type Role = Database["public"]["Enums"]["app_role"];

export function isProviderOnlyCustomerPortalBlocked(roles: Role[]): boolean {
  if (roles.includes("customer")) return false;
  return roles.includes("provider");
}

/**
 * Redirects provider-only accounts away from customer-app routes and sends
 * admin-only accounts to the staff portal. Dual customer+provider users keep both.
 */
export function useProviderOnlyCustomerRedirect(): { blocking: boolean } {
  const { loading, rolesLoading, rolesError, roles } = useAuth();
  const nav = useNavigate();
  const adminOnly = roles.includes("admin");
  const providerOnly = isProviderOnlyCustomerPortalBlocked(roles);
  const blocked = adminOnly || providerOnly;
  const waitingForRoles = loading || rolesLoading;

  useEffect(() => {
    if (waitingForRoles || rolesError || !blocked) return;
    void nav({ to: adminOnly ? "/admin" : "/pro", replace: true });
  }, [waitingForRoles, rolesError, blocked, adminOnly, nav]);

  if (rolesError) {
    return { blocking: false };
  }

  return { blocking: waitingForRoles || blocked };
}
