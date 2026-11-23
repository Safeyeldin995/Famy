import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { ONLINE_WEB_ROUTE_IDS } from "./onlineWebSurface";

export async function requireOnlineWebSession(returnTo?: string) {
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  throw redirect({
    to: ONLINE_WEB_ROUTE_IDS.login,
    search: { returnTo: returnTo ?? undefined },
    replace: true,
  });
}