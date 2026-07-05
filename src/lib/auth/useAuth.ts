/**
 * Production auth hook around Supabase.
 * Phone OTP + persistent session + role helpers.
 */
import { useEffect, useState, useCallback } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type Role = Database['public']['Enums']['app_role'];

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1) subscribe FIRST to avoid missing the SIGNED_IN event
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        // defer to avoid recursive locks inside the callback
        setTimeout(() => loadRoles(s.user!.id), 0);
      } else {
        setRoles([]);
      }
    });
    // 2) then hydrate existing session
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) loadRoles(data.session.user.id);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadRoles = async (uid: string) => {
    const { data } = await supabase.from('user_roles').select('role').eq('user_id', uid);
    setRoles((data ?? []).map((r) => r.role as Role));
  };

  const sendOtp = useCallback(async (phone: string) => {
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) throw error;
  }, []);

  const verifyOtp = useCallback(async (phone: string, token: string) => {
    const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
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
    isAuthenticated: !!session,
    isCustomer: roles.includes('customer'),
    isProvider: roles.includes('provider'),
    isAdmin: roles.includes('admin'),
    sendOtp,
    verifyOtp,
    signOut,
  };
}
