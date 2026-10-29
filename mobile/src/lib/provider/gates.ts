/** Native routes for providers who cannot use the main tabs yet. */
export type ProviderNativePath = "/pro-apply" | "/pro-documents" | "/pro-setup-home";

export function providerCanUseNativeApp(
  hasProviderRow: boolean,
  onboardingStatus: string | null | undefined,
): boolean {
  return hasProviderRow && onboardingStatus === "APPROVED";
}

export function providerStatusNativePath(
  hasProviderRow: boolean,
  onboardingStatus: string | null | undefined,
): ProviderNativePath {
  if (!hasProviderRow || onboardingStatus === "DRAFT" || !onboardingStatus) return "/pro-apply";
  // Like web /pro: show the admin's reason and the resubmit action, not the signup wizard.
  if (onboardingStatus === "NEEDS_CHANGES") return "/pro-setup-home";
  if (onboardingStatus === "SUBMITTED" || onboardingStatus === "UNDER_REVIEW")
    return "/pro-documents";
  return "/pro-setup-home";
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
