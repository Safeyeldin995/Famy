import { supabase } from "./supabase";

export type Workspace = "customer" | "provider" | "admin";

/** Mirrors the web landing rule: admin, then provider, then customer. */
export async function resolveWorkspace(
  userId: string,
): Promise<{ workspace: Workspace; roles: string[] }> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r) => r.role as string);
  const workspace: Workspace = roles.includes("admin")
    ? "admin"
    : roles.includes("provider")
      ? "provider"
      : "customer";
  return { workspace, roles };
}