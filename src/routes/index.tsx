import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/lib/store";
import { resolveLandingForCurrentUser } from "@/lib/auth/landing";
import { useMyProfile } from "@/lib/db/queries";
import { FamySplashScreen } from "@/components/famio/FamySplashScreen";
import {
  markFamySplashPlayed,
  shouldPlayFamySplash,
} from "@/lib/splash/famySplashState";

export const Route = createFileRoute("/")({
  component: Splash,
});

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function Splash() {
  const navigate = useNavigate();
  const { onboarded } = useApp();
  const profileQ = useMyProfile();
  const reducedMotion = usePrefersReducedMotion();
  const playAnimation = shouldPlayFamySplash();

  const [animationComplete, setAnimationComplete] = useState(!playAnimation);
  const appReady = !profileQ.isLoading;

  const goNext = useCallback(async () => {
    markFamySplashPlayed();
    if (!onboarded) {
      navigate({ to: "/onboarding", replace: true });
      return;
    }
    const landing = await resolveLandingForCurrentUser();
    if (!landing) {
      navigate({ to: "/login", replace: true });
      return;
    }
    if (!profileQ.data?.full_name) {
      navigate({ to: "/setup", replace: true });
      return;
    }
    navigate({ to: "/home", replace: true });
  }, [navigate, onboarded, profileQ.data?.full_name]);

  useEffect(() => {
    if (!animationComplete || !appReady) return;
    void goNext();
  }, [animationComplete, appReady, goNext]);

  if (playAnimation) {
    return (
      <FamySplashScreen
        reducedMotion={reducedMotion}
        onAnimationComplete={() => setAnimationComplete(true)}
      />
    );
  }

  return null;
}
