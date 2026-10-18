import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { PhoneFrame, PrimaryButton } from "@/components/famio/ui";
import { supabase } from "@/integrations/supabase/client";
import { resolveRoleLandingForCurrentUser } from "@/lib/auth/landing";

export const Route = createFileRoute("/auth/callback")({ component: OAuthCallback });

/** True when the provider redirected back with an error (user cancelled, misconfiguration). */
export function oauthErrorInUrl(href: string) {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  return Boolean(url.searchParams.get("error") || hash.get("error"));
}

function OAuthCallback() {
  const nav = useNavigate();
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (oauthErrorInUrl(window.location.href)) {
        setFailed(true);
        return;
      }
      // getSession waits for supabase-js to read the session from the redirect URL.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        setFailed(true);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("phone, full_name")
        .eq("id", data.session.user.id)
        .maybeSingle();
      if (cancelled) return;
      // A Google account has no phone yet; providers need one to reach the customer.
      if (!profile?.phone || !profile.full_name) {
        nav({ to: "/setup", replace: true });
        return;
      }
      const landing = await resolveRoleLandingForCurrentUser();
      if (!cancelled) nav({ to: landing?.landing ?? "/home", replace: true });
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [nav]);

  return (
    <PhoneFrame bg="bg-white">
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        {failed ? (
          <div className="space-y-4">
            <p className="text-pro-16 font-bold">{t("oauth.failedTitle")}</p>
            <p className="text-pro-14 text-muted-foreground">{t("oauth.failedBody")}</p>
            <PrimaryButton
              className="h-12 w-full"
              onClick={() => nav({ to: "/login", replace: true })}
            >
              {t("oauth.backToLogin")}
            </PrimaryButton>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-7 w-7 animate-spin text-brand" aria-hidden="true" />
            <p className="text-pro-14 font-semibold text-muted-foreground">
              {t("oauth.signingIn")}
            </p>
          </div>
        )}
      </div>
    </PhoneFrame>
  );
}
