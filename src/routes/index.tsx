import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useApp } from "@/lib/store";
import { resolveLandingForCurrentUser } from "@/lib/auth/landing";
import { useMyProfile } from "@/lib/db/queries";
import { FamySplashMark } from "@/components/famio/FamySplashMark";

export const Route = createFileRoute("/")({
  component: Splash,
});

function Splash() {
  const navigate = useNavigate();
  const { onboarded } = useApp();
  const profileQ = useMyProfile();

  useEffect(() => {
    if (profileQ.isLoading) return;
    let cancelled = false;
    const tm = setTimeout(async () => {
      if (!onboarded) return navigate({ to: "/onboarding" });
      const landing = await resolveLandingForCurrentUser();
      if (cancelled) return;
      if (!landing) return navigate({ to: "/login" });
      if (!profileQ.data?.full_name) return navigate({ to: "/setup" });
      navigate({ to: "/home" });
    }, 2400);
    return () => {
      cancelled = true;
      clearTimeout(tm);
    };
  }, [navigate, onboarded, profileQ.isLoading, profileQ.data?.full_name]);

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center overflow-hidden bg-background text-foreground">
      <span
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_40%,color-mix(in_oklch,var(--brand)_28%,transparent),transparent)]"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-brand/20 blur-3xl"
        style={{ animation: "famy-splash-glow 2.4s ease-in-out infinite" }}
        aria-hidden="true"
      />
      <div className="relative z-10 flex flex-col items-center">
        <FamySplashMark />
        <div className="mt-8 flex gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="h-1.5 w-1.5 rounded-full bg-brand/40"
              style={{
                animation: "famy-splash-glow 1.2s ease-in-out infinite",
                animationDelay: `${dot * 180}ms`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
