import { createFileRoute } from "@tanstack/react-router";
import { ProviderOnboardingFlow } from "@/components/provider/ProviderOnboardingFlow";

/** Keep the existing secure document/review flow without redirecting to the legacy URL. */
export const Route = createFileRoute("/pro/documents")({
  component: () => <ProviderOnboardingFlow initialSection="review" />,
});
