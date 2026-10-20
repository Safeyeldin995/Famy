import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

type SessionState = { session: Session | null; ready: boolean };

const SessionContext = createContext<SessionState>({ session: null, ready: false });

/**
 * Single auth listener for the app. Clears cached queries whenever the signed-in
 * user changes so one account never sees another account's data.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [state, setState] = useState<SessionState>({ session: null, ready: false });

  useEffect(() => {
    let previousUserId: string | null | undefined;
    supabase.auth.getSession().then(({ data }) => {
      previousUserId = data.session?.user.id ?? null;
      setState({ session: data.session, ready: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const userId = session?.user.id ?? null;
      if (previousUserId !== undefined && (userId !== previousUserId || event === "SIGNED_OUT")) {
        qc.clear();
      }
      previousUserId = userId;
      setState({ session, ready: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}

export type Workspace = "customer" | "provider" | "admin";

/** Mirrors the web landing rule: admin, then provider, then customer. */
export async function resolveWorkspace(userId: string): Promise<{ workspace: Workspace; roles: string[] }> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r) => r.role as string);
  const workspace: Workspace = roles.includes("admin")
    ? "admin"
    : roles.includes("provider")
      ? "provider"
      : "customer";
  return { workspace, roles };
}
