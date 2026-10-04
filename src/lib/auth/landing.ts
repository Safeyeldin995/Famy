/**
 * Resolves the selected workspace for the currently-authenticated user after
 * splash or sign-in. Admin and provider portals take precedence over the customer app.
 */
import { supabase } from "@/integrations/supabase/client";

export type Landing = "/pro" | "/home" | "/admin";

export async function resolveLandingForCurrentUser(): Promise<Landing | null> {
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) return null;
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roles = (data ?? []).map((r) => r.role as string);
  if (roles.includes("admin")) return "/admin";
  if (roles.includes("provider")) return "/pro";
  return "/home";
}

export function resolveSplashNavigationTarget(input: {
  onboarded: boolean;
  landing: Landing | null;
  profileFullName?: string | null;
}): "/onboarding" | "/login" | "/setup" | Landing {
  if (!input.onboarded) return "/onboarding";
  if (!input.landing) return "/login";
  if (!input.profileFullName) return "/setup";
  return input.landing;
}

export type PostPasswordLoginTarget = Landing | "provider_account_missing";

export function resolvePostPasswordLoginTarget(input: {
  loginRole: "customer" | "provider";
  landing: Landing | null;
}): PostPasswordLoginTarget | null {
  if (!input.landing) return null;
  if (input.loginRole === "provider" && input.landing !== "/pro") {
    return "provider_account_missing";
  }
  return input.landing;
}
