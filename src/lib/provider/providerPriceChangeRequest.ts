/** Whether the provider must use the price-change RPC instead of a direct update. */
export function providerPriceNeedsAdminReview(
  onboardingStatus: string | null | undefined,
  serviceStatus: string | null | undefined,
): boolean {
  return onboardingStatus === "APPROVED" && serviceStatus === "approved";
}

export function providerPriceChangeDirty(
  draft: number | null | undefined,
  livePrice: number | null | undefined,
  pendingPrice: number | null | undefined,
): boolean {
  if (pendingPrice != null) return false;
  if (draft == null) return false;
  return draft !== livePrice;
}
