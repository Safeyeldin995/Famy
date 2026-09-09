import { createFileRoute } from "@tanstack/react-router";
import { Route as ProOnboardingRoute } from "./pro.onboarding";

const ProOnboarding = ProOnboardingRoute.options.component!;

export const Route = createFileRoute("/preview/pro/onboarding")({ component: ProOnboarding });
