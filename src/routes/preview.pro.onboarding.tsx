import { createFileRoute } from "@tanstack/react-router";
import { ProviderOnboardingFlow } from "@/components/provider/ProviderOnboardingFlow";

export const Route = createFileRoute("/preview/pro/onboarding")({
  component: PreviewProOnboarding,
});

function PreviewProOnboarding() {
  return <ProviderOnboardingFlow previewMode />;
}
