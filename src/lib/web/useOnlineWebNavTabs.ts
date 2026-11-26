import { useMemo } from "react";
import { useAuth } from "@/lib/auth/useAuth";
import { useMyProvider } from "@/lib/db/provider-queries";
import { ONLINE_WEB_ROUTE_IDS } from "./onlineWebSurface";

export type OnlineWebNavTab = {
  to: string;
  key:
    | "onlineWeb.hub.navHome"
    | "onlineWeb.hub.navEarnings"
    | "onlineWeb.hub.navAccount"
    | "onlineWeb.nav.tutors"
    | "onlineWeb.nav.lessons"
    | "onlineWeb.nav.wallet"
    | "onlineWeb.nav.providerRequests"
    | "onlineWeb.nav.providerLessons";
};

function isOnlineWalkthroughPath(): boolean {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname;
  return path === "/preview/online/walkthrough" || path.startsWith("/preview/online/walkthrough/");
}

export function useOnlineWebNavTabs(): OnlineWebNavTab[] {
  const walkthrough = isOnlineWalkthroughPath();
  // Follow the live auth state (a cached session check went stale after sign-in).
  const { isAuthenticated } = useAuth();
  const providerQ = useMyProvider();

  return useMemo(() => {
    const signedIn = walkthrough || isAuthenticated;
    const isProvider = walkthrough || (isAuthenticated && Boolean(providerQ.data?.id));

    if (walkthrough) {
      return [
        { to: ONLINE_WEB_ROUTE_IDS.tutors, key: "onlineWeb.nav.tutors" },
        { to: ONLINE_WEB_ROUTE_IDS.lessons, key: "onlineWeb.nav.lessons" },
        { to: ONLINE_WEB_ROUTE_IDS.wallet, key: "onlineWeb.nav.wallet" },
        {
          to: ONLINE_WEB_ROUTE_IDS.providerRequests,
          key: "onlineWeb.nav.providerRequests",
        },
        {
          to: ONLINE_WEB_ROUTE_IDS.providerLessons,
          key: "onlineWeb.nav.providerLessons",
        },
      ];
    }

    if (isProvider) {
      return [
        { to: ONLINE_WEB_ROUTE_IDS.home, key: "onlineWeb.hub.navHome" },
        {
          to: ONLINE_WEB_ROUTE_IDS.providerRequests,
          key: "onlineWeb.nav.providerRequests",
        },
        {
          to: ONLINE_WEB_ROUTE_IDS.providerLessons,
          key: "onlineWeb.nav.providerLessons",
        },
        { to: "/pro/earnings", key: "onlineWeb.hub.navEarnings" },
        { to: "/pro/profile", key: "onlineWeb.hub.navAccount" },
      ];
    }

    const tabs: OnlineWebNavTab[] = [
      { to: ONLINE_WEB_ROUTE_IDS.home, key: "onlineWeb.hub.navHome" },
      { to: ONLINE_WEB_ROUTE_IDS.tutors, key: "onlineWeb.nav.tutors" },
    ];
    if (signedIn) {
      tabs.push(
        { to: ONLINE_WEB_ROUTE_IDS.lessons, key: "onlineWeb.nav.lessons" },
        { to: ONLINE_WEB_ROUTE_IDS.wallet, key: "onlineWeb.nav.wallet" },
      );
    }
    return tabs;
  }, [walkthrough, isAuthenticated, providerQ.data?.id]);
}