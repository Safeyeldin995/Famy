import { PendingHomeScreen } from "@/ui/provider/PendingHomeScreen";
import { useMyProvider } from "@/lib/provider/queries";

export default function ProSetupHomeScreen() {
  const p = useMyProvider();
  const provider = p.data as Record<string, unknown> | null | undefined;
  const status = provider?.onboarding_status as string | undefined;
  const changesRequested = status === "NEEDS_CHANGES";
  return <PendingHomeScreen changesRequested={changesRequested} onboardingStatus={status} />;
}
