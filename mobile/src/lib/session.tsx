import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { handleUserBannedSession, isUserBannedAuthError } from "@/lib/auth/bannedAccountSession";
import { clearMobileAuthCookies } from "@/lib/auth/mobileAuthCookies";
import { resolveWorkspace, type Workspace } from "./workspace";
import { logFamyEvent } from "@/lib/analytics";
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
    supabase.auth.getSession().then(({ data, error }) => {
      if (error && isUserBannedAuthError(error)) {
        void handleUserBannedSession();
        previousUserId = null;
        setState({ session: null, ready: true });
        return;
      }
      previousUserId = data.session?.user.id ?? null;
      setState({ session: data.session, ready: true });
      if (!data.session) {
        void import("@/lib/auth/mobileOtpApi").then(({ fetchMobileOtpContext }) =>
          fetchMobileOtpContext().then((ctx) => {
            if (!ctx.ok) return clearMobileAuthCookies();
          }),
        );
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const userId = session?.user.id ?? null;
      if (event === "SIGNED_OUT") {
        void clearMobileAuthCookies();
      }
      if (previousUserId !== undefined && (userId !== previousUserId || event === "SIGNED_OUT")) {
        qc.clear();
      }
      if (event === "SIGNED_IN" && session?.user?.created_at) {
        const createdMs = Date.parse(session.user.created_at);
        if (Number.isFinite(createdMs) && Date.now() - createdMs < 5 * 60 * 1000) {
          void logFamyEvent("sign_up");
        }
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

/** True when the signed-in user is an admin-only account (no customer/provider tabs). */
export function useAdminOnlyMobileBlock(): { ready: boolean; blocked: boolean } {
  const { session, ready } = useSession();
  const [blocked, setBlocked] = useState<boolean | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!session) {
      setBlocked(false);
      return;
    }
    let cancelled = false;
    resolveWorkspace(session.user.id).then((r) => {
      if (!cancelled) setBlocked(r.workspace === "admin");
    });
    return () => {
      cancelled = true;
    };
  }, [ready, session]);

  return { ready: ready && blocked !== null, blocked: blocked === true };
}

export type { Workspace } from "./workspace";
export { resolveWorkspace } from "./workspace";

/** Mirrors the web splash/login rule: a customer without a name finishes setup first. */
export async function customerLandingPath(userId: string): Promise<"/home" | "/setup"> {
  const { data } = await supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", userId)
    .maybeSingle();
  // Google/Apple accounts must add a phone before using the app (setup collects it).
  return data?.full_name?.trim() && data?.phone?.trim() ? "/home" : "/setup";
}
