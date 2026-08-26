import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useApp } from "@/lib/store";
import { resolveLandingForCurrentUser } from "@/lib/auth/landing";
import { useMyProfile } from "@/lib/db/queries";
import { FamyWordmark } from "@/components/famio/FamyWordmark";

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
    <div className="relative mx-auto min-h-dvh w-full max-w-md overflow-hidden text-brand-foreground">
      {/* Full-bleed brand canvas — not a flat white screen */}
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand via-[oklch(0.68_0.18_30)] to-[oklch(0.58_0.16_20)]"
        aria-hidden="true"
      />

      {/* Ambient decorative layer — soft shapes behind the logo */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -start-1/3 top-[12%] h-[22rem] w-[22rem] rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -end-1/4 bottom-[8%] h-[18rem] w-[18rem] rounded-full bg-white/15 blur-3xl" />
        <div className="absolute start-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/20 blur-2xl" />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/10 to-transparent" />
      </div>

      {/* Foreground content — logo first, tagline follows a beat later */}
      <main className="safe-top safe-bottom relative z-10 flex min-h-dvh flex-col items-center justify-center px-8">
        <div className="flex w-full max-w-[18rem] flex-col items-center text-center">
          <div className="animate-pop w-full rounded-[2rem] border border-white/20 bg-white/95 px-8 py-7 shadow-float backdrop-blur-sm">
            <FamyWordmark size="splash" className="mx-auto" />
          </div>
          <p
            className="animate-rise mt-10 text-lg font-extrabold leading-snug tracking-tight text-white/95"
            style={{ animationDelay: "320ms" }}
          >
            {t("splash.tagline")}
          </p>
        </div>
      </main>
    </div>
  );
}
