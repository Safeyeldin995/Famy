import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { OnlineAuthCard } from "@/components/online/OnlineWebAuthParts";
import { supabase } from "@/integrations/supabase/client";
import { consumeOnlineWebReturnTo } from "@/lib/web/onlineWebReturnTo";
import { safeOnlineWebReturnTo } from "@/lib/web/onlineWebSession";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";
import { onlineWebNextPathForCurrentUser } from "@/lib/web/useOnlineWebAuthRedirect";
import { oauthErrorInUrl } from "./auth.callback";

export const Route = createFileRoute("/online/auth/callback")({ component: OnlineAuthCallback });

/** Landing page for Google sign-in and the email confirmation link on the online website. */
function OnlineAuthCallback() {
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
      const returnTo = safeOnlineWebReturnTo(
        consumeOnlineWebReturnTo(ONLINE_WEB_ROUTE_IDS.tutors),
        ONLINE_WEB_ROUTE_IDS.tutors,
      );
      const target = await onlineWebNextPathForCurrentUser(returnTo);
      if (cancelled) return;
      if (target === ONLINE_WEB_ROUTE_IDS.completeProfile) {
        nav({ to: ONLINE_WEB_ROUTE_IDS.completeProfile, search: { returnTo }, replace: true });
        return;
      }
      nav({ href: target ?? returnTo, replace: true });
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [nav]);

  return (
    <OnlineAuthCard>
      {failed ? (
        <div className="space-y-4 text-center">
          <p className="text-pro-16 font-bold">{t("onlineWeb.auth.callbackFailedTitle")}</p>
          <p className="text-pro-14 text-muted-foreground">{t("onlineWeb.auth.callbackFailedBody")}</p>
          <Link
            to={ONLINE_WEB_ROUTE_IDS.login}
            className="focus-ring inline-flex min-h-11 items-center text-pro-14 font-extrabold text-brand"
          >
            {t("onlineWeb.auth.backToSignIn")}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-6">
          <Loader2 className="h-7 w-7 animate-spin text-brand" aria-hidden="true" />
          <p className="text-pro-14 font-semibold text-muted-foreground">{t("oauth.signingIn")}</p>
        </div>
      )}
    </OnlineAuthCard>
  );
}
