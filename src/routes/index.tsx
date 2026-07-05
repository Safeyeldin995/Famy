import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useApp } from "@/lib/store";
import { resolveLandingForCurrentUser } from "@/lib/auth/landing";
import { useMyProfile } from "@/lib/db/queries";
import famyLogo from "@/assets/famy-wordmark.png.asset.json";

export const Route = createFileRoute("/")({
  component: Splash,
});

function Splash() {
  const navigate = useNavigate();
  const { onboarded } = useApp();
  const { t } = useTranslation();
  // profile.isLoading gates the redirect below so we never navigate off a
  // stale/incomplete read of `useMyProfile()`.
  const profileQ = useMyProfile();

  useEffect(() => {
    if (profileQ.isLoading) return;
    let cancelled = false;
    const tm = setTimeout(async () => {
      if (!onboarded) return navigate({ to: "/onboarding" });
      // Real Supabase session check — replaces the old Zustand `authed` flag,
      // which could silently disagree with the actual session (STATE-01).
      const landing = await resolveLandingForCurrentUser();
      if (cancelled) return;
      if (!landing) return navigate({ to: "/login" });
      // Real `profiles.full_name` check — replaces the old Zustand
      // `profile.name` flag, which never reflected the database (AUTH-01).
      if (!profileQ.data?.full_name) return navigate({ to: "/setup" });
      navigate({ to: "/home" });
    }, 1600);
    return () => { cancelled = true; clearTimeout(tm); };
  }, [navigate, onboarded, profileQ.isLoading, profileQ.data?.full_name]);


  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center bg-white text-navy">
      <div className="animate-pop">
        <img src={famyLogo.url} alt={t("common.appName")} className="h-28 w-auto object-contain" />
      </div>

    </div>
  );
}

