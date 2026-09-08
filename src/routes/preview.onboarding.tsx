import { createFileRoute } from "@tanstack/react-router";
import { Route as OnboardingRoute } from "./onboarding";

const Onboarding = OnboardingRoute.options.component!;

export const Route = createFileRoute("/preview/onboarding")({ component: Onboarding });
