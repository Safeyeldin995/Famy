import { useMyProvider } from "@/lib/provider/queries";
import { providerCanUseNativeApp } from "@/lib/provider/gates";

export function useProviderGate() {
  const q = useMyProvider();
  const provider = q.data as Record<string, unknown> | null | undefined;
  const status = provider?.onboarding_status as string | undefined;
  const allowed = providerCanUseNativeApp(!!provider, status);
  return { q, provider, status, allowed };
}
