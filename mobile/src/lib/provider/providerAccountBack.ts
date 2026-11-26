import type { Href } from "expo-router";
import { providerCanUseNativeApp, providerStatusNativePath } from "./gates";

/** Provider delete/help Cancel and Back must not target the customer profile when gated. */
export function providerSelfServiceBackTarget(
  hasProviderRow: boolean,
  onboardingStatus: string | null | undefined,
): Href {
  if (providerCanUseNativeApp(hasProviderRow, onboardingStatus)) return "/pro-profile";
  return providerStatusNativePath(hasProviderRow, onboardingStatus);
}
