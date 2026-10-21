import { Redirect, useLocalSearchParams } from "expo-router";
import { useMyProvider } from "@/lib/provider/queries";
import type { OnboardingStatus } from "@/lib/provider/onboardingQueries";

/** Deep-link compatibility for legacy /pro/onboarding?section= URLs. */
export default function ProOnboardingRedirect() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const p = useMyProvider();
  const provider = p.data as Record<string, unknown> | null | undefined;
  const status = provider?.onboarding_status as OnboardingStatus | undefined;

  if (!status || status === "DRAFT") {
    const step =
      section === "services" ? 2 : section === "review" || section === "experience" ? 3 : 1;
    return <Redirect href={{ pathname: "/pro-apply", params: { step: String(step) } }} />;
  }
  if (status === "NEEDS_CHANGES" && section !== "experience" && section !== "references") {
    const step = section === "services" ? 2 : section === "review" ? 3 : 1;
    return <Redirect href={{ pathname: "/pro-apply", params: { step: String(step) } }} />;
  }
  if (section === "experience") {
    return <Redirect href={{ pathname: "/pro-setup/[item]", params: { item: "about" } }} />;
  }
  if (section === "references") {
    return <Redirect href={{ pathname: "/pro-setup/[item]", params: { item: "reference" } }} />;
  }
  if (section === "personal") {
    return <Redirect href={{ pathname: "/pro-setup/[item]", params: { item: "personal" } }} />;
  }
  if (section === "review") return <Redirect href="/pro-documents" />;
  if (section === "services") return <Redirect href="/pro-profile-edit" />;
  return <Redirect href="/pro-setup-home" />;
}
