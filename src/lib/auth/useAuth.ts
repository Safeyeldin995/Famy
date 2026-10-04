/**
 * Production auth hook around Supabase.
 * Phone OTP + persistent session + role helpers.
 */
import { useEffect, useState, useCallback } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { isPreviewProRoute, isPreviewRoute, PREVIEW_USER_ID } from "@/lib/preview/constants";

type Role = Database["public"]["Enums"]["app_role"];

function previewUser(): User {
  return {
    id: PREVIEW_USER_ID,
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "",
  } as User;
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesError, setRolesError] = useState(false);

  const loadRoles = useCallback(async (uid: string) => {
    setRolesLoading(true);
    setRolesError(false);
    const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", uid);
    if (error) {
      setRoles([]);
      setRolesError(true);
    } else {
      setRoles((data ?? []).map((r) => r.role as Role));
    }
    setRolesLoading(false);
  }, []);

  useEffect(() => {
    if (isPreviewRoute()) {
      setSession({} as Session);
      setUser(previewUser());
      setRoles(isPreviewProRoute() ? ["provider"] : ["customer"]);
      setLoading(false);
      setRolesLoading(false);
      setRolesError(false);
      return;
    }
    // 1) subscribe FIRST to avoid missing the SIGNED_IN event
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        // defer to avoid recursive locks inside the callback
        setTimeout(() => void loadRoles(s.user!.id), 0);
      } else {
        setRoles([]);
        setRolesLoading(false);
        setRolesError(false);
      }
    });
    // 2) then hydrate existing session
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) {
        void loadRoles(data.session.user.id);
      } else {
        setRolesLoading(false);
        setRolesError(false);
      }
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadRoles]);

  const sendOtp = useCallback(async (phone: string) => {
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) throw error;
  }, []);

  const verifyOtp = useCallback(async (phone: string, token: string) => {
    const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
    if (error) throw error;
    return data;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return {
    session,
    user,
    roles,
    loading,
    rolesLoading,
    rolesError,
    isAuthenticated: !!session,
    isCustomer: roles.includes("customer"),
    isProvider: roles.includes("provider"),
    isAdmin: roles.includes("admin"),
    sendOtp,
    verifyOtp,
    signOut,
  };
}
