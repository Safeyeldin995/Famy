import { createFileRoute } from "@tanstack/react-router";
import { FamySplashScreen } from "@/components/famio/FamySplashScreen";

export const Route = createFileRoute("/preview/splash")({
  component: PreviewSplash,
});

function PreviewSplash() {
  return <FamySplashScreen onAnimationComplete={() => {}} reducedMotion={false} />;
}
