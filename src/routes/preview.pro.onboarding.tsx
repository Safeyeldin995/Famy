import { onboardingSection } from "@/lib/provider/onboardingSection";
import { createFileRoute } from "@tanstack/react-router";
import { OnboardingRoute } from "./pro.onboarding";

export const Route = createFileRoute("/preview/pro/onboarding")({
  validateSearch: onboardingSection,
  component: OnboardingRoute,
});
