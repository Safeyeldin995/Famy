/**
 * Resolves the selected non-admin workspace for the currently-authenticated
 * user. Admin is a manual destination only; login/splash must never auto-open
 * /admin just because the account has admin access.
 */
import { supabase } from "@/integrations/supabase/client";

export type Landing = "/pro" | "/home";

export async function resolveLandingForCurrentUser(): Promise<Landing | null> {
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) return null;
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  const roles = (data ?? []).map((r) => r.role as string);
  if (roles.includes("provider")) return "/pro";
  return "/home";
}
