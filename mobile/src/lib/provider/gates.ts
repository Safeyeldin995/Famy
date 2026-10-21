/** When the native app should send providers to the web instead of tabs. */
export type ProviderWebPath = "/pro/onboarding" | "/pro/apply" | "/pro/documents";

export function providerCanUseNativeApp(
  hasProviderRow: boolean,
  onboardingStatus: string | null | undefined,
): boolean {
  return hasProviderRow && onboardingStatus === "APPROVED";
}

export function providerStatusWebPath(
  hasProviderRow: boolean,
  onboardingStatus: string | null | undefined,
): ProviderWebPath {
  if (!hasProviderRow || onboardingStatus === "DRAFT" || !onboardingStatus) return "/pro/apply";
  if (onboardingStatus === "NEEDS_CHANGES") return "/pro/apply";
  if (onboardingStatus === "SUBMITTED" || onboardingStatus === "UNDER_REVIEW")
    return "/pro/documents";
  return "/pro/onboarding";
}

export function providerStatusTitleKey(
  hasProviderRow: boolean,
  onboardingStatus: string | null | undefined,
): string {
  if (!hasProviderRow) return "pro.gateway.title";
  if (!onboardingStatus || onboardingStatus === "DRAFT") return "pro.gateway.title";
  if (onboardingStatus === "NEEDS_CHANGES") return "pro.onboardingWizard.status.NEEDS_CHANGES";
  if (onboardingStatus === "SUBMITTED" || onboardingStatus === "UNDER_REVIEW") {
    return "pro.onboardingWizard.status.UNDER_REVIEW";
  }
  if (onboardingStatus === "REJECTED") return "pro.onboardingWizard.status.REJECTED";
  if (onboardingStatus === "SUSPENDED") return "pro.onboardingWizard.status.SUSPENDED";
  return "mobilePro.finishOnWeb";
}

export function providerStatusBodyKey(
  hasProviderRow: boolean,
  onboardingStatus: string | null | undefined,
): string {
  if (!hasProviderRow) return "pro.gateway.body";
  if (!onboardingStatus || onboardingStatus === "DRAFT") return "pro.gateway.body";
  if (onboardingStatus === "NEEDS_CHANGES") return "pro.onboardingWizard.changesRequired";
  if (onboardingStatus === "SUBMITTED" || onboardingStatus === "UNDER_REVIEW") {
    return "pro.onboardingWizard.statusBody.UNDER_REVIEW";
  }
  return "mobilePro.finishOnWebBody";
}
