import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useNavigate,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { LanguageProvider } from "../lib/i18n/LanguageProvider";
import { supabase } from "../integrations/supabase/client";

import { useTranslation } from "react-i18next";

function NotFoundComponent() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-2 px-6">
      <div className="text-center">
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-navy text-navy-foreground text-3xl font-extrabold">F</div>
        <h1 className="mt-6 text-2xl font-bold text-foreground">{t("common.pageNotFound")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("common.pageNotFoundBody")}</p>
        <Link
          to="/home"
          className="mt-6 inline-flex h-12 items-center justify-center rounded-2xl bg-navy px-6 text-sm font-semibold text-navy-foreground"
        >
          {t("common.backHome")}
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const { t } = useTranslation();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-2 px-6">
      <div className="text-center">
        <h1 className="text-xl font-bold text-foreground">{t("common.somethingWentWrong")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("common.tryAgainSoon")}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-6 inline-flex h-12 items-center justify-center rounded-2xl bg-navy px-6 text-sm font-semibold text-navy-foreground"
        >
          {t("common.retry")}
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1" },
      { name: "theme-color", content: "#142B6F" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "mobile-web-app-capable", content: "yes" },
      { title: "Famy — Trusted help. Happy families." },
      { name: "description", content: "Famy connects modern families with trusted, verified household professionals in Egypt." },
      { property: "og:title", content: "Famy — Trusted help. Happy families." },
      { property: "og:description", content: "Famy connects modern families with trusted, verified household professionals in Egypt." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Famy — Trusted help. Happy families." },
      { name: "twitter:description", content: "Famy connects modern families with trusted, verified household professionals in Egypt." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/2ca0773f-3e87-4b1a-be08-0eb9219f0ad6" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/2ca0773f-3e87-4b1a-be08-0eb9219f0ad6" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Cairo:wght@400;600;700;800&display=swap" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  // Inline pre-hydration script: apply persisted language to <html lang/dir>
  // before React renders so refresh/login never shows a brief reset to English.
  const langBootstrap = `(function(){try{var l=localStorage.getItem('famio.lang')==='ar'?'ar':'en';document.documentElement.lang=l;document.documentElement.dir=l==='ar'?'rtl':'ltr';document.documentElement.setAttribute('data-lang',l);}catch(e){}})();`;
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: langBootstrap }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <AuthCacheBridge />
        <PushNavigationBridge />
        <Outlet />
      </LanguageProvider>
    </QueryClientProvider>
  );
}

/**
 * Single global auth listener. Drops role/identity caches whenever the
 * authenticated user changes, so a customer signing in after a provider
 * (or vice-versa) never inherits the previous user's role/provider data
 * and gets routed to the wrong portal.
 */
function AuthCacheBridge() {
  const qc = useQueryClient();
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        qc.removeQueries({ queryKey: ["my-role"] });
        qc.removeQueries({ queryKey: ["my-provider"] });
        return;
      }
      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        qc.invalidateQueries({ queryKey: ["my-role"] });
        qc.invalidateQueries({ queryKey: ["my-provider"] });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);
  return null;
}

/**
 * Fallback for notificationclick navigation: sw.js tries client.navigate()
 * first (works in Chromium), but Safari/Firefox service workers can't
 * navigate an existing client directly, so they postMessage the deep link
 * here instead and this does the router navigation.
 */
function PushNavigationBridge() {
  const nav = useNavigate();
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "famy-navigate" && typeof event.data.deepLink === "string") {
        nav({ to: event.data.deepLink as any });
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [nav]);
  return null;
}
