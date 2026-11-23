import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyProvider } from "@/lib/db/provider-queries";
import { ONLINE_WEB_ROUTE_IDS } from "./onlineWebSurface";

export type OnlineWebNavTab = {
  to: string;
  key:
    | "onlineWeb.nav.tutors"
    | "onlineWeb.nav.lessons"
    | "onlineWeb.nav.wallet"
    | "onlineWeb.nav.providerLessons";
};

function isOnlineWalkthroughPath(): boolean {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname;
  return path === "/preview/online/walkthrough" || path.startsWith("/preview/online/walkthrough/");
}

export function useOnlineWebNavTabs(): OnlineWebNavTab[] {
  const walkthrough = isOnlineWalkthroughPath();
  const sessionQ = useQuery({
    queryKey: ["online-web-session"],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return Boolean(data.session);
    },
    staleTime: 30_000,
  });
  const providerQ = useMyProvider();

  return useMemo(() => {
    const tabs: OnlineWebNavTab[] = [
      { to: ONLINE_WEB_ROUTE_IDS.tutors, key: "onlineWeb.nav.tutors" },
    ];
    const signedIn = walkthrough || sessionQ.data;
    const isProvider = walkthrough || Boolean(providerQ.data?.id);
    if (signedIn) {
      tabs.push(
        { to: ONLINE_WEB_ROUTE_IDS.lessons, key: "onlineWeb.nav.lessons" },
        { to: ONLINE_WEB_ROUTE_IDS.wallet, key: "onlineWeb.nav.wallet" },
      );
    }
    if (isProvider) {
      tabs.push({
        to: ONLINE_WEB_ROUTE_IDS.providerLessons,
        key: "onlineWeb.nav.providerLessons",
      });
    }
    return tabs;
  }, [walkthrough, sessionQ.data, providerQ.data?.id]);
}