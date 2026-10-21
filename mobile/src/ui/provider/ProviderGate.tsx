import type { ReactNode } from "react";
import { Redirect } from "expo-router";
import { useProviderGate } from "./useProviderGate";
import { providerStatusNativePath } from "@/lib/provider/gates";

/** Redirect non-approved providers away from the main tab experience. */
export function ProviderGate({ children }: { children: ReactNode }) {
  const { q, provider, status, allowed } = useProviderGate();
  if (!q.isSuccess) return null;
  if (!allowed) {
    return <Redirect href={providerStatusNativePath(!!provider, status)} />;
  }
  return <>{children}</>;
}
