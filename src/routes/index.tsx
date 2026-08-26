import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
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
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center bg-background text-foreground">
      <div className="animate-pop">
        <FamyWordmark size="splash" />
      </div>
    </div>
  );
}
