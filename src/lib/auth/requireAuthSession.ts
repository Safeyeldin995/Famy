import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/** Customer /setup and /profile require a real session. Preview routes do not use this. */
export async function requireAuthSession() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    throw redirect({ to: "/login", replace: true });
  }
}
